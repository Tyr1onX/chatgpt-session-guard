import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { assertDedicatedProfile } from './profile-guard.mjs';

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
  const background = await readFile(path.join(distDir, 'background.js'), 'utf8');
  const content = await readFile(path.join(distDir, 'content.js'), 'utf8');

  if (manifest.manifest_version !== 3) throw new Error('EXTENSION_MANIFEST_NOT_MV3');
  if (typeof manifest.version !== 'string' || manifest.version.length === 0) throw new Error('EXTENSION_VERSION_MISSING');
  if (!background.includes(expectedBuildId) && !content.includes(expectedBuildId)) {
    throw new Error(`DEBUG_BUILD_ID_MISMATCH: expected ${expectedBuildId}`);
  }
  for (const marker of ['性能测试', '超长会话压力测试', '窗口稳定性诊断']) {
    if (!popup.includes(marker)) throw new Error(`DEBUG_UI_MARKER_MISSING: ${marker}`);
  }
  return { manifestVersion: manifest.manifest_version, extensionVersion: manifest.version };
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
    context,
    extensionId: match[1],
    browserVersion: context.browser()?.version() ?? 'unknown',
    paths
  };
}
