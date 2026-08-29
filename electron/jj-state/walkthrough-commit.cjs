// @ts-check

const {
  quoteJjFileset,
  jj,
  readJjCheckoutIdentity,
  validateRepositoryPath,
} = require('./common.cjs');

/**
 * @typedef {import('../../core/types.ts').WalkthroughCommitRequest} WalkthroughCommitRequest
 * @typedef {import('../../core/types.ts').WalkthroughCommitResult} WalkthroughCommitResult
 */

/**
 * @param {string} repoPath
 * @param {WalkthroughCommitRequest} request
 * @returns {Promise<WalkthroughCommitResult>}
 */
const createJjWalkthroughCommit = async (repoPath, request) => {
  const subject = typeof request?.subject === 'string' ? request.subject.trim() : '';
  if (!subject) {
    return { reason: 'A commit subject is required.', status: 'failed' };
  }

  let paths;
  try {
    paths = [...new Set((Array.isArray(request?.paths) ? request.paths : []).map(String))]
      .filter(Boolean)
      .map((path) => validateRepositoryPath(path));
  } catch {
    return { reason: 'A selected file path is invalid.', status: 'failed' };
  }
  if (paths.length === 0) {
    return { reason: 'Select at least one file to commit.', status: 'failed' };
  }

  const body = typeof request?.body === 'string' ? request.body.trim() : '';
  const message = body ? `${subject}\n\n${body}` : subject;

  try {
    await jj(repoPath, ['commit', '-m', message, ...paths.map(quoteJjFileset)], {
      snapshot: true,
    });
    const committed = await readJjCheckoutIdentity(repoPath, '@-');
    return { revision: committed.changeId, status: 'committed' };
  } catch (error) {
    return {
      reason: error instanceof Error ? error.message : String(error),
      status: 'failed',
    };
  }
};

module.exports = {
  createJjWalkthroughCommit,
};
