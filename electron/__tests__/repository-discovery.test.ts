import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { expect, test } from 'vite-plus/test';
import { createTemporaryDirectory } from '../../core/__tests__/helpers/resources.ts';

const require = createRequire(import.meta.url);
const { discoverRepository } = require('../repository-discovery.cjs') as {
  discoverRepository: (launchPath: string) => {
    kind: 'git' | 'jj' | 'none';
    workspaceRoot: string;
  };
};
const { readRepositoryState } = require('../repository.cjs') as {
  readRepositoryState: (launchPath: string) => Promise<{ repository: { vcs: string } }>;
};

test('discovers a Git workspace from a nested path', async () => {
  await using directory = await createTemporaryDirectory('codiff-discover-git-');
  await mkdir(join(directory.path, '.git'));
  const nested = join(directory.path, 'src', 'app');
  await mkdir(nested, { recursive: true });

  expect(discoverRepository(nested)).toEqual({
    kind: 'git',
    workspaceRoot: directory.path,
  });
});

test('prefers a colocated Jujutsu workspace over Git', async () => {
  await using directory = await createTemporaryDirectory('codiff-discover-jj-');
  await mkdir(join(directory.path, '.git'));
  await mkdir(join(directory.path, '.jj'));

  expect(discoverRepository(directory.path)).toEqual({
    kind: 'jj',
    workspaceRoot: directory.path,
  });
});

test('reports no repository when neither Git nor Jujutsu metadata exists', async () => {
  await using directory = await createTemporaryDirectory('codiff-discover-none-');

  expect(discoverRepository(directory.path)).toEqual({
    kind: 'none',
    workspaceRoot: directory.path,
  });
});

test('a Jujutsu workspace without a working jj executable fails clearly', async () => {
  await using directory = await createTemporaryDirectory('codiff-repository-jj-');
  await mkdir(join(directory.path, '.jj'));

  await expect(readRepositoryState(directory.path)).rejects.toThrow(/jj/i);
});
