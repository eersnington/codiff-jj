import type {
  RepositoryInfo,
  SharedWalkthroughSnapshot,
  SharedWalkthroughSnapshotV1,
} from '../types.ts';
import { createGitRepositoryInfo } from './repository-info.ts';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value != null;

const isGitRepositoryInfo = (value: unknown): value is Extract<RepositoryInfo, { vcs: 'git' }> =>
  isRecord(value) &&
  value.vcs === 'git' &&
  (value.branch === null || typeof value.branch === 'string');

const isJjRepositoryInfo = (value: unknown): value is Extract<RepositoryInfo, { vcs: 'jj' }> =>
  isRecord(value) &&
  value.vcs === 'jj' &&
  typeof value.changeId === 'string' &&
  typeof value.commitId === 'string' &&
  Array.isArray(value.bookmarks) &&
  value.bookmarks.every((bookmark) => typeof bookmark === 'string');

export const isRepositoryInfo = (value: unknown): value is RepositoryInfo =>
  isGitRepositoryInfo(value) || isJjRepositoryInfo(value);

/** Reads a stored Git v1 walkthrough share as the current snapshot shape. */
export const normalizeSharedWalkthroughSnapshot = (
  snapshot: SharedWalkthroughSnapshot | SharedWalkthroughSnapshotV1,
): SharedWalkthroughSnapshot => {
  if (snapshot.version === 2) {
    return snapshot;
  }

  const { branch, repository, ...rest } = snapshot;
  return {
    ...rest,
    repository: {
      ...repository,
      info: repository.info ?? createGitRepositoryInfo(branch),
    },
    version: 2,
  };
};

export const parseSharedWalkthroughSnapshot = (
  value: unknown,
): SharedWalkthroughSnapshot | null => {
  if (!isRecord(value) || value.kind !== 'codiff-walkthrough-share') {
    return null;
  }
  if (
    value.version === 2 &&
    isRecord(value.repository) &&
    isRepositoryInfo(value.repository.info)
  ) {
    return value as SharedWalkthroughSnapshot;
  }
  if (
    value.version === 1 &&
    (value.branch === null || typeof value.branch === 'string') &&
    isRecord(value.repository)
  ) {
    return normalizeSharedWalkthroughSnapshot(value as SharedWalkthroughSnapshotV1);
  }
  return null;
};
