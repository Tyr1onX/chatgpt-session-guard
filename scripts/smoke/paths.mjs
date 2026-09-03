import path from 'node:path';

export function smokePaths(root = process.cwd()) {
  const smokeRoot = path.resolve(root, '.csg-smoke');
  return {
    root: path.resolve(root),
    smokeRoot,
    profileDir: path.join(smokeRoot, 'profile'),
    configPath: path.join(smokeRoot, 'config.json'),
    sentinelPath: path.join(smokeRoot, 'TEST_PROFILE_SENTINEL'),
    artifactsDir: path.join(smokeRoot, 'artifacts'),
    distDir: path.resolve(root, 'dist')
  };
}

export function createRunId(now = new Date()) {
  return now.toISOString().replace(/[:.]/g, '-');
}
