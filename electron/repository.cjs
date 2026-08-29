// @ts-check

const gitState = require('./git-state.cjs');
const { discoverRepository } = require('./repository-discovery.cjs');
const { createWalkthroughCommit } = require('./walkthrough-commit.cjs');

/**
 * @typedef {import('../core/types.ts').ReviewSource} ReviewSource
 */

const unsupportedJujutsuError = () =>
  new Error('Codiff found a Jujutsu repository, but Jujutsu support is not available yet.');

/** @param {string} launchPath */
const requireGitBackend = (launchPath) => {
  if (discoverRepository(launchPath).kind === 'jj') {
    throw unsupportedJujutsuError();
  }
};

/** @param {string} launchPath @param {ReviewSource} [source] @param {{showWhitespace?: boolean}} [options] */
const readRepositoryState = async (launchPath, source, options) => {
  requireGitBackend(launchPath);
  return gitState.readRepositoryState(launchPath, source, options);
};

/** @param {string} launchPath @param {ReviewSource} [source] @param {{showWhitespace?: boolean}} [options] */
const readWalkthroughRepositoryState = async (launchPath, source, options) => {
  requireGitBackend(launchPath);
  return gitState.readWalkthroughRepositoryState(launchPath, source, options);
};

/** @param {string} launchPath @param {number} [limit] @param {ReviewSource} [source] */
const listRepositoryHistory = async (launchPath, limit, source) => {
  requireGitBackend(launchPath);
  return gitState.listRepositoryHistory(launchPath, limit, source);
};

/** @param {string} launchPath @param {import('../core/types.ts').DiffSectionContentRequest} request */
const readDiffSectionContent = async (launchPath, request) => {
  requireGitBackend(launchPath);
  return gitState.readDiffSectionContent(launchPath, request);
};

/** @param {string} launchPath @param {import('../core/types.ts').DiffImageContentRequest} request */
const readDiffImageContent = async (launchPath, request) => {
  requireGitBackend(launchPath);
  return gitState.readDiffImageContent(launchPath, request);
};

/** @param {string} launchPath */
const readRepositoryIdentity = async (launchPath) => {
  requireGitBackend(launchPath);
  return gitState.readGitIdentity(launchPath);
};

/** @param {string} launchPath @param {Iterable<string>} [exactPaths] */
const readRepositoryChangeSignature = async (launchPath, exactPaths) => {
  requireGitBackend(launchPath);
  return gitState.readRepositoryChangeSignature(launchPath, exactPaths);
};

module.exports = {
  ...gitState,
  createWalkthroughCommit,
  discoverRepository,
  listRepositoryHistory,
  readDiffImageContent,
  readDiffSectionContent,
  readRepositoryChangeSignature,
  readRepositoryIdentity,
  readRepositoryState,
  readWalkthroughRepositoryState,
};
