// @ts-check

const { execFile } = require('node:child_process');
const { promises: fs } = require('node:fs');
const { join } = require('node:path');
const { promisify } = require('node:util');
const {
  EAGER_TEXT_FILE_LIMIT,
  IMAGE_FILE_LIMIT,
  MANUAL_TEXT_FILE_LIMIT,
  bufferToImageRevision,
  bufferToTextFile,
  createSummary,
  fileSort,
  formatBytes,
  getFingerprint,
  getGravatarHash,
  getImageMimeType,
  summarizeContent,
  validateRepositoryPath,
} = require('../git-state/common.cjs');

const execFileAsync = promisify(execFile);

const MINIMUM_JJ_VERSION = '0.39.0';
const JJ_GLOBAL_ARGS = ['--no-pager', '--color', 'never'];
const CHECKOUT_TEMPLATE = [
  'change_id',
  'commit_id',
  'description.first_line()',
  'local_bookmarks.map(|bookmark| bookmark.name()).join(",")',
  'if(conflict, "1", "0")',
  'if(empty, "1", "0")',
  'if(divergent, "1", "0")',
  'author.name()',
  'author.email()',
  'author.timestamp().format("%+")',
  'committer.name()',
  'committer.email()',
  'committer.timestamp().format("%+")',
  'description',
  'parents.map(|parent| parent.commit_id()).join(" ")',
].join(' ++ "\\0" ++ ');
const DIFF_ENTRY_TEMPLATE =
  'self.path() ++ "\\0" ++ self.status() ++ "\\0" ++ self.source().path() ++ "\\0" ++ if(self.target().conflict(), "1", "0") ++ "\\n"';
const HISTORY_TEMPLATE = [
  'commit_id',
  'change_id',
  'if(divergent, "1", "0")',
  'committer.timestamp().format("%+")',
  'description.first_line()',
  'author.name()',
  'author.email()',
  'parents.map(|parent| parent.commit_id()).join(" ")',
].join(' ++ "\\0" ++ ');
const SIMPLE_JJ_REF = /^[A-Za-z0-9@._/-]+$/;
const WORKSPACE_LIST_TEMPLATE =
  'name ++ "\\0" ++ if(target.current_working_copy(), "1", "0") ++ "\\0" ++ target.commit_id() ++ "\\0" ++ target.change_id() ++ "\\0" ++ target.description().first_line() ++ "\\n"';

/**
 * @typedef {import('../../core/types.ts').ChangedFile} ChangedFile
 * @typedef {import('../../core/types.ts').DiffSection} DiffSection
 * @typedef {import('../../core/types.ts').FileStatus} FileStatus
 * @typedef {import('../../core/types.ts').RepositoryInfo} RepositoryInfo
 * @typedef {import('../../core/types.ts').RepositoryState} RepositoryState
 * @typedef {import('../git-state/common.cjs').FileContentResult} FileContentResult
 * @typedef {{changeId: string; commitId: string; conflict: boolean; description: string; divergent: boolean; empty: boolean; bookmarks: ReadonlyArray<string>; authorName: string; authorEmail: string; authorDate: string; committerName: string; committerEmail: string; committerDate: string; subject: string; parents: ReadonlyArray<string>}} JjCheckoutIdentity
 * @typedef {{conflict: boolean; oldPath?: string; path: string; status: FileStatus}} JjDiffEntry
 */

/** @param {string} version */
const parseJjVersion = (version) => {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) {
    return null;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
};

/** @param {{major: number; minor: number; patch: number}} left @param {{major: number; minor: number; patch: number}} right */
const compareJjVersions = (left, right) =>
  left.major - right.major || left.minor - right.minor || left.patch - right.patch;

