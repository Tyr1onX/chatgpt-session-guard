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
    distDir: path.resolve(root, 'dist'),
    chromeProfileDir: path.join(smokeRoot, 'chrome-profile'),
    chromeSentinelPath: path.join(smokeRoot, 'CHROME_PROFILE_SENTINEL'),
    chromePreferencesPath: path.join(smokeRoot, 'chrome-profile', 'Default', 'Preferences'),
    authDiagnosticPath: path.join(smokeRoot, 'auth-diagnostic.json')
  };
}

export function createRunId(now = new Date()) {
  return now.toISOString().replace(/[:.]/g, '-');
}
