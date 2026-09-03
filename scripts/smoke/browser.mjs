import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { assertDedicatedProfile } from './profile-guard.mjs';
import { assertChromeProfile } from './chrome-profile-guard.mjs';
import { closeOwnedChrome, detectChromeVersion, discoverChromeExecutable, launchChromeWithCdp } from './real-chrome.mjs';

function exec(command, args, root) {
  return execFileSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  }).trim();
}

export function gitIdentity(root = process.cwd()) {
  const commitSha = exec('git', ['rev-parse', 'HEAD'], root);
  const shortSha = exec('git', ['rev-parse', '--short=12', 'HEAD'], root);
  const dirty = exec('git', ['status', '--porcelain'], root).length > 0;
  return { commitSha, buildId: `${shortSha}${dirty ? '-dirty' : ''}` };
}

export function buildDebugExtension(root = process.cwd()) {
  const node = process.execPath;
  execFileSync(node, ['scripts/build.mjs', '--debug'], {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true
  });
  return gitIdentity(root);
}

export async function verifyDebugBuild({ distDir, expectedBuildId }) {
  const manifest = JSON.parse(await readFile(path.join(distDir, 'manifest.json'), 'utf8'));
  const popup = await readFile(path.join(distDir, 'popup.html'), 'utf8');
  const popupScript = await readFile(path.join(distDir, 'popup.js'), 'utf8');
  const mainWorld = await readFile(path.join(distDir, 'main-world.js'), 'utf8');
  const background = await readFile(path.join(distDir, 'background.js'), 'utf8');
  const content = await readFile(path.join(distDir, 'content.js'), 'utf8');

  if (manifest.manifest_version !== 3) throw new Error('EXTENSION_MANIFEST_NOT_MV3');
  if (typeof manifest.version !== 'string' || manifest.version.length === 0) throw new Error('EXTENSION_VERSION_MISSING');
  if (!background.includes(expectedBuildId) && !content.includes(expectedBuildId) && !mainWorld.includes(expectedBuildId)) {
    throw new Error(`DEBUG_BUILD_ID_MISMATCH: expected ${expectedBuildId}`);
  }
  if (popupScript.length === 0 || mainWorld.length === 0 || content.length === 0) throw new Error('DEBUG_BUILD_FILE_EMPTY');
  for (const marker of ['性能测试', '超长会话压力测试', '窗口稳定性诊断']) {
    if (!popup.includes(marker)) throw new Error(`DEBUG_UI_MARKER_MISSING: ${marker}`);
  }
  return { manifestVersion: manifest.manifest_version, extensionVersion: manifest.version };
}

export function requireInstalledExtensionId(extensionId) {
  if (typeof extensionId !== 'string' || !/^[a-p]{32}$/.test(extensionId)) {
    throw new Error('SESSION_GUARD_EXTENSION_NOT_INSTALLED');
  }
  return extensionId;
}

export function verifyRuntimeBuildId(actualBuildId, expectedBuildId) {
  if (typeof actualBuildId !== 'string' || actualBuildId.length === 0) throw new Error('EXTENSION_RUNTIME_BUILD_ID_UNAVAILABLE');
  if (actualBuildId !== expectedBuildId) throw new Error('EXTENSION_RUNTIME_BUILD_ID_MISMATCH');
  return actualBuildId;
}


export function validateLoadedExtensionEntry(entry, extensionId, distDir) {
  if (!entry || entry.id !== extensionId) throw new Error('SESSION_GUARD_EXTENSION_NOT_VISIBLE_AFTER_LOAD');
  if (path.resolve(entry.path) !== path.resolve(distDir)) throw new Error('SESSION_GUARD_EXTENSION_PATH_MISMATCH');
  if (entry.enabled !== true) throw new Error('SESSION_GUARD_EXTENSION_DISABLED');
  return { extensionId, path: entry.path, enabled: entry.enabled };
}

export async function loadSmokeExtensionViaCdp(browser, distDir) {
  const session = await browser.newBrowserCDPSession();
  try {
    const loaded = await session.send('Extensions.loadUnpacked', { path: path.resolve(distDir) });
    const extensionId = requireInstalledExtensionId(loaded?.id);
    const list = await session.send('Extensions.getExtensions');
    const entry = Array.isArray(list?.extensions) ? list.extensions.find((item) => item.id === extensionId) : null;
    return validateLoadedExtensionEntry(entry, extensionId, distDir);
  } finally {
    await session.detach().catch(() => undefined);
  }
}

export async function verifyLoadedExtensionBundleBuild(extensionPage, expectedBuildId) {
  const content = await extensionPage.evaluate(async () => {
    const response = await fetch(chrome.runtime.getURL('content.js'));
    if (!response.ok) throw new Error('EXTENSION_BUNDLE_FETCH_FAILED');
    return response.text();
  });
  if (!content.includes(expectedBuildId)) throw new Error('EXTENSION_RUNTIME_BUILD_ID_MISMATCH');
  return expectedBuildId;
}

export async function launchSmokeBrowser({ root = process.cwd(), headed = false }) {
  const paths = await assertDedicatedProfile(root);
  const context = await chromium.launchPersistentContext(paths.profileDir, {
    channel: 'chromium',
    headless: !headed,
    args: [
      `--disable-extensions-except=${paths.distDir}`,
      `--load-extension=${paths.distDir}`
    ],
    viewport: { width: 1440, height: 960 },
    locale: 'zh-CN'
  });

  let [serviceWorker] = context.serviceWorkers();
  if (!serviceWorker) serviceWorker = await context.waitForEvent('serviceworker', { timeout: 15_000 });
  const workerUrl = serviceWorker.url();
  const match = /^chrome-extension:\/\/([^/]+)\//.exec(workerUrl);
  if (!match?.[1]) {
    await context.close();
    throw new Error('EXTENSION_SERVICE_WORKER_ID_NOT_FOUND');
  }

  return {
    mode: 'playwright-chromium',
    context,
    extensionId: match[1],
    browserVersion: context.browser()?.version() ?? 'unknown',
    paths
  };
}

export async function launchRealChromeSmokeBrowser({ root = process.cwd() }) {
  const paths = await assertChromeProfile(root);
  const chromePath = discoverChromeExecutable();
  const browserVersion = await detectChromeVersion(chromePath);
  const launched = await launchChromeWithCdp({ chromePath, profileDir: paths.chromeProfileDir });
  let browser;
  try {
    browser = await chromium.connectOverCDP(launched.endpoint);
    const context = browser.contexts()[0];
    if (!context) throw new Error('CDP_DEFAULT_CONTEXT_MISSING');
    const loaded = await loadSmokeExtensionViaCdp(browser, paths.distDir);
    return {
      mode: 'real-chrome-cdp',
      context,
      browserConnection: browser,
      ownedChrome: launched.child,
      cdpEndpoint: launched.endpoint,
      extensionId: loaded.extensionId,
      browserVersion,
      paths
    };
  } catch (error) {
    await browser?.close().catch(() => undefined);
    await closeOwnedChrome(launched.child);
    throw error;
  }
}

export async function closeSmokeBrowser(launched) {
  if (!launched) return;
  if (launched.mode === 'real-chrome-cdp') {
    await launched.browserConnection?.close().catch(() => undefined);
    await closeOwnedChrome(launched.ownedChrome);
    return;
  }
  await launched.context?.close().catch(() => undefined);
}
