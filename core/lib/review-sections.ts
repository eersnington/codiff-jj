import type { DiffSection, ReviewSource } from '../types.ts';

/** Live working-copy sections that can be edited or committed. */
export const isWorkingCopySectionKind = (kind: DiffSection['kind']) =>
  kind === 'staged' || kind === 'unstaged' || kind === 'working-copy';

export const isLiveReviewSource = (source: ReviewSource) =>
  source.type === 'working-tree' || source.type === 'branch-working-tree';

export const isCommittableReviewSource = (source: ReviewSource) => source.type === 'working-tree';
