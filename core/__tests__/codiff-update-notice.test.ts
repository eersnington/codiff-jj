import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vite-plus/test';
import { getUpdateNotice } from '../../bin/update-notice.js';
import { createTemporaryDirectory } from './helpers/resources.ts';

const writeState = async (
  configDir: string,
  state: {
    compatible?: boolean;
    dismissedVersion?: string;
    lastCheckedAt: string;
    latestVersion: string;
  },
) =>
  writeFile(
    join(configDir, 'update-state-codiff-jj.json'),
    JSON.stringify({ compatible: true, ...state }),
  );

test('returns null when the cached release is incompatible', async () => {
  await using directory = await createTemporaryDirectory('codiff-notice-');
  await writeState(directory.path, {
    compatible: false,
    lastCheckedAt: '2026-07-28T10:00:00.000Z',
    latestVersion: '1.9.3',
  });

  expect(getUpdateNotice({ configDir: directory.path, currentVersion: '1.9.2' })).toBeNull();
});

const disableUpdateChecks = (configDir: string) =>
  writeFile(
    join(configDir, 'codiff.jsonc'),
    JSON.stringify({ settings: { checkForUpdates: false } }),
  );

test('returns null without cached update state', async () => {
  await using directory = await createTemporaryDirectory('codiff-notice-');
  expect(getUpdateNotice({ configDir: directory.path, currentVersion: '1.9.2' })).toBeNull();
});

test('announces a newer cached version with both versions', async () => {
  await using directory = await createTemporaryDirectory('codiff-notice-');
  await writeState(directory.path, {
    lastCheckedAt: '2026-07-28T10:00:00.000Z',
    latestVersion: '1.9.3',
  });

  const notice = getUpdateNotice({ configDir: directory.path, currentVersion: '1.9.2' });

  expect(notice).toContain('1.9.2');
  expect(notice).toContain('1.9.3');
  expect(notice).toContain('codiff update');
});

test('returns null when up to date or ahead', async () => {
  await using directory = await createTemporaryDirectory('codiff-notice-');
  await writeState(directory.path, {
    lastCheckedAt: '2026-07-28T10:00:00.000Z',
    latestVersion: '1.9.3',
  });

  expect(getUpdateNotice({ configDir: directory.path, currentVersion: '1.9.3' })).toBeNull();
  expect(getUpdateNotice({ configDir: directory.path, currentVersion: '2.0.0' })).toBeNull();
});

test('returns null for a dismissed version', async () => {
  await using directory = await createTemporaryDirectory('codiff-notice-');
  await writeState(directory.path, {
    dismissedVersion: '1.9.3',
    lastCheckedAt: '2026-07-28T10:00:00.000Z',
    latestVersion: '1.9.3',
  });

  expect(getUpdateNotice({ configDir: directory.path, currentVersion: '1.9.2' })).toBeNull();
});

test('returns null when update notifications are disabled', async () => {
  await using directory = await createTemporaryDirectory('codiff-notice-');
  await writeState(directory.path, {
    lastCheckedAt: '2026-07-28T10:00:00.000Z',
    latestVersion: '1.9.3',
  });
  await disableUpdateChecks(directory.path);

  expect(getUpdateNotice({ configDir: directory.path, currentVersion: '1.9.2' })).toBeNull();
});
