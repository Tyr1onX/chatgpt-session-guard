import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { smokePaths } from './paths.mjs';

function normalize(value) {
  return path.resolve(value).replace(/[\\/]+$/, '').toLowerCase();
}

export function findUnpackedExtensionIdFromPreferences(preferences, distDir) {
  const settings = preferences?.extensions?.settings;
  if (!settings || typeof settings !== 'object') return null;
  const expected = normalize(distDir);
  for (const [extensionId, entry] of Object.entries(settings)) {
    if (!entry || typeof entry !== 'object' || typeof entry.path !== 'string') continue;
    const candidate = path.isAbsolute(entry.path)
      ? normalize(entry.path)
      : normalize(path.resolve(path.dirname(distDir), entry.path));
    if (candidate === expected && /^[a-p]{32}$/.test(extensionId)) return extensionId;
  }
  return null;
}

export async function findInstalledSmokeExtensionId(root = process.cwd()) {
  const paths = smokePaths(root);
  try {
    const parsed = JSON.parse(await readFile(paths.chromePreferencesPath, 'utf8'));
    return findUnpackedExtensionIdFromPreferences(parsed, paths.distDir);
  } catch {
    return null;
  }
}

export async function findSmokeExtensionIdInContext(context) {
  for (const worker of context.serviceWorkers()) {
    const match = /^chrome-extension:\/\/([a-p]{32})\//.exec(worker.url());
    if (!match?.[1]) continue;
    try {
      const manifest = await worker.evaluate(() => chrome.runtime.getManifest());
      if (manifest?.name === 'ChatGPT Session Guard') return match[1];
    } catch {
      // A service worker may stop between enumeration and inspection.
    }
  }
  return null;
}

export async function waitForInstalledSmokeExtension(root = process.cwd(), { context = null, timeoutMs = 10 * 60_000, intervalMs = 750 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const fromPreferences = await findInstalledSmokeExtensionId(root);
    if (fromPreferences) return fromPreferences;
    if (context) {
      const fromRuntime = await findSmokeExtensionIdInContext(context);
      if (fromRuntime) return fromRuntime;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('SESSION_GUARD_EXTENSION_INSTALL_TIMEOUT');
}
