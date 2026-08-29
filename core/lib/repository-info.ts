import type { RepositoryInfo, RepositoryState } from '../types.ts';

/** Git current-checkout identity. */
export const createGitRepositoryInfo = (branch: string | null): RepositoryInfo => ({
  branch,
  vcs: 'git',
});

/** Jujutsu current-checkout identity. */
export const createJjRepositoryInfo = ({
  bookmarks,
  changeId,
  commitId,
}: {
  bookmarks?: ReadonlyArray<string>;
  changeId: string;
  commitId: string;
}): RepositoryInfo => ({
  bookmarks: bookmarks ?? [],
  changeId,
  commitId,
  vcs: 'jj',
});

/** Current branch or bookmark names shown in the review chrome. */
export const getRepositoryCheckoutLabel = (info: RepositoryInfo) =>
  info.vcs === 'git' ? info.branch : (info.bookmarks[0] ?? null);

export const getRepositoryCheckoutLabelFromState = (state: RepositoryState) =>
  getRepositoryCheckoutLabel(state.repository);
