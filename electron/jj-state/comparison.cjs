// @ts-check

const { fileSort } = require('../git-state/common.cjs');
const {
  HISTORY_TEMPLATE,
  createJjChangedFile,
  createJjRepositoryInfo,
  getGravatarHash,
  jj,
  listJjDiffEntries,
  readJjCheckoutIdentity,
  readJjFile,
  readJjGitPatchMap,
  readJjImageFile,
  readJjWorkspaceRoot,
  snapshotWorkingCopy,
  shouldEagerlyReadContents,
  validateRepositoryPath,
} = require('./common.cjs');
const { readJjWorkingCopyState } = require('./working-copy.cjs');

/**
 * @typedef {import('../../core/types.ts').ChangedFile} ChangedFile
 * @typedef {import('../../core/types.ts').CommitMetadata} CommitMetadata
 * @typedef {import('../../core/types.ts').DiffImageContentRequest} DiffImageContentRequest
 * @typedef {import('../../core/types.ts').DiffSectionContentRequest} DiffSectionContentRequest
 * @typedef {import('../../core/types.ts').RepositoryHistory} RepositoryHistory
 * @typedef {import('../../core/types.ts').RepositoryState} RepositoryState
 * @typedef {import('../../core/types.ts').ReviewSource} ReviewSource
 * @typedef {import('./common.cjs').JjDiffEntry} JjDiffEntry
 * @typedef {{from?: string; revision?: string; to?: string}} JjComparisonSpec
 */

const emptyFile = (path) => ({
  binary: false,
  file: {
    cacheKey: `empty:${path}`,
    contents: '',
    name: path,
  },
});

/** @param {string} timestamp */
const parseJjTimestamp = (timestamp) => {
  const millis = Date.parse(timestamp);
  return Number.isFinite(millis) ? millis : 0;
};

/** @param {string} repoPath @param {string} revset */
const resolveSingleRevision = async (repoPath, revset) => {
  try {
    return await readJjCheckoutIdentity(repoPath, revset);
  } catch (error) {
    throw new Error(
      `Could not resolve "${revset}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

/** @param {string} repoPath @param {string} base @param {string} head */
const resolveForkPoint = async (repoPath, base, head) => {
  const identity = await resolveSingleRevision(repoPath, `fork_point(${base} | ${head})`);
  return identity.commitId;
};

/**
 * @param {string} repoRoot
 * @param {JjComparisonSpec} spec
 * @param {JjDiffEntry} entry
 * @param {string} sectionId
 * @param {Map<string, {binary: boolean; patch: string}>} patches
 * @param {{force?: boolean; patchOnly?: boolean}} [options]
 */
const createComparisonFile = async (repoRoot, spec, entry, sectionId, patches, options = {}) => {
  const oldRevision = spec.from || (spec.revision ? `${spec.revision}-` : undefined);
  const newRevision = spec.to || spec.revision;
  const patchOnly = options.patchOnly && !shouldEagerlyReadContents(entry.path);
  const [oldFile, newFile] = patchOnly
    ? [emptyFile(entry.oldPath || entry.path), emptyFile(entry.path)]
    : await Promise.all([
        entry.status === 'added' || !oldRevision
          ? emptyFile(entry.oldPath || entry.path)
          : readJjFile(repoRoot, oldRevision, entry.oldPath || entry.path, options),
        entry.status === 'deleted' || !newRevision
          ? emptyFile(entry.path)
          : readJjFile(repoRoot, newRevision, entry.path, options),
      ]);
  return createJjChangedFile(entry, sectionId, 'commit', patches.get(entry.path), oldFile, newFile);
};

/**
 * @param {string} launchPath
 * @param {ReviewSource} source
 * @param {JjComparisonSpec} spec
 * @param {{showWhitespace?: boolean}} [options]
 */
const readJjComparisonState = async (launchPath, source, spec, options = {}) => {
  const repoRoot = await readJjWorkspaceRoot(launchPath);
  const identity = await readJjCheckoutIdentity(repoRoot, spec.to || spec.revision || '@');
  const entries = await listJjDiffEntries(repoRoot, {
    ...spec,
    showWhitespace: options.showWhitespace,
  });
  const patches = await readJjGitPatchMap(repoRoot, {
    ...spec,
    showWhitespace: options.showWhitespace,
  });
  const files = (
    await Promise.all(
      entries.map((entry) =>
        createComparisonFile(repoRoot, spec, entry, `${entry.path}:${identity.commitId}`, patches, {
          patchOnly: true,
        }),
      ),
    )
  ).sort(fileSort);

  return {
    commitMetadata: createJjCommitMetadata(identity, entries),
    files,
    generatedAt: Date.now(),
    launchPath,
    repository: createJjRepositoryInfo(identity),
    root: repoRoot,
    source,
  };
};

/**
 * @param {import('./common.cjs').JjCheckoutIdentity} identity
 * @param {ReadonlyArray<JjDiffEntry>} entries
 * @returns {CommitMetadata}
 */
const createJjCommitMetadata = (identity, entries) => {
  const files = entries.map((entry) => ({
    binary: false,
    oldPath: entry.oldPath,
    path: entry.path,
    status: entry.status,
  }));
  return {
    author: {
      date: identity.authorDate,
      email: identity.authorEmail,
      gravatarUrl: identity.authorEmail
        ? `https://www.gravatar.com/avatar/${getGravatarHash(identity.authorEmail)}?s=80&d=identicon`
        : undefined,
      name: identity.authorName,
    },
    body: identity.description.startsWith(identity.subject)
      ? identity.description.slice(identity.subject.length).trim()
      : identity.description,
    committer: {
      date: identity.committerDate,
      email: identity.committerEmail,
      gravatarUrl: identity.committerEmail
        ? `https://www.gravatar.com/avatar/${getGravatarHash(identity.committerEmail)}?s=80&d=identicon`
        : undefined,
      name: identity.committerName,
    },
    files,
    parents: identity.parents,
    ref: identity.changeId,
    refs: identity.bookmarks,
    shortRef: identity.changeId.slice(0, 12),
    signature: { status: 'N' },
    stats: {
      additions: 0,
      binaryFiles: 0,
      deletions: 0,
      files: files.length,
      renamedFiles: files.filter((file) => file.oldPath).length,
    },
    subject: identity.subject,
    trailers: [],
  };
};

