// @ts-check

const { existsSync } = require('node:fs');
const { dirname, join, resolve } = require('node:path');

/**
 * @typedef {{kind: 'git'; workspaceRoot: string} | {kind: 'jj'; workspaceRoot: string} | {kind: 'none'; workspaceRoot: string}} DiscoveredRepository
 */

/**
 * Finds the nearest version-control workspace. A `.jj` directory wins over
 * `.git` at the same path so colocated Jujutsu repositories are not opened as Git.
 *
 * @param {string} launchPath
 * @returns {DiscoveredRepository}
 */
const discoverRepository = (launchPath) => {
  const resolvedLaunchPath = resolve(launchPath);
  let current = resolvedLaunchPath;
  while (true) {
    if (existsSync(join(current, '.jj'))) {
      return { kind: 'jj', workspaceRoot: current };
    }
    if (existsSync(join(current, '.git'))) {
      return { kind: 'git', workspaceRoot: current };
    }
    const parent = dirname(current);
    if (parent === current) {
      return { kind: 'none', workspaceRoot: resolvedLaunchPath };
    }
    current = parent;
  }
};

module.exports = {
  discoverRepository,
};
