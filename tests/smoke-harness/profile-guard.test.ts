import path from 'node:path';
import { validateDedicatedProfilePath } from '../../scripts/smoke/profile-guard.mjs';

describe('smoke profile safety guard', () => {
  const root = path.resolve('C:/work/chatgpt-session-guard/.csg-smoke');

  it('accepts only the dedicated profile with a sentinel', () => {
    const result = validateDedicatedProfilePath({
      smokeRoot: root,
      profileDir: path.join(root, 'profile'),
      sentinelPresent: true,
      env: {}
    });
    expect(result).toEqual({ ok: true, failures: [] });
  });

  it('refuses a missing sentinel', () => {
    const result = validateDedicatedProfilePath({
      smokeRoot: root,
      profileDir: path.join(root, 'profile'),
      sentinelPresent: false,
      env: {}
    });
    expect(result.ok).toBe(false);
    expect(result.failures).toContain('TEST_PROFILE_SENTINEL_MISSING');
  });

  it('refuses a path escape', () => {
    const result = validateDedicatedProfilePath({
      smokeRoot: root,
      profileDir: path.resolve(root, '..', 'profile'),
      sentinelPresent: true,
      env: {}
    });
    expect(result.ok).toBe(false);
    expect(result.failures).toContain('PROFILE_PATH_OUTSIDE_SMOKE_ROOT');
  });

  it('refuses a Chrome User Data tree even when shaped like a smoke root', () => {
    const localAppData = path.resolve('C:/Users/test/AppData/Local');
    const dailyRoot = path.join(localAppData, 'Google', 'Chrome', 'User Data');
    const result = validateDedicatedProfilePath({
      smokeRoot: dailyRoot,
      profileDir: path.join(dailyRoot, 'profile'),
      sentinelPresent: true,
      env: { LOCALAPPDATA: localAppData }
    });
    expect(result.ok).toBe(false);
    expect(result.failures).toContain('DEFAULT_BROWSER_PROFILE_REFUSED');
  });
});
