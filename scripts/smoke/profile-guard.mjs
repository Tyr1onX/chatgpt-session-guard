import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { smokePaths } from './paths.mjs';

export const TEST_PROFILE_SENTINEL = 'CHATGPT_SESSION_GUARD_DEDICATED_SMOKE_PROFILE_V1';

function normalize(value) {
  return path.resolve(value).replace(/[\\/]+$/, '').toLowerCase();
}

function inside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function knownDailyBrowserRoots(env = process.env) {
  const roots = [];
  if (env.LOCALAPPDATA) {
    roots.push(path.join(env.LOCALAPPDATA, 'Google', 'Chrome', 'User Data'));
    roots.push(path.join(env.LOCALAPPDATA, 'Microsoft', 'Edge', 'User Data'));
    roots.push(path.join(env.LOCALAPPDATA, 'Chromium', 'User Data'));
  }
  if (process.platform === 'darwin') {
    roots.push(path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome'));
    roots.push(path.join(os.homedir(), 'Library', 'Application Support', 'Microsoft Edge'));
    roots.push(path.join(os.homedir(), 'Library', 'Application Support', 'Chromium'));
  }
  if (process.platform === 'linux') {
    roots.push(path.join(os.homedir(), '.config', 'google-chrome'));
    roots.push(path.join(os.homedir(), '.config', 'chromium'));
    roots.push(path.join(os.homedir(), '.config', 'microsoft-edge'));
  }
  return roots;
}

export function validateDedicatedProfilePath({ smokeRoot, profileDir, sentinelPresent, env = process.env }) {
  const failures = [];
  const resolvedRoot = path.resolve(smokeRoot);
  const resolvedProfile = path.resolve(profileDir);

  if (!inside(resolvedRoot, resolvedProfile)) failures.push('PROFILE_PATH_OUTSIDE_SMOKE_ROOT');
  if (normalize(resolvedProfile) !== normalize(path.join(resolvedRoot, 'profile'))) {
    failures.push('PROFILE_PATH_NOT_DEDICATED_PROFILE');
  }
  if (!sentinelPresent) failures.push('TEST_PROFILE_SENTINEL_MISSING');

  const profileLower = normalize(resolvedProfile);
  for (const root of knownDailyBrowserRoots(env)) {
    const daily = normalize(root);
    if (profileLower === daily || profileLower.startsWith(`${daily}${path.sep.toLowerCase()}`)) {
      failures.push('DEFAULT_BROWSER_PROFILE_REFUSED');
      break;
    }
  }

  const basename = path.basename(resolvedProfile).toLowerCase();
  if (basename === 'default' || /^profile\s+\d+$/.test(basename)) {
    failures.push('DAILY_PROFILE_NAME_REFUSED');
  }

  return { ok: failures.length === 0, failures };
}

export async function initializeDedicatedProfile(root = process.cwd()) {
  const paths = smokePaths(root);
  await mkdir(paths.profileDir, { recursive: true });
  await mkdir(paths.artifactsDir, { recursive: true });
  await writeFile(paths.sentinelPath, `${TEST_PROFILE_SENTINEL}\n`, { encoding: 'utf8', flag: 'w' });
  return assertDedicatedProfile(root);
}

export async function assertDedicatedProfile(root = process.cwd()) {
  const paths = smokePaths(root);
  let sentinelPresent = false;
  try {
    await access(paths.sentinelPath);
    const value = (await readFile(paths.sentinelPath, 'utf8')).trim();
    sentinelPresent = value === TEST_PROFILE_SENTINEL;
  } catch {
    sentinelPresent = false;
  }

  const result = validateDedicatedProfilePath({
    smokeRoot: paths.smokeRoot,
    profileDir: paths.profileDir,
    sentinelPresent
  });
  if (!result.ok) {
    throw new Error(`REFUSE TO START: ${result.failures.join(', ')}`);
  }
  return paths;
}
