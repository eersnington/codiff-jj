// @ts-check

const { join } = require('node:path');
const { promises: fs } = require('node:fs');
const {
  createJjChangedFile,
  createJjRepositoryInfo,
  getFingerprint,
  getGravatarHash,
  jj,
  listJjDiffEntries,
  readJjCheckoutIdentity,
  readJjFile,
  readJjGitPatchMap,
  readJjImageFile,
  readJjWorkspaceRoot,
  shouldEagerlyReadContents,
  snapshotWorkingCopy,
  validateRepositoryPath,
} = require('./common.cjs');
const { fileSort } = require('../git-state/common.cjs');

/**
 * @typedef {import('../../core/types.ts').DiffImageContentRequest} DiffImageContentRequest
 * @typedef {import('../../core/types.ts').DiffSectionContentRequest} DiffSectionContentRequest
 * @typedef {import('../../core/types.ts').RepositoryState} RepositoryState
 * @typedef {import('./common.cjs').JjDiffEntry} JjDiffEntry
 */

const emptyFile = (path) => ({
  binary: false,
  file: {
    cacheKey: `empty:${path}`,
    contents: '',
    name: path,
  },
});

/**
 * @param {string} repoRoot
 * @param {JjDiffEntry} entry
 * @param {{force?: boolean; patchOnly?: boolean; showWhitespace?: boolean}} [options]
 */
const createWorkingCopyFile = async (repoRoot, entry, options = {}) => {
  const patchOnly = options.patchOnly && !shouldEagerlyReadContents(entry.path);
  const patches = await readJjGitPatchMap(repoRoot, {
    revision: '@',
    showWhitespace: options.showWhitespace,
    paths: [entry.path],
  });
  const oldRevision = entry.status === 'added' ? null : '@-';
  const newRevision = entry.status === 'deleted' ? null : '@';
  const [oldFile, newFile] = patchOnly
    ? [emptyFile(entry.oldPath || entry.path), emptyFile(entry.path)]
    : await Promise.all([
        oldRevision
          ? readJjFile(repoRoot, oldRevision, entry.oldPath || entry.path, options)
          : emptyFile(entry.oldPath || entry.path),
        newRevision
          ? readJjFile(repoRoot, newRevision, entry.path, options)
          : emptyFile(entry.path),
      ]);
  return createJjChangedFile(
    entry,
    `${entry.path}:working-copy`,
    'working-copy',
    patches.get(entry.path),
    oldFile,
    newFile,
  );
};

/**
 * @param {string} launchPath
 * @param {{eagerContents?: boolean; showWhitespace?: boolean}} [options]
 * @returns {Promise<RepositoryState>}
 */
const readJjWorkingCopyState = async (launchPath, options = {}) => {
  await snapshotWorkingCopy(launchPath);
  const repoRoot = await readJjWorkspaceRoot(launchPath);
  const [identity, entries] = await Promise.all([
    readJjCheckoutIdentity(repoRoot),
    listJjDiffEntries(repoRoot, { revision: '@', showWhitespace: options.showWhitespace }),
  ]);
  const patchOnly = options.eagerContents === false;
  const patchMap = patchOnly
    ? await readJjGitPatchMap(repoRoot, { revision: '@', showWhitespace: options.showWhitespace })
    : new Map();
  const files = (
    await Promise.all(
      entries.map(async (entry) => {
        if (patchOnly && !shouldEagerlyReadContents(entry.path)) {
          return createJjChangedFile(
            entry,
            `${entry.path}:working-copy`,
            'working-copy',
            patchMap.get(entry.path),
            emptyFile(entry.oldPath || entry.path),
            emptyFile(entry.path),
          );
        }
        return createWorkingCopyFile(repoRoot, entry, {
          patchOnly: false,
          showWhitespace: options.showWhitespace,
        });
      }),
    )
  ).sort(fileSort);

  return {
    files,
    generatedAt: Date.now(),
    launchPath,
    repository: createJjRepositoryInfo(identity),
    root: repoRoot,
    source: { type: 'working-tree' },
  };
};

/** @param {string} launchPath @param {DiffSectionContentRequest} request */
const readJjWorkingCopySectionContent = async (launchPath, request) => {
  await snapshotWorkingCopy(launchPath);
  const repoRoot = await readJjWorkspaceRoot(launchPath);
  const path = validateRepositoryPath(request.path);
  const entries = await listJjDiffEntries(repoRoot, { revision: '@' });
  const entry = entries.find((candidate) => candidate.path === path);
  if (!entry) {
    throw new Error('File is not part of this working copy.');
  }
  return (await createWorkingCopyFile(repoRoot, entry, { force: request.force })).sections[0];
};

