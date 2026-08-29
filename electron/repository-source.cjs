// @ts-check

const { execFileSync } = require('node:child_process');
const { discoverRepository } = require('./repository-discovery.cjs');

/** @param {string} repositoryPath @param {ReadonlyArray<string>} args */
const gitSucceeds = (repositoryPath, args) => {
  try {
    execFileSync('git', ['-C', repositoryPath, ...args], {
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    return true;
  } catch {
    return false;
  }
};

/** @param {string} repositoryPath @param {ReadonlyArray<string>} args */
const jjOutput = (repositoryPath, args) =>
  execFileSync(
    'jj',
    ['-R', repositoryPath, '--no-pager', '--color', 'never', '--ignore-working-copy', ...args],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    },
  );

/** @param {string} repositoryPath @param {ReadonlyArray<string>} args */
const jjSucceeds = (repositoryPath, args) => {
  try {
    jjOutput(repositoryPath, args);
    return true;
  } catch {
    return false;
  }
};

/** @param {string} repositoryPath */
const isJjRepository = (repositoryPath) => discoverRepository(repositoryPath).kind === 'jj';

/** @param {string} repositoryPath */
const isVersionedRepository = (repositoryPath) =>
  isJjRepository(repositoryPath) || gitSucceeds(repositoryPath, ['rev-parse', '--show-toplevel']);

/** @param {string} repositoryPath @param {string} ref */
const isGitBranchRef = (repositoryPath, ref) =>
  gitSucceeds(repositoryPath, ['show-ref', '--verify', '--quiet', `refs/heads/${ref}`]) ||
  gitSucceeds(repositoryPath, ['show-ref', '--verify', '--quiet', `refs/remotes/${ref}`]);

/** @param {string} repositoryPath @param {string} ref */
const isGitCommitRef = (repositoryPath, ref) =>
  gitSucceeds(repositoryPath, ['rev-parse', '--verify', `${ref}^{commit}`]);

/** @param {string} repositoryPath @param {string} ref */
const isJjBookmark = (repositoryPath, ref) =>
  jjSucceeds(repositoryPath, [
    'log',
    '-r',
    `bookmarks(exact:${JSON.stringify(ref)})`,
    '-n',
    '1',
    '--no-graph',
    '-T',
    'commit_id',
  ]);

const SIMPLE_JJ_REF = /^[A-Za-z0-9@._/-]+$/;

/** @param {string} ref */
const uniqueJjRevisionFallbacks = (ref) =>
  SIMPLE_JJ_REF.test(ref)
    ? [`latest(ancestors(@) & change_id(${ref}))`, `latest(change_id(${ref}))`]
    : [];

/** @param {string} repositoryPath @param {string} ref */
const isJjRevision = (repositoryPath, ref) =>
  jjSucceeds(repositoryPath, ['log', '-r', ref, '-n', '1', '--no-graph', '-T', 'commit_id']) ||
  uniqueJjRevisionFallbacks(ref).some((revset) =>
    jjSucceeds(repositoryPath, ['log', '-r', revset, '-n', '1', '--no-graph', '-T', 'commit_id']),
  );

/**
 * @param {string} repositoryPath
 * @param {string} ref
 * @param {boolean} looksLikeCommit
 * @returns {{branchRef: string} | {commitRef: string} | null}
 */
const resolveSourceCandidate = (repositoryPath, ref, looksLikeCommit) => {
  if (isJjRepository(repositoryPath)) {
    if (looksLikeCommit && isJjRevision(repositoryPath, ref)) {
      return { commitRef: ref };
    }
    if (isJjBookmark(repositoryPath, ref)) {
      return { branchRef: ref };
    }
    if (isJjRevision(repositoryPath, ref) || looksLikeCommit) {
      return { commitRef: ref };
    }
    return null;
  }

  if (looksLikeCommit && isGitCommitRef(repositoryPath, ref)) {
    return { commitRef: ref };
  }
  if (isGitBranchRef(repositoryPath, ref)) {
    return { branchRef: ref };
  }
  if (isGitCommitRef(repositoryPath, ref) || looksLikeCommit) {
    return { commitRef: ref };
  }
  return null;
};

/** @param {string} repositoryPath @param {string} ref */
const isRevision = (repositoryPath, ref) =>
  isJjRepository(repositoryPath)
    ? isJjRevision(repositoryPath, ref)
    : isGitCommitRef(repositoryPath, ref);

/** @param {string} repositoryPath @param {string} ref */
const resolveCommitId = (repositoryPath, ref) => {
  try {
    if (isJjRepository(repositoryPath)) {
      for (const revset of [ref, ...uniqueJjRevisionFallbacks(ref)]) {
        try {
          return jjOutput(repositoryPath, [
            'log',
            '-r',
            revset,
            '-n',
            '1',
            '--no-graph',
            '-T',
            'commit_id',
          ])
            .trim()
            .toLowerCase();
        } catch {
          // Divergent change ids need a unique revset; try the next one.
        }
      }
      return null;
    }
    return execFileSync('git', ['-C', repositoryPath, 'rev-parse', '--verify', `${ref}^{commit}`], {
      encoding: 'utf8',
    })
      .trim()
      .toLowerCase();
  } catch {
    return null;
  }
};

/** @param {string} repositoryPath @param {string} baseRef @param {string} headRef */
const resolveComparisonBase = (repositoryPath, baseRef, headRef) => {
  try {
    if (isJjRepository(repositoryPath)) {
      return jjOutput(repositoryPath, [
        'log',
        '-r',
        `fork_point(${baseRef} | ${headRef})`,
        '-n',
        '1',
        '--no-graph',
        '-T',
        'commit_id',
      ])
        .trim()
        .toLowerCase();
    }
    return execFileSync('git', ['-C', repositoryPath, 'merge-base', baseRef, headRef], {
      encoding: 'utf8',
    })
      .trim()
      .toLowerCase();
  } catch {
    return null;
  }
};

/** @param {string} repositoryPath */
const hasWorkingCopyChanges = (repositoryPath) => {
  try {
    if (isJjRepository(repositoryPath)) {
      return Boolean(
        execFileSync(
          'jj',
          [
            '-R',
            repositoryPath,
            '--no-pager',
            '--color',
            'never',
            'diff',
            '-r',
            '@',
            '--name-only',
          ],
          {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
          },
        ).trim(),
      );
    }
    return Boolean(
      execFileSync(
        'git',
        ['-C', repositoryPath, 'status', '--porcelain=v1', '-z', '--untracked-files=normal'],
        { encoding: 'utf8' },
      ),
    );
  } catch {
    return false;
  }
};

module.exports = {
  gitSucceeds,
  hasWorkingCopyChanges,
  isJjRepository,
  isRevision,
  isVersionedRepository,
  resolveCommitId,
  resolveComparisonBase,
  resolveSourceCandidate,
};
