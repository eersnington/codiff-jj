import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vite-plus/test';

const require = createRequire(import.meta.url);

let home = '';
let previousHome: string | undefined;

beforeEach(() => {
  previousHome = process.env.HOME;
  home = mkdtempSync(join(tmpdir(), 'codiff-walkthrough-store-'));
  process.env.HOME = home;
});

afterEach(() => {
  if (previousHome == null) {
    delete process.env.HOME;
  } else {
    process.env.HOME = previousHome;
  }
  rmSync(home, { force: true, recursive: true });
});

const loadStore = () => {
  const path = require.resolve('../walkthrough-store.cjs');
  delete require.cache[path];
  return require('../walkthrough-store.cjs') as typeof import('../walkthrough-store.cjs');
};

const sampleWalkthrough = () =>
  ({
    agent: 'claude',
    chapters: [
      {
        blurb: '',
        icon: 'gear',
        id: 'runtime',
        stops: [
          {
            added: 1,
            deleted: 1,
            hunkIds: ['src/app.ts:staged:h1'],
            hunks: [
              {
                added: 1,
                deleted: 1,
                id: 'src/app.ts:staged:h1',
                path: 'src/app.ts',
                status: 'modified',
              },
            ],
            id: 'behavior',
            importance: 'normal',
            prose: 'Review the behavior.',
            title: 'Behavior',
          },
        ],
        title: 'Runtime',
      },
    ],
    focus: 'Walk through the change.',
    generatedAt: '2026-01-01T00:00:00.000Z',
    kind: 'narrative',
    repo: { info: { branch: 'main', vcs: 'git' }, root: '/repo' },
    source: { type: 'working-tree' },
    support: [],
    title: 'Walkthrough',
    version: 5,
  }) as never;

test('round-trips an exact cache entry', () => {
  const store = loadStore();
  const cacheKey = 'exact-input-key';
  store.writeStoredWalkthrough(cacheKey, sampleWalkthrough());

  expect(existsSync(store.getWalkthroughStorePath(cacheKey))).toBe(true);
  expect(store.readStoredWalkthrough(cacheKey)?.title).toBe('Walkthrough');
  expect(store.readStoredWalkthrough('different-input-key')).toBe(null);
});

test('replaces an existing cache entry', () => {
  const store = loadStore();
  const cacheKey = 'exact-input-key';
  store.writeStoredWalkthrough(cacheKey, sampleWalkthrough());
  store.writeStoredWalkthrough(cacheKey, {
    ...sampleWalkthrough(),
    title: 'Updated walkthrough',
  });

  expect(store.readStoredWalkthrough(cacheKey)?.title).toBe('Updated walkthrough');
});

test('rejects malformed and incompatible cache records', () => {
  const store = loadStore();
  const cacheKey = 'exact-input-key';
  const path = store.getWalkthroughStorePath(cacheKey);
  mkdirSync(join(home, '.codiff', 'walkthroughs'), { recursive: true });

  writeFileSync(path, '{ not json');
  expect(store.readStoredWalkthrough(cacheKey)).toBe(null);

  writeFileSync(
    path,
    JSON.stringify({
      cacheKey,
      version: 2,
      walkthrough: sampleWalkthrough(),
    }),
  );
  expect(store.readStoredWalkthrough(cacheKey)).toBe(null);

  writeFileSync(
    path,
    JSON.stringify({
      cacheKey,
      version: 1,
      walkthrough: { ...sampleWalkthrough(), version: 3 },
    }),
  );
  expect(store.readStoredWalkthrough(cacheKey)).toBe(null);
});