/** @param {string} launchPath @param {DiffImageContentRequest} request */
const readJjWorkingCopyImageContent = async (launchPath, request) => {
  try {
    await snapshotWorkingCopy(launchPath);
    const repoRoot = await readJjWorkspaceRoot(launchPath);
    const path = validateRepositoryPath(request.path);
    const entries = await listJjDiffEntries(repoRoot, { revision: '@' });
    const entry = entries.find((candidate) => candidate.path === path);
    if (!entry) {
      return { reason: 'Codiff could not load either side of this image.', status: 'unavailable' };
    }
    const [oldImage, newImage] = await Promise.all([
      entry.status === 'added'
        ? undefined
        : readJjImageFile(repoRoot, '@-', entry.oldPath || entry.path),
      entry.status === 'deleted' ? undefined : readJjImageFile(repoRoot, '@', entry.path),
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

/** @param {string} launchPath */
const readJjIdentity = async (launchPath) => {
  const [name, email] = await Promise.all([
    jj(launchPath, ['config', 'get', 'user.name']).catch(() => ''),
    jj(launchPath, ['config', 'get', 'user.email']).catch(() => ''),
  ]);
  const trimmedEmail = String(email).trim();
  const trimmedName = String(name).trim();
  return {
    email: trimmedEmail,
    gravatarUrl: trimmedEmail
      ? `https://www.gravatar.com/avatar/${getGravatarHash(trimmedEmail)}?s=80&d=identicon`
      : undefined,
    name: trimmedName,
  };
};

/**
 * @param {string} repoRoot
 * @param {string} path
 * @param {boolean} exact
 */
const readWatcherPathState = async (repoRoot, path, exact) => {
  try {
    const absolutePath = join(repoRoot, path);
    const stat = await fs.lstat(absolutePath);
    const metadata = `${path}\0${
      stat.isDirectory()
        ? 'directory'
        : stat.isSymbolicLink()
          ? 'symlink'
          : stat.isFile()
            ? 'file'
            : 'other'
    }\0${stat.mode}\0${stat.size}\0${stat.mtimeMs}\0${stat.ctimeMs}\0${stat.ino}`;
    if (!exact) {
      return { metadata };
    }
    const version = stat.isSymbolicLink()
      ? getFingerprint(await fs.readlink(absolutePath))
      : stat.isFile()
        ? getFingerprint(await fs.readFile(absolutePath))
        : undefined;
    return { metadata, version };
  } catch {
    return { metadata: `${path}\0missing` };
  }
};

/**
 * @param {string} repoRoot
 * @param {Iterable<string>} [exactPaths]
 */
const readJjWatcherSnapshot = async (repoRoot, exactPaths = []) => {
  await snapshotWorkingCopy(repoRoot);
  const [identity, entries] = await Promise.all([
    readJjCheckoutIdentity(repoRoot),
    listJjDiffEntries(repoRoot, { revision: '@' }),
  ]);
  const normalizedExactPaths = new Set([...exactPaths]);
  const statusPaths = new Set(
    entries.flatMap((entry) => [entry.path, entry.oldPath].filter(Boolean)),
  );
  const paths = new Set([...statusPaths, ...normalizedExactPaths]);
  const states = await Promise.all(
    [...paths].map(async (path) => [
      path,
      await readWatcherPathState(repoRoot, path, normalizedExactPaths.has(path)),
    ]),
  );
  /** @type {Record<string, string>} */
  const pathSignatures = {};
  /** @type {Record<string, string>} */
  const pathVersions = {};
  for (const [path, state] of states) {
    if (statusPaths.has(path)) {
      pathSignatures[path] = state.metadata;
    }
    if (state.version) {
      pathVersions[path] = state.version;
    }
  }
  const sortedSignatures = Object.entries(pathSignatures).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  const head = `${identity.commitId}\0${identity.changeId}`;
  return {
    head,
    pathSignatures: Object.fromEntries(sortedSignatures),
    pathVersions,
    root: repoRoot,
    signature: getFingerprint([head, ...sortedSignatures.map(([, value]) => value)].join('\0')),
  };
};

module.exports = {
  readJjIdentity,
  readJjWatcherSnapshot,
  readJjWorkingCopyImageContent,
  readJjWorkingCopySectionContent,
  readJjWorkingCopyState,
};
