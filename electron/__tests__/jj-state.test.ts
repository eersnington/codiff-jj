import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { expect, test } from 'vite-plus/test';
import {
  createDivergentChange,
  createJjTestRepository,
  jj,
} from '../../core/__tests__/helpers/jj.ts';
import type { RepositoryState, ReviewSource } from '../../core/types.ts';

const require = createRequire(import.meta.url);
const {
  createWalkthroughCommit,
  listRepositoryHistory,
  readDiffSectionContent,
  readRepositoryState,
} = require('../repository.cjs') as {
  createWalkthroughCommit: (
    repoPath: string,
    request: { body?: string; paths?: ReadonlyArray<string>; subject?: string },
  ) => Promise<{ revision: string; status: 'committed' } | { reason: string; status: 'failed' }>;
  listRepositoryHistory: (
    launchPath: string,
    limit?: number,
    source?: ReviewSource,
  ) => Promise<{ entries: Array<{ ref: string; subject: string }>; root: string }>;
  readDiffSectionContent: (
    launchPath: string,
    request: { force?: boolean; kind: string; path: string; source?: ReviewSource },
  ) => Promise<{ kind: string; newFile?: { contents: string }; path?: string }>;
  readRepositoryState: (launchPath: string, source?: ReviewSource) => Promise<RepositoryState>;
};

test('reads working-copy changes from a Jujutsu repository', async () => {
  await using repo = await createJjTestRepository();
  await writeFile(join(repo.path, 'notes.txt'), 'hello\n');

  const state = await readRepositoryState(repo.path);

  expect(state.repository.vcs).toBe('jj');
  expect(state.root).toContain('codiff-jj-');
  expect(state.files.map((file) => file.path)).toEqual(['notes.txt']);
  expect(state.files[0]?.status).toBe('added');
  expect(state.files[0]?.sections.map((section) => section.kind)).toEqual(['working-copy']);
  expect(state.files[0]?.sections[0]?.patch).toContain('+hello');
});

test('prefers Jujutsu in a colocated workspace', async () => {
  await using repo = await createJjTestRepository();
  await writeFile(join(repo.path, 'tracked.txt'), 'jj owns this\n');

  const state = await readRepositoryState(repo.path);

  expect(state.repository.vcs).toBe('jj');
  expect(state.source).toEqual({ type: 'working-tree' });
});

test('opens a named bookmark comparison', async () => {
  await using repo = await createJjTestRepository();
  await writeFile(join(repo.path, 'base.txt'), 'base\n');
  await jj(repo.path, ['commit', '-m', 'base']);
  await jj(repo.path, ['bookmark', 'create', 'main', '-r', '@-']);
  await writeFile(join(repo.path, 'feature.txt'), 'feature\n');
  await jj(repo.path, ['commit', '-m', 'feature']);

  const state = await readRepositoryState(repo.path, { ref: 'main', type: 'branch' });

  expect(state.source.type).toBe('branch-diff');
  expect(state.files.map((file) => file.path)).toContain('feature.txt');
});

test('commits selected working-copy files', async () => {
  await using repo = await createJjTestRepository();
  await writeFile(join(repo.path, 'keep.txt'), 'keep\n');
  await writeFile(join(repo.path, 'later.txt'), 'later\n');

  const result = await createWalkthroughCommit(repo.path, {
    paths: ['keep.txt'],
    subject: 'Keep this file',
  });

  expect(result).toMatchObject({ status: 'committed' });
  if (result.status !== 'committed') {
    return;
  }
  expect(result.revision.length).toBeGreaterThan(0);
  const committedFiles = await jj(repo.path, ['diff', '-r', '@-', '--name-only', '--no-pager']);
  expect(committedFiles).toContain('keep.txt');
  expect(committedFiles).not.toContain('later.txt');
});

test('loads working-copy file contents on demand', async () => {
  await using repo = await createJjTestRepository();
  await mkdir(join(repo.path, 'src'), { recursive: true });
  await writeFile(join(repo.path, 'src/app.ts'), 'export const value = 1;\n');

  const state = await readRepositoryState(repo.path);
  const file = state.files[0];
  expect(file?.sections[0]?.newFile).toBeUndefined();

  const section = await readDiffSectionContent(repo.path, {
    force: true,
    kind: 'working-copy',
    path: 'src/app.ts',
    source: { type: 'working-tree' },
  });
  expect(section.newFile?.contents).toBe('export const value = 1;\n');
});

test('lists committed ancestors and nearby jj log heads', async () => {
  await using repo = await createJjTestRepository();
  await writeFile(join(repo.path, 'a.txt'), 'a\n');
  await jj(repo.path, ['commit', '-m', 'a']);
  await writeFile(join(repo.path, 'b.txt'), 'b\n');
  await jj(repo.path, ['commit', '-m', 'b']);
  await jj(repo.path, ['new', '-r', '@--']);
  await writeFile(join(repo.path, 'c.txt'), 'c\n');
  await jj(repo.path, ['commit', '-m', 'side']);

  const history = await listRepositoryHistory(repo.path, 20);
  const subjects = history.entries.map((entry) => entry.subject);

  expect(subjects).toContain('a');
  expect(subjects).toContain('b');
  expect(subjects).toContain('side');
});

test('opens a divergent change by change id', async () => {
  await using repo = await createJjTestRepository();
  await writeFile(join(repo.path, 'notes.txt'), 'hello\n');
  await jj(repo.path, ['commit', '-m', 'one']);
  const { changeId, originalCommitId } = await createDivergentChange(repo.path);

  const state = await readRepositoryState(repo.path, { ref: changeId, type: 'commit' });

  expect(state.repository.vcs).toBe('jj');
  expect(state.source).toMatchObject({ type: 'commit' });
  expect(state.source.type === 'commit' ? state.source.ref : null).toBe(originalCommitId);
  expect(state.files.map((file) => file.path)).toContain('notes.txt');

  const history = await listRepositoryHistory(repo.path);
  const original = history.entries.find((entry) => entry.subject === 'one');
  expect(original?.ref).toBe(originalCommitId);
});