/** @param {string} launchPath @param {string} ref */
const readJjCommitState = async (launchPath, ref) => {
  const repoRoot = await readJjWorkspaceRoot(launchPath);
  const identity = await resolveSingleRevision(repoRoot, ref);
  const source = {
    ref: identity.divergent ? identity.commitId : identity.changeId,
    type: /** @type {const} */ ('commit'),
  };
  return readJjComparisonState(launchPath, source, { revision: identity.commitId });
};

/** @param {string} launchPath @param {string} base @param {string} head @param {boolean} symmetric */
const readJjRangeState = async (launchPath, base, head, symmetric) => {
  const repoRoot = await readJjWorkspaceRoot(launchPath);
  const from = symmetric ? await resolveForkPoint(repoRoot, base, head) : base;
  return readJjComparisonState(
    launchPath,
    { base, head, symmetric, type: 'range' },
    { from, to: head },
  );
};

/** @param {string} launchPath @param {Extract<ReviewSource, {type: 'branch' | 'branch-diff'}>} source */
const readJjBranchState = async (launchPath, source) => {
  const repoRoot = await readJjWorkspaceRoot(launchPath);
  const bookmark = source.type === 'branch-diff' ? source.ref : source.ref;
  const head = source.type === 'branch-diff' ? source.headRef : '@';
  const from =
    source.type === 'branch-diff'
      ? source.baseRef
      : await resolveForkPoint(repoRoot, bookmark, '@');
  const headIdentity = await resolveSingleRevision(repoRoot, head);
  const baseIdentity = await resolveSingleRevision(repoRoot, from);
  return readJjComparisonState(
    launchPath,
    {
      baseRef: baseIdentity.commitId,
      headRef: headIdentity.commitId,
      ref: bookmark,
      type: 'branch-diff',
    },
    { from: baseIdentity.commitId, to: headIdentity.commitId },
  );
};

/** @param {ChangedFile | undefined} left @param {ChangedFile | undefined} right */
const mergeChangedFile = (left, right) => {
  if (!left) {
    return /** @type {ChangedFile} */ (right);
  }
  if (!right) {
    return left;
  }
  const sections = [...left.sections, ...right.sections];
  return {
    fingerprint: `${left.fingerprint}:${right.fingerprint}`,
    oldPath: right.oldPath || left.oldPath,
    path: right.path,
    sections,
    status: right.status,
  };
};

/**
 * @param {string} launchPath
 * @param {Extract<ReviewSource, {type: 'branch-working-tree'}>} source
 * @param {{showWhitespace?: boolean}} [options]
 */
const readJjBranchWorkingTreeState = async (launchPath, source, options = {}) => {
  await snapshotWorkingCopy(launchPath);
  const [branchState, workingCopyState] = await Promise.all([
    readJjBranchState(launchPath, { ref: source.ref, type: 'branch' }),
    readJjWorkingCopyState(launchPath, {
      eagerContents: false,
      showWhitespace: options.showWhitespace,
    }),
  ]);
  const branchSource = /** @type {Extract<ReviewSource, {type: 'branch-diff'}>} */ (
    branchState.source
  );
  const branchFiles = new Map(branchState.files.map((file) => [file.path, file]));
  const workingFiles = new Map(workingCopyState.files.map((file) => [file.path, file]));
  const files = [...new Set([...branchFiles.keys(), ...workingFiles.keys()])]
    .map((path) => mergeChangedFile(branchFiles.get(path), workingFiles.get(path)))
    .sort(fileSort);
  return {
    ...branchState,
    files,
    generatedAt: Date.now(),
    source: {
      baseRef: branchSource.baseRef,
      headRef: branchSource.headRef,
      ref: source.ref,
      type: 'branch-working-tree',
    },
  };
};

