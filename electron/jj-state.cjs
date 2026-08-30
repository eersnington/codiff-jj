// @ts-check

const {
  assertSupportedJjVersion,
  readJjCheckoutIdentity,
  readJjGitRoot,
  readJjWorkspaceRoot,
  snapshotWorkingCopy,
} = require('./jj-state/common.cjs');
const {
  readJjIdentity,
  readJjWatcherSnapshot,
  readJjWorkingCopyImageContent,
  readJjWorkingCopySectionContent,
  readJjWorkingCopyState,
} = require('./jj-state/working-copy.cjs');
const {
  listJjRepositoryHistory,
  readJjBranchState,
  readJjBranchWorkingTreeState,
  readJjCommitState,
  readJjComparisonImageContent,
  readJjComparisonSectionContent,
  readJjRangeState,
  resolveForkPoint,
  resolveSingleRevision,
} = require('./jj-state/comparison.cjs');
const { createJjWalkthroughCommit } = require('./jj-state/walkthrough-commit.cjs');

/**
 * @typedef {import('../core/types.ts').DiffImageContentRequest} DiffImageContentRequest
 * @typedef {import('../core/types.ts').DiffSectionContentRequest} DiffSectionContentRequest
 * @typedef {import('../core/types.ts').RepositoryState} RepositoryState
 * @typedef {import('../core/types.ts').ReviewSource} ReviewSource
 */

/** @param {string} launchPath */
const prepareJjRepository = async (launchPath) => {
  await assertSupportedJjVersion(launchPath);
  return readJjWorkspaceRoot(launchPath);
};

/** @param {string} launchPath @param {ReviewSource} [source] @param {{showWhitespace?: boolean}} [options] */
const readJjRepositoryState = async (
  launchPath,
  source = { type: 'working-tree' },
  options = {},
) => {
  await prepareJjRepository(launchPath);
  if (source.type === 'pull-request') {
    throw new Error('Pull requests are opened through the Git store of a colocated repository.');
  }
  if (source.type === 'commit') {
    return readJjCommitState(launchPath, source.ref);
  }
  if (source.type === 'range') {
    return readJjRangeState(launchPath, source.base, source.head, source.symmetric);
  }
  if (source.type === 'branch' || source.type === 'branch-diff') {
    return readJjBranchState(launchPath, source);
  }
  if (source.type === 'branch-working-tree') {
    return readJjBranchWorkingTreeState(launchPath, source, options);
  }
  return readJjWorkingCopyState(launchPath, {
    eagerContents: false,
    showWhitespace: options.showWhitespace,
  });
};

/** @param {string} launchPath @param {ReviewSource} [source] @param {{showWhitespace?: boolean}} [options] */
const readJjWalkthroughRepositoryState = async (launchPath, source, options = {}) => {
  if (source) {
    return readJjRepositoryState(launchPath, source, options);
  }
  await prepareJjRepository(launchPath);
  await snapshotWorkingCopy(launchPath);
  const workingCopy = await readJjWorkingCopyState(launchPath, {
    eagerContents: false,
    showWhitespace: options.showWhitespace,
  });
  if (workingCopy.files.length > 0) {
    return workingCopy;
  }
  const identity = workingCopy.repository;
  if (identity.vcs === 'jj' && identity.commitId) {
    return readJjCommitState(launchPath, '@-');
  }
  return workingCopy;
};

/** @param {string} launchPath @param {DiffSectionContentRequest} request */
const readJjDiffSectionContent = async (launchPath, request) => {
  await prepareJjRepository(launchPath);
  if (request.kind === 'working-copy' || request.source?.type === 'working-tree') {
    return readJjWorkingCopySectionContent(launchPath, request);
  }
  if (request.source?.type === 'range') {
    return readJjComparisonSectionContent(launchPath, request, {
      from: request.source.symmetric
        ? await resolveForkPoint(launchPath, request.source.base, request.source.head)
        : request.source.base,
      to: request.source.head,
    });
  }
  if (request.source?.type === 'branch' || request.source?.type === 'branch-diff') {
    const source = request.source;
    const from =
      source.type === 'branch-diff'
        ? source.baseRef
        : await resolveForkPoint(launchPath, source.ref, '@');
    const to = source.type === 'branch-diff' ? source.headRef : '@';
    return readJjComparisonSectionContent(launchPath, request, { from, to });
  }
  if (request.source?.type === 'branch-working-tree') {
    return request.kind === 'working-copy'
      ? readJjWorkingCopySectionContent(launchPath, request)
      : readJjComparisonSectionContent(launchPath, request, {
          from: request.source.baseRef,
          to: request.source.headRef,
        });
  }
  const ref = request.source?.type === 'commit' ? request.source.ref : '@';
  const identity = await resolveSingleRevision(launchPath, ref);
  return readJjComparisonSectionContent(launchPath, request, { revision: identity.commitId });
};

/** @param {string} launchPath @param {DiffImageContentRequest} request */
const readJjDiffImageContent = async (launchPath, request) => {
  await prepareJjRepository(launchPath);
  if (request.kind === 'working-copy' || request.source?.type === 'working-tree') {
    return readJjWorkingCopyImageContent(launchPath, request);
  }
  if (request.source?.type === 'range') {
    return readJjComparisonImageContent(launchPath, request, {
      from: request.source.symmetric
        ? await resolveForkPoint(launchPath, request.source.base, request.source.head)
        : request.source.base,
      to: request.source.head,
    });
  }
  if (request.source?.type === 'branch' || request.source?.type === 'branch-diff') {
    const source = request.source;
    const from =
      source.type === 'branch-diff'
        ? source.baseRef
        : await resolveForkPoint(launchPath, source.ref, '@');
    const to = source.type === 'branch-diff' ? source.headRef : '@';
    return readJjComparisonImageContent(launchPath, request, { from, to });
  }
  if (request.source?.type === 'branch-working-tree') {
    return request.kind === 'working-copy'
      ? readJjWorkingCopyImageContent(launchPath, request)
      : readJjComparisonImageContent(launchPath, request, {
          from: request.source.baseRef,
          to: request.source.headRef,
        });
  }
  const ref = request.source?.type === 'commit' ? request.source.ref : '@';
  const identity = await resolveSingleRevision(launchPath, ref);
  return readJjComparisonImageContent(launchPath, request, { revision: identity.commitId });
};

module.exports = {
  createJjWalkthroughCommit,
  listJjRepositoryHistory,
  readJjCheckoutIdentity,
  readJjDiffImageContent,
  readJjDiffSectionContent,
  readJjGitRoot,
  readJjIdentity,
  readJjRepositoryState,
  readJjWalkthroughRepositoryState,
  readJjWatcherSnapshot,
  readJjWorkspaceRoot,
};
