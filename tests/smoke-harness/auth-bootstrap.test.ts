import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { classifyAuthPage, authDiagnosticRecord } from '../../scripts/smoke/auth-diagnostics.mjs';
import { decideAuthBootstrapState, BOOTSTRAP_STATES } from '../../scripts/smoke/bootstrap-state.mjs';
import { validateChromeProfilePath } from '../../scripts/smoke/chrome-profile-guard.mjs';
import { findUnpackedExtensionIdFromPreferences } from '../../scripts/smoke/chrome-extension-profile.mjs';
import { mayTerminateOwnedChrome, reserveLoopbackPort, validateCdpEndpoint } from '../../scripts/smoke/real-chrome.mjs';
import { requireInstalledExtensionId, validateLoadedExtensionEntry, verifyRuntimeBuildId } from '../../scripts/smoke/browser.mjs';

describe('auth bootstrap decisions', () => {
  it('requires auth when no ChatGPT session exists', () => {
    expect(decideAuthBootstrapState({ chromeProfileReady: true, chatgptSessionValid: false, extensionInstalled: false, hasBinding: false }))
      .toBe(BOOTSTRAP_STATES.AUTH_REQUIRED);
  });

  it('skips auth when an existing ChatGPT session is valid', () => {
    expect(decideAuthBootstrapState({ chromeProfileReady: true, chatgptSessionValid: true, extensionInstalled: true, hasBinding: true }))
      .toBe(BOOTSTRAP_STATES.RUN_SMOKE);
  });

  it('classifies the known Google unsafe-browser failure', () => {
    expect(classifyAuthPage({
      url: 'https://accounts.google.com/v3/signin/challenge',
      visibleText: '无法登录 此浏览器或应用可能不安全。请尝试使用其他浏览器。'
    })).toBe('GOOGLE_OAUTH_UNSAFE_BROWSER');
  });

  it('treats an expired ChatGPT session as auth required', () => {
    expect(classifyAuthPage({ url: 'https://chatgpt.com/auth/login', visibleText: 'Log in to ChatGPT' })).toBe('AUTH_REQUIRED');
  });
});

describe('dedicated branded Chrome profile safety', () => {
  const smokeRoot = path.resolve('tmp', '.csg-smoke');

  it('accepts the dedicated chrome-profile with its sentinel', () => {
    expect(validateChromeProfilePath({ smokeRoot, chromeProfileDir: path.join(smokeRoot, 'chrome-profile'), sentinelPresent: true }).ok).toBe(true);
  });

  it('refuses a daily Chrome profile', () => {
    const local = path.resolve('tmp', 'LocalAppData');
    const daily = path.join(local, 'Google', 'Chrome', 'User Data', 'Default');
    const result = validateChromeProfilePath({ smokeRoot, chromeProfileDir: daily, sentinelPresent: true, env: { LOCALAPPDATA: local }, platform: 'win32' });
    expect(result.ok).toBe(false);
    expect(result.failures).toContain('DAILY_CHROME_PROFILE_REFUSED');
  });

  it('refuses a missing auth-profile sentinel', () => {
    const result = validateChromeProfilePath({ smokeRoot, chromeProfileDir: path.join(smokeRoot, 'chrome-profile'), sentinelPresent: false });
    expect(result.failures).toContain('AUTH_PROFILE_SENTINEL_MISSING');
  });
});

describe('CDP isolation and owned process lifecycle', () => {
  it('accepts only a localhost CDP endpoint', () => {
    expect(validateCdpEndpoint('http://127.0.0.1:9222')).toEqual({ ok: true, endpoint: 'http://127.0.0.1:9222' });
  });

  it('refuses an externally reachable CDP endpoint', () => {
    expect(validateCdpEndpoint('http://0.0.0.0:9222').ok).toBe(false);
    expect(validateCdpEndpoint('http://192.168.1.8:9222').ok).toBe(false);
  });

  it('reserves a random loopback port for Chrome CDP without exposing it externally', async () => {
    const port = await reserveLoopbackPort();
    expect(Number.isInteger(port)).toBe(true);
    expect(port).toBeGreaterThan(0);
    expect(validateCdpEndpoint(`http://127.0.0.1:${port}`).ok).toBe(true);
  });

  it('only permits terminating the PID owned by the harness', () => {
    expect(mayTerminateOwnedChrome({ ownedPid: 1234, targetPid: 1234 })).toBe(true);
    expect(mayTerminateOwnedChrome({ ownedPid: 1234, targetPid: 4321 })).toBe(false);
  });
});

describe('persistent unpacked extension detection', () => {
  it('finds the Session Guard extension only when its path matches dist', () => {
    const dist = path.resolve('repo', 'dist');
    const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
    const prefs = { extensions: { settings: { [extensionId]: { path: dist } } } };
    expect(findUnpackedExtensionIdFromPreferences(prefs, dist)).toBe(extensionId);
    expect(findUnpackedExtensionIdFromPreferences(prefs, path.resolve('other', 'dist'))).toBeNull();
  });

  it('accepts only an enabled extension loaded from the expected dist path', () => {
    const dist = path.resolve('repo', 'dist');
    const id = 'abcdefghijklmnopabcdefghijklmnop';
    expect(validateLoadedExtensionEntry({ id, path: dist, enabled: true }, id, dist)).toEqual({ extensionId: id, path: dist, enabled: true });
    expect(() => validateLoadedExtensionEntry({ id, path: path.resolve('other', 'dist'), enabled: true }, id, dist)).toThrow('SESSION_GUARD_EXTENSION_PATH_MISMATCH');
    expect(() => validateLoadedExtensionEntry({ id, path: dist, enabled: false }, id, dist)).toThrow('SESSION_GUARD_EXTENSION_DISABLED');
  });

  it('reports a missing persistent Session Guard extension clearly', () => {
    expect(() => requireInstalledExtensionId(null)).toThrow('SESSION_GUARD_EXTENSION_NOT_INSTALLED');
  });

  it('refuses a loaded extension whose runtime build id is stale', () => {
    expect(() => verifyRuntimeBuildId('old-build', 'new-build')).toThrow('EXTENSION_RUNTIME_BUILD_ID_MISMATCH');
  });

  it('confirms the loaded extension when the runtime build matches current HEAD', () => {
    expect(verifyRuntimeBuildId('abc123', 'abc123')).toBe('abc123');
  });

  it('records auth diagnostics without account, cookie, or HTML payloads', () => {
    const record = authDiagnosticRecord({
      code: 'CHATGPT_SESSION_NOT_ESTABLISHED',
      browser: 'Google Chrome',
      browserVersion: '152.0.7977.64',
      launchMode: 'normal-auth',
      automationState: 'none',
      chatgptSession: 'missing'
    });
    expect(record.containsAccountIdentity).toBe(false);
    expect(record.containsCookieValues).toBe(false);
    expect(record.containsPageHtml).toBe(false);
    expect(JSON.stringify(record)).not.toMatch(/cookie.*=/i);
  });
});