/** @param {string} repoPath */
const assertSupportedJjVersion = async (repoPath) => {
  let raw;
  try {
    raw = await jj(repoPath, ['--version'], { snapshot: false });
  } catch (error) {
    throw new Error(
      `Codiff found a Jujutsu repository, but the jj executable is missing or failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const version = parseJjVersion(raw);
  const minimum = parseJjVersion(MINIMUM_JJ_VERSION);
  if (!version || !minimum || compareJjVersions(version, minimum) < 0) {
    throw new Error(
      `Codiff requires jj ${MINIMUM_JJ_VERSION} or newer. Found ${raw.trim() || 'an unknown version'}.`,
    );
  }
};

/**
 * @param {string} repoPath
 * @param {ReadonlyArray<string>} args
 * @param {{encoding?: BufferEncoding | 'buffer'; snapshot?: boolean}} [options]
 */
const jj = async (repoPath, args, options = {}) => {
  const snapshot = options.snapshot === true;
  const argv = [
    '-R',
    repoPath,
    ...JJ_GLOBAL_ARGS,
    ...(snapshot ? [] : ['--ignore-working-copy']),
    ...args,
  ];
  const encoding = options.encoding === 'buffer' ? 'buffer' : options.encoding || 'utf8';
  const { stdout } = await execFileAsync('jj', argv, {
    encoding,
    maxBuffer: 1024 * 1024 * 64,
  });
  return stdout;
};

/** @param {string} repoPath */
const snapshotWorkingCopy = (repoPath) => jj(repoPath, ['util', 'snapshot'], { snapshot: true });

/**
 * @typedef {{changeId: string; commitId: string; current: boolean; name: string; subject: string}} JjWorkspace
 */

/** @param {string} raw */
const parseJjWorkspaces = (raw) => {
  /** @type {Array<JjWorkspace>} */
  const workspaces = [];
  for (const line of raw.split('\n')) {
    if (!line) {
      continue;
    }
    const [name, current, commitId, changeId, subject] = line.split('\0');
    if (!name || !commitId) {
      continue;
    }
    workspaces.push({
      changeId: changeId || '',
      commitId,
      current: current === '1',
      name,
      subject: subject || '',
    });
  }
  return workspaces;
};

/** @param {string} repoPath */
const listJjWorkspaces = async (repoPath) => {
  try {
    return parseJjWorkspaces(
      await jj(repoPath, ['workspace', 'list', '-T', WORKSPACE_LIST_TEMPLATE]),
    );
  } catch {
    return [];
  }
};

/** Snapshot every other workspace so their working-copy commits are visible. */
const snapshotOtherJjWorkspaces = async (repoPath) => {
  const workspaces = await listJjWorkspaces(repoPath);
  await Promise.all(
    workspaces
      .filter((workspace) => !workspace.current)
      .map(async (workspace) => {
        try {
          const root = (await jj(repoPath, ['workspace', 'root', '--name', workspace.name])).trim();
          if (root) {
            await snapshotWorkingCopy(root);
          }
        } catch {
          // Leave a stale working copy out of history rather than failing the list.
        }
      }),
  );
  return listJjWorkspaces(repoPath);
};

/** @param {string} repoPath */
const readJjWorkspaceRoot = async (repoPath) =>
  (await jj(repoPath, ['root'], { snapshot: false })).trim();

/** @param {string} path */
const quoteJjFileset = (path) => `root:${JSON.stringify(path)}`;

/** @param {string} value */
const splitNullFields = (value) => value.split('\0');

/** @param {string} raw */
const parseJjCheckoutIdentity = (raw) => {
  const [
    changeId,
    commitId,
    subject,
    bookmarks,
    conflict,
    empty,
    divergent,
    authorName,
    authorEmail,
    authorDate,
    committerName,
    committerEmail,
    committerDate,
    description,
    parents,
  ] = splitNullFields(raw.trimEnd());
  if (!changeId || !commitId) {
    throw new Error('Unexpected jj checkout identity.');
  }
  return {
    authorDate: authorDate || '',
    authorEmail: authorEmail || '',
    authorName: authorName || '',
    bookmarks: bookmarks ? bookmarks.split(',').filter(Boolean) : [],
    changeId,
    commitId,
    committerDate: committerDate || '',
    committerEmail: committerEmail || '',
    committerName: committerName || '',
    conflict: conflict === '1',
    description: description || '',
    divergent: divergent === '1',
    empty: empty === '1',
    parents: parents ? parents.split(' ').filter(Boolean) : [],
    subject: subject || '',
  };
};

/** @param {unknown} error */
const isDivergentChangeError = (error) => {
  if (!(error instanceof Error)) {
    return false;
  }
  const detail = `${/** @type {{stderr?: string}} */ (error).stderr || ''} ${error.message}`;
  return /is divergent/i.test(detail);
};

/** @param {string} revision */
const uniqueJjRevisionFallbacks = (revision) =>
  SIMPLE_JJ_REF.test(revision)
    ? [`latest(ancestors(@) & change_id(${revision}))`, `latest(change_id(${revision}))`]
    : [];

/**
 * @param {string} repoPath
 * @param {string} revision
 */
const readJjLogIdentity = async (repoPath, revision) =>
  parseJjCheckoutIdentity(
    await jj(repoPath, ['log', '-r', revision, '-n', '1', '--no-graph', '-T', CHECKOUT_TEMPLATE]),
  );

/** @param {string} repoPath @param {string} [revision] */
const readJjCheckoutIdentity = async (repoPath, revision = '@') => {
  try {
    return await readJjLogIdentity(repoPath, revision);
  } catch (error) {
    if (!isDivergentChangeError(error)) {
      throw error;
    }
    for (const revset of uniqueJjRevisionFallbacks(revision)) {
      try {
        return await readJjLogIdentity(repoPath, revset);
      } catch {
        // Try the next unique revset.
      }
    }
    throw error;
  }
};

/** @param {JjCheckoutIdentity} identity */
const createJjRepositoryInfo = (identity) => ({
  bookmarks: identity.bookmarks,
  changeId: identity.changeId,
  commitId: identity.commitId,
  vcs: /** @type {const} */ ('jj'),
});

/** @param {string} status @param {boolean} conflict */
const mapJjDiffStatus = (status, conflict) => {
  if (conflict) {
    return 'conflicted';
  }
  if (status === 'added') {
    return 'added';
  }
  if (status === 'removed') {
    return 'deleted';
  }
  if (status === 'renamed' || status === 'copied') {
    return 'renamed';
  }
  return 'modified';
};

/** @param {string} raw */
const parseJjDiffEntries = (raw) => {
  /** @type {Array<JjDiffEntry>} */
  const entries = [];
  for (const line of raw.split('\n')) {
    if (!line) {
      continue;
    }
    const [path, status, sourcePath, conflict] = line.split('\0');
    if (!path || !status) {
      throw new Error(`Unexpected jj diff entry: ${line}`);
    }
    const mapped = mapJjDiffStatus(status, conflict === '1');
    entries.push({
      conflict: conflict === '1',
      ...(sourcePath && sourcePath !== path ? { oldPath: sourcePath } : {}),
      path,
      status: mapped,
    });
  }
  return entries.sort(fileSort);
};

/**
 * @param {string} repoPath
 * @param {{from?: string; to?: string; revision?: string; showWhitespace?: boolean; paths?: ReadonlyArray<string>}} spec
 */
const createJjDiffArgs = (spec) => {
  /** @type {Array<string>} */
  const args = ['diff'];
  if (spec.revision) {
    args.push('-r', spec.revision);
  } else {
    if (spec.from) {
      args.push('--from', spec.from);
    }
    if (spec.to) {
      args.push('--to', spec.to);
    }
  }
  if (spec.showWhitespace === false) {
    args.push('-w');
  }
  if (spec.paths?.length) {
    args.push(...spec.paths.map(quoteJjFileset));
  }
  return args;
};

/**
 * @param {string} repoPath
 * @param {{from?: string; to?: string; revision?: string; showWhitespace?: boolean; paths?: ReadonlyArray<string>}} spec
 */
const listJjDiffEntries = async (repoPath, spec) =>
  parseJjDiffEntries(await jj(repoPath, [...createJjDiffArgs(spec), '-T', DIFF_ENTRY_TEMPLATE]));

const diffGitHeaderPattern = /^diff --git (.+)$/;

/** @param {string} value */
const unquoteGitPath = (value) => {
  if (!value.startsWith('"')) {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value.slice(1, value.endsWith('"') ? -1 : undefined);
  }
};

/** @param {string} line */
const splitDiffGitHeader = (line) => {
  const match = line.match(diffGitHeaderPattern);
  if (!match) {
    return null;
  }
  const paths = [];
  let index = 0;
  const value = match[1];
  while (index < value.length && paths.length < 2) {
    while (value[index] === ' ') {
      index += 1;
    }
    if (value[index] === '"') {
      let end = index + 1;
      let escaped = false;
      while (end < value.length) {
        const char = value[end];
        if (char === '"' && !escaped) {
          end += 1;
          break;
        }
        escaped = char === '\\' && !escaped;
        if (char !== '\\') {
          escaped = false;
        }
        end += 1;
      }
      paths.push(unquoteGitPath(value.slice(index, end)));
      index = end;
      continue;
    }
    const end = value.indexOf(' ', index);
    if (end === -1) {
      paths.push(value.slice(index));
      break;
    }
    paths.push(value.slice(index, end));
    index = end + 1;
  }
  return paths.length === 2 ? paths : null;
};

/** @param {string} path */
const stripGitDiffPrefix = (path) =>
  path.startsWith('a/') || path.startsWith('b/') ? path.slice(2) : path;

/** @param {string} rawPatch */
const splitGitPatchByPath = (rawPatch) => {
  /** @type {Map<string, {binary: boolean; patch: string}>} */
  const patches = new Map();
  const starts = [];
  const pattern = /^diff --git .+$/gm;
  let match;
  while ((match = pattern.exec(rawPatch))) {
    starts.push(match.index);
  }
  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index];
    const end = starts[index + 1] ?? rawPatch.length;
    const patch = rawPatch.slice(start, end);
    const newline = patch.indexOf('\n');
    const header = patch.slice(0, newline === -1 ? patch.length : newline);
    const paths = splitDiffGitHeader(header);
    const path = paths ? stripGitDiffPrefix(paths[1]) : null;
    if (path) {
      patches.set(path, {
        binary: /Binary files .* differ/.test(patch),
        patch,
      });
    }
  }
  return patches;
};

/**
 * @param {string} repoPath
 * @param {{from?: string; to?: string; revision?: string; showWhitespace?: boolean; paths?: ReadonlyArray<string>}} spec
 */
const readJjGitPatchMap = async (repoPath, spec) =>
  splitGitPatchByPath(await jj(repoPath, [...createJjDiffArgs(spec), '--git']));

/**
 * @param {string} repoPath
 * @param {string} revision
 * @param {string} path
 * @param {{force?: boolean}} [options]
 * @returns {Promise<FileContentResult>}
 */
const readJjFile = async (repoPath, revision, path, options = {}) => {
  const limit = options.force ? MANUAL_TEXT_FILE_LIMIT : EAGER_TEXT_FILE_LIMIT;
  try {
    const buffer = /** @type {Buffer} */ (
      await jj(repoPath, ['file', 'show', '-r', revision, quoteJjFileset(path)], {
        encoding: 'buffer',
      })
    );
    if (buffer.length > limit) {
      return {
        binary: false,
        loadState: buffer.length > MANUAL_TEXT_FILE_LIMIT ? 'too-large' : 'deferred',
        summary: createSummary(
          buffer.length > MANUAL_TEXT_FILE_LIMIT
            ? `File is ${formatBytes(buffer.length)}, so Codiff skipped rendering it.`
            : `File is ${formatBytes(buffer.length)} and will be loaded on demand.`,
          {
            canLoad: buffer.length <= MANUAL_TEXT_FILE_LIMIT,
            limit,
            size: buffer.length,
          },
        ),
      };
    }
    return bufferToTextFile(path, buffer, `jj:${revision}:${path}`);
  } catch {
    return {
      binary: false,
      file: {
        cacheKey: `jj:${revision}:${path}:empty`,
        contents: '',
        name: path,
      },
    };
  }
};

/**
 * @param {string} repoPath
 * @param {string} revision
 * @param {string} path
 */
const readJjImageFile = async (repoPath, revision, path) => {
  const mimeType = getImageMimeType(path);
  if (!mimeType) {
    throw new Error('Unsupported image file type.');
  }
  try {
    const buffer = /** @type {Buffer} */ (
      await jj(repoPath, ['file', 'show', '-r', revision, quoteJjFileset(path)], {
        encoding: 'buffer',
      })
    );
    if (buffer.length > IMAGE_FILE_LIMIT) {
      throw new Error(`Image is ${formatBytes(buffer.length)}, so Codiff skipped rendering it.`);
    }
    return bufferToImageRevision(path, buffer);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Image is ')) {
      throw error;
    }
    return undefined;
  }
};

/** @param {string} path */
const shouldEagerlyReadContents = (path) => /\.md$/i.test(path);

/**
 * @param {JjDiffEntry} entry
 * @param {string} sectionId
 * @param {DiffSection['kind']} kind
 * @param {{binary: boolean; patch: string} | undefined} patch
 * @param {FileContentResult} oldFile
 * @param {FileContentResult} newFile
 */
const createJjChangedFile = (entry, sectionId, kind, patch, oldFile, newFile) => {
  const summary = summarizeContent(oldFile, newFile);
  const binary = summary.binary || Boolean(patch?.binary);
  const section = {
    binary,
    id: sectionId,
    kind,
    loadState: binary ? 'binary' : summary.loadState,
    newFile: newFile.file?.cacheKey?.startsWith('empty:') ? undefined : newFile.file,
    oldFile: oldFile.file?.cacheKey?.startsWith('empty:') ? undefined : oldFile.file,
    patch: binary ? '' : patch?.patch || '',
    summary: binary ? createSummary('Binary file changed.', { canLoad: false }) : summary.summary,
  };
  return {
    fingerprint: getFingerprint(
      `${entry.status}\n${entry.oldPath || ''}\n${section.loadState || 'ready'}\n${
        section.binary ? 'binary' : 'text'
      }\n${section.patch}\n${section.summary?.reason || ''}\n${section.oldFile?.contents || ''}\n${
        section.newFile?.contents || ''
      }`,
    ),
    oldPath: entry.oldPath,
    path: entry.path,
    sections: [section],
    status: entry.status,
  };
};

/** @param {string} repoPath */
const readJjGitRoot = async (repoPath) => {
  try {
    return (await jj(repoPath, ['git', 'root'])).trim();
  } catch {
    return null;
  }
};

module.exports = {
  CHECKOUT_TEMPLATE,
  DIFF_ENTRY_TEMPLATE,
  HISTORY_TEMPLATE,
  MINIMUM_JJ_VERSION,
  assertSupportedJjVersion,
  createJjChangedFile,
  createJjDiffArgs,
  createJjRepositoryInfo,
  getFingerprint,
  getGravatarHash,
  jj,
  listJjDiffEntries,
  listJjWorkspaces,
  parseJjCheckoutIdentity,
  parseJjDiffEntries,
  quoteJjFileset,
  readJjCheckoutIdentity,
  snapshotOtherJjWorkspaces,
  readJjFile,
  readJjGitPatchMap,
  readJjGitRoot,
  readJjImageFile,
  readJjWorkspaceRoot,
  shouldEagerlyReadContents,
  snapshotWorkingCopy,
  splitGitPatchByPath,
  summarizeContent,
  validateRepositoryPath,
};
