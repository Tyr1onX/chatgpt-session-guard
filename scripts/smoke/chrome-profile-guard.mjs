import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { smokePaths } from './paths.mjs';

export const CHROME_PROFILE_SENTINEL = 'CHATGPT_SESSION_GUARD_DEDICATED_CHROME_PROFILE_V1';

function normalize(value) {
  return path.resolve(value).replace(/[\\/]+$/, '').toLowerCase();
}

function inside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function knownDailyBrowserRoots(env = process.env, platform = process.platform) {
  const roots = [];
  if (env.LOCALAPPDATA) {
    roots.push(path.join(env.LOCALAPPDATA, 'Google', 'Chrome', 'User Data'));
    roots.push(path.join(env.LOCALAPPDATA, 'Microsoft', 'Edge', 'User Data'));
    roots.push(path.join(env.LOCALAPPDATA, 'Chromium', 'User Data'));
  }
  if (platform === 'darwin') {
    roots.push(path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome'));
    roots.push(path.join(os.homedir(), 'Library', 'Application Support', 'Microsoft Edge'));
    roots.push(path.join(os.homedir(), 'Library', 'Application Support', 'Chromium'));
  }
  if (platform === 'linux') {
    roots.push(path.join(os.homedir(), '.config', 'google-chrome'));
    roots.push(path.join(os.homedir(), '.config', 'chromium'));
    roots.push(path.join(os.homedir(), '.config', 'microsoft-edge'));
  }
  return roots;
}

export function validateChromeProfilePath({ smokeRoot, chromeProfileDir, sentinelPresent, env = process.env, platform = process.platform }) {
  const failures = [];
  const resolvedRoot = path.resolve(smokeRoot);
  const resolvedProfile = path.resolve(chromeProfileDir);

  if (!inside(resolvedRoot, resolvedProfile)) failures.push('AUTH_PROFILE_PATH_OUTSIDE_SMOKE_ROOT');
  if (normalize(resolvedProfile) !== normalize(path.join(resolvedRoot, 'chrome-profile'))) {
    failures.push('AUTH_PROFILE_PATH_NOT_DEDICATED_PROFILE');
  }
  if (!sentinelPresent) failures.push('AUTH_PROFILE_SENTINEL_MISSING');

  const profileLower = normalize(resolvedProfile);
  for (const root of knownDailyBrowserRoots(env, platform)) {
    const daily = normalize(root);
    if (profileLower === daily || profileLower.startsWith(`${daily}${path.sep.toLowerCase()}`)) {
      failures.push('DAILY_CHROME_PROFILE_REFUSED');
      break;
    }
  }

  const basename = path.basename(resolvedProfile).toLowerCase();
  if (basename === 'default' || /^profile\s+\d+$/.test(basename) || basename === 'user data') {
    failures.push('DAILY_CHROME_PROFILE_NAME_REFUSED');
  }

  return { ok: failures.length === 0, failures };
}

export async function initializeChromeProfile(root = process.cwd()) {
  const paths = smokePaths(root);
  await mkdir(paths.chromeProfileDir, { recursive: true });
  await writeFile(paths.chromeSentinelPath, `${CHROME_PROFILE_SENTINEL}\n`, { encoding: 'utf8', flag: 'w' });
  return assertChromeProfile(root);
}

export async function assertChromeProfile(root = process.cwd()) {
  const paths = smokePaths(root);
  let sentinelPresent = false;
  try {
    await access(paths.chromeSentinelPath);
    sentinelPresent = (await readFile(paths.chromeSentinelPath, 'utf8')).trim() === CHROME_PROFILE_SENTINEL;
  } catch {
    sentinelPresent = false;
  }

  const result = validateChromeProfilePath({
    smokeRoot: paths.smokeRoot,
    chromeProfileDir: paths.chromeProfileDir,
    sentinelPresent
  });
  if (!result.ok) throw new Error(`REFUSE TO START: ${result.failures.join(', ')}`);
  return paths;
}
