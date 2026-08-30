import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createTemporaryDirectory } from './resources.ts';

const execFileAsync = promisify(execFile);

export const getJjTestEnvironment = (): NodeJS.ProcessEnv => ({
  ...process.env,
  GIT_AUTHOR_EMAIL: 'codiff@example.com',
  GIT_AUTHOR_NAME: 'Codiff Test',
  GIT_COMMITTER_EMAIL: 'codiff@example.com',
  GIT_COMMITTER_NAME: 'Codiff Test',
  JJ_EMAIL: 'codiff@example.com',
  JJ_USER: 'Codiff Test',
});

export const jj = async (repo: string, args: ReadonlyArray<string>) => {
  const { stdout } = await execFileAsync(
    'jj',
    ['-R', repo, '--no-pager', '--color', 'never', ...args],
    {
      encoding: 'utf8',
      env: getJjTestEnvironment(),
    },
  );
  return stdout;
};

export const createJjTestRepository = async (prefix = 'codiff-jj-') => {
  const directory = await createTemporaryDirectory(prefix);
  await execFileAsync('jj', ['git', 'init', '--colocate', directory.path], {
    encoding: 'utf8',
    env: getJjTestEnvironment(),
  });
  await jj(directory.path, ['config', 'set', '--repo', 'user.name', 'Codiff Test']);
  await jj(directory.path, ['config', 'set', '--repo', 'user.email', 'codiff@example.com']);
  return directory;
};

/** Make `@-` share its change id with a second visible commit. */
export const createDivergentChange = async (repo: string) => {
  const commitId = (
    await jj(repo, ['log', '-r', '@-', '-n', '1', '--no-graph', '-T', 'commit_id'])
  ).trim();
  const { stdout: raw } = await execFileAsync('git', ['-C', repo, 'cat-file', 'commit', commitId], {
    encoding: 'utf8',
  });
  const tree = /^tree (.+)$/m.exec(raw)?.[1];
  const changeId = /^change-id (.+)$/m.exec(raw)?.[1];
  if (!tree || !changeId) {
    throw new Error('Could not read the change id to duplicate.');
  }
  const payload = [
    `tree ${tree}`,
    'author Codiff Test <codiff@example.com> 1577836800 +0000',
    'committer Codiff Test <codiff@example.com> 1577923200 +0000',
    `change-id ${changeId}`,
    '',
    'divergent copy',
    '',
  ].join('\n');
  const objectPath = join(repo, '.divergent-commit');
  await writeFile(objectPath, payload);
  const { stdout: duplicate } = await execFileAsync(
    'git',
    ['-C', repo, 'hash-object', '-t', 'commit', '-w', objectPath],
    { encoding: 'utf8' },
  );
  await execFileAsync('git', ['-C', repo, 'update-ref', 'refs/heads/divergent', duplicate.trim()]);
  await jj(repo, ['git', 'import']);
  return { changeId, originalCommitId: commitId };
};
