import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { initializeChromeProfile, assertChromeProfile } from './chrome-profile-guard.mjs';
import { findInstalledSmokeExtensionId } from './chrome-extension-profile.mjs';
import { isLoggedIn, getOrCreateChatPage } from './chatgpt.mjs';
import { closeOwnedChrome, detectChromeVersion, discoverChromeExecutable, launchChromeWithCdp } from './real-chrome.mjs';

const root = process.cwd();
const mode = process.argv[2] ?? '--verify';

if (mode === '--launch-auth') {
  const paths = await initializeChromeProfile(root);
  const chromePath = discoverChromeExecutable();
  const browserVersion = await detectChromeVersion(chromePath);
  const child = spawn(chromePath, [
    `--user-data-dir=${paths.chromeProfileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    'https://chatgpt.com/'
  ], {
    stdio: 'ignore',
    windowsHide: true,
    detached: true
  });
  child.unref();
  console.log(JSON.stringify({
    code: 'AUTH_BROWSER_OPENED',
    browser: 'Google Chrome',
    browserVersion,
    launchMode: 'normal-auth',
    automationState: 'none',
    profileKind: 'dedicated-chrome-profile'
  }));
  process.exit(0);
}

if (mode === '--verify') {
  const paths = await assertChromeProfile(root);
  const chromePath = discoverChromeExecutable();
  const browserVersion = await detectChromeVersion(chromePath);
  const launched = await launchChromeWithCdp({ chromePath, profileDir: paths.chromeProfileDir });
  let browser;
  try {
    browser = await chromium.connectOverCDP(launched.endpoint);
    const context = browser.contexts()[0];
    if (!context) throw new Error('CDP_DEFAULT_CONTEXT_MISSING');
    const page = await getOrCreateChatPage(context);
    await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(1200);
    const loggedIn = await isLoggedIn(page);
    const extensionId = await findInstalledSmokeExtensionId(root);
    console.log(JSON.stringify({
      code: loggedIn ? 'CHATGPT_SESSION_ESTABLISHED' : 'CHATGPT_SESSION_NOT_ESTABLISHED',
      browser: 'Google Chrome',
      browserVersion,
      launchMode: 'cdp-verify',
      automationState: 'cdp-after-auth',
      cdpHost: '127.0.0.1',
      loggedIn,
      extensionInstalled: Boolean(extensionId)
    }));
  } finally {
    await browser?.close().catch(() => undefined);
    await closeOwnedChrome(launched.child);
  }
}
