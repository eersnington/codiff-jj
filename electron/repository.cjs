// @ts-check

const gitState = require('./git-state.cjs');
const jjState = require('./jj-state.cjs');
const { discoverRepository } = require('./repository-discovery.cjs');
const { createWalkthroughCommit } = require('./walkthrough-commit.cjs');
const { readRepositoryWatcherSnapshot } = require('./repository-watcher.cjs');

/**
 * @typedef {import('../core/types.ts').ReviewSource} ReviewSource
 */

/** @param {string} launchPath */
const getRepositoryBackend = (launchPath) => {
  const discovered = discoverRepository(launchPath);
  if (discovered.kind === 'jj') {
    return { discovered, kind: /** @type {const} */ ('jj') };
  }
  return { discovered, kind: /** @type {const} */ ('git') };
};

/** @param {string} launchPath @param {ReviewSource} [source] @param {{showWhitespace?: boolean}} [options] */
const readRepositoryState = async (launchPath, source, options) => {
  const { kind } = getRepositoryBackend(launchPath);
  return kind === 'jj'
    ? jjState.readJjRepositoryState(launchPath, source, options)
    : gitState.readRepositoryState(launchPath, source, options);
};

/** @param {string} launchPath @param {ReviewSource} [source] @param {{showWhitespace?: boolean}} [options] */
const readWalkthroughRepositoryState = async (launchPath, source, options) => {
  const { kind } = getRepositoryBackend(launchPath);
  return kind === 'jj'
    ? jjState.readJjWalkthroughRepositoryState(launchPath, source, options)
    : gitState.readWalkthroughRepositoryState(launchPath, source, options);
};

/** @param {string} launchPath @param {number} [limit] @param {ReviewSource} [source] */
const listRepositoryHistory = async (launchPath, limit, source) => {
  const { kind } = getRepositoryBackend(launchPath);
  return kind === 'jj'
    ? jjState.listJjRepositoryHistory(launchPath, limit, source)
    : gitState.listRepositoryHistory(launchPath, limit, source);
};

/** @param {string} launchPath @param {import('../core/types.ts').DiffSectionContentRequest} request */
const readDiffSectionContent = async (launchPath, request) => {
  const { kind } = getRepositoryBackend(launchPath);
  return kind === 'jj'
    ? jjState.readJjDiffSectionContent(launchPath, request)
    : gitState.readDiffSectionContent(launchPath, request);
};

/** @param {string} launchPath @param {import('../core/types.ts').DiffImageContentRequest} request */
const readDiffImageContent = async (launchPath, request) => {
  const { kind } = getRepositoryBackend(launchPath);
  return kind === 'jj'
    ? jjState.readJjDiffImageContent(launchPath, request)
    : gitState.readDiffImageContent(launchPath, request);
};

/** @param {string} launchPath */
const readRepositoryIdentity = async (launchPath) => {
  const { kind } = getRepositoryBackend(launchPath);
  return kind === 'jj' ? jjState.readJjIdentity(launchPath) : gitState.readGitIdentity(launchPath);
};

/** @param {string} launchPath @param {Iterable<string>} [exactPaths] */
const readRepositoryChangeSignature = async (launchPath, exactPaths) => {
  const { discovered, kind } = getRepositoryBackend(launchPath);
  return kind === 'jj'
    ? jjState.readJjWatcherSnapshot(discovered.workspaceRoot, exactPaths)
    : gitState.readRepositoryChangeSignature(launchPath, exactPaths);
};

/**
 * @param {string} repositoryRoot
 * @param {Iterable<string>} [exactPaths]
 * @param {Iterable<string>} [knownDirtyPaths]
 */
const readRepositoryWatcherSnapshotForRoot = async (
  repositoryRoot,
  exactPaths = [],
  knownDirtyPaths = [],
) => {
  const { discovered, kind } = getRepositoryBackend(repositoryRoot);
  return kind === 'jj'
    ? jjState.readJjWatcherSnapshot(discovered.workspaceRoot, exactPaths)
    : readRepositoryWatcherSnapshot(repositoryRoot, exactPaths, knownDirtyPaths);
};

/**
 * @param {string} repoPath
 * @param {import('../core/types.ts').WalkthroughCommitRequest} request
 * @param {(chunk: string) => void} [onOutput]
 */
const createRepositoryWalkthroughCommit = async (repoPath, request, onOutput) => {
  const { kind } = getRepositoryBackend(repoPath);
  return kind === 'jj'
    ? jjState.createJjWalkthroughCommit(repoPath, request)
    : createWalkthroughCommit(repoPath, request, onOutput);
};

module.exports = {
  ...gitState,
  createWalkthroughCommit: createRepositoryWalkthroughCommit,
  discoverRepository,
  listRepositoryHistory,
  readDiffImageContent,
  readDiffSectionContent,
  readRepositoryChangeSignature,
  readRepositoryIdentity,
  readRepositoryState,
  readRepositoryWatcherSnapshot: readRepositoryWatcherSnapshotForRoot,
  readWalkthroughRepositoryState,
};