/**
 * @param {string} launchPath
 * @param {DiffSectionContentRequest} request
 * @param {JjComparisonSpec} spec
 */
const readJjComparisonSectionContent = async (launchPath, request, spec) => {
  const repoRoot = await readJjWorkspaceRoot(launchPath);
  const path = validateRepositoryPath(request.path);
  const entries = await listJjDiffEntries(repoRoot, spec);
  const entry = entries.find((candidate) => candidate.path === path);
  if (!entry) {
    throw new Error('File is not part of this comparison.');
  }
  const patches = await readJjGitPatchMap(repoRoot, { ...spec, paths: [path] });
  const identity = await readJjCheckoutIdentity(repoRoot, spec.to || spec.revision || '@');
  return (
    await createComparisonFile(
      repoRoot,
      spec,
      entry,
      `${entry.path}:${identity.commitId}`,
      patches,
      { force: request.force },
    )
  ).sections[0];
};

/**
 * @param {string} launchPath
 * @param {DiffImageContentRequest} request
 * @param {JjComparisonSpec} spec
 */
const readJjComparisonImageContent = async (launchPath, request, spec) => {
  try {
    const repoRoot = await readJjWorkspaceRoot(launchPath);
    const path = validateRepositoryPath(request.path);
    const entries = await listJjDiffEntries(repoRoot, spec);
    const entry = entries.find((candidate) => candidate.path === path);
    if (!entry) {
      return { reason: 'Codiff could not load either side of this image.', status: 'unavailable' };
    }
    const oldRevision = spec.from || (spec.revision ? `${spec.revision}-` : undefined);
    const newRevision = spec.to || spec.revision;
    const [oldImage, newImage] = await Promise.all([
      entry.status === 'added' || !oldRevision
        ? undefined
        : readJjImageFile(repoRoot, oldRevision, entry.oldPath || entry.path),
      entry.status === 'deleted' || !newRevision
        ? undefined
        : readJjImageFile(repoRoot, newRevision, entry.path),
    ]);
    if (!oldImage && !newImage) {
      return { reason: 'Codiff could not load either side of this image.', status: 'unavailable' };
    }
    return {
      ...(newImage ? { newImage } : {}),
      ...(oldImage ? { oldImage } : {}),
      status: 'ready',
    };
  } catch (error) {
    return {
      reason: error instanceof Error ? error.message : 'Codiff could not load this image.',
      status: 'unavailable',
    };
  }
};

/** @param {string} raw */
const parseJjHistory = (raw) => {
  /** @type {Array<import('../../core/types.ts').HistoryEntry>} */
  const entries = [];
  for (const line of raw.split('\n')) {
    if (!line) {
      continue;
    }
    const [commitId, changeId, divergent, timestamp, subject, author, email, parents] =
      line.split('\0');
    if (!commitId || !changeId) {
      continue;
    }
    entries.push({
      author: author || '',
      committedAt: parseJjTimestamp(timestamp || ''),
      gravatarUrl: email
        ? `https://www.gravatar.com/avatar/${getGravatarHash(email)}?s=80&d=identicon`
        : undefined,
      parents: parents ? parents.split(' ').filter(Boolean) : [],
      ref: divergent === '1' ? commitId : changeId,
      subject: subject || '',
    });
  }
  return entries;
};

const DEFAULT_JJ_LOG_REVSET = 'present(@) | ancestors(immutable_heads().., 2) | trunk()';

/** @param {string} repoRoot */
const readJjWorkingCopyHistoryRevset = async (repoRoot) => {
  let logRevset = DEFAULT_JJ_LOG_REVSET;
  try {
    const configured = (await jj(repoRoot, ['config', 'get', 'revsets.log'])).trim();
    if (configured) {
      logRevset = configured;
    }
  } catch {
    // Keep the default `jj log` window.
  }
  return `((${logRevset}) | ancestors(@-)) ~ @`;
};

/** @param {string} launchPath @param {number} [limit] @param {ReviewSource} [source] */
const listJjRepositoryHistory = async (launchPath, limit = 200, source) => {
  const repoRoot = await readJjWorkspaceRoot(launchPath);
  const revset =
    source?.type === 'branch' ||
    source?.type === 'branch-diff' ||
    source?.type === 'branch-working-tree'
      ? `${source.ref}..@`
      : source?.type === 'range'
        ? `${source.base}..${source.head}`
        : await readJjWorkingCopyHistoryRevset(repoRoot);
  try {
    const raw = await jj(repoRoot, [
      'log',
      '-r',
      revset,
      '--no-graph',
      '--limit',
      String(limit),
      '-T',
      `${HISTORY_TEMPLATE} ++ "\\n"`,
    ]);
    return { entries: parseJjHistory(raw), root: repoRoot };
  } catch {
    return { entries: [], root: repoRoot };
  }
};

module.exports = {
  listJjRepositoryHistory,
  readJjBranchState,
  readJjBranchWorkingTreeState,
  readJjCommitState,
  readJjComparisonImageContent,
  readJjComparisonSectionContent,
  readJjRangeState,
  resolveForkPoint,
  resolveSingleRevision,
};
