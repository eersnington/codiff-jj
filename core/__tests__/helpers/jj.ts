import { execFile } from 'node:child_process';
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
