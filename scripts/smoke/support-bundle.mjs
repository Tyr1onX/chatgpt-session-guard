import { execFile } from 'node:child_process';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { zipSync } from 'fflate';
import { smokePaths } from './paths.mjs';

const execFileAsync = promisify(execFile);
const ALLOWED = new Set([
  'smoke-report.md',
  'smoke-report.json',
  'sanitized-network.json',
  'dom-summary.json',
  'stability-trace.json',
  'stability-report.md',
  'screenshot-failure-masked.png'
]);
const FORBIDDEN_NAME = /(cookie|login data|local storage|indexeddb|profile|session|token|\.har$|\.html$)/i;

export function isAllowedSupportEntry(name) {
  return ALLOWED.has(name) && !FORBIDDEN_NAME.test(name);
}

export function resultActions(overallStatus, { autoUx = false } = {}) {
  return {
    openArtifacts: Boolean(autoUx),
    createSupportZip: overallStatus !== 'PASS'
  };
}

export function artifactOpenCommand(runDir, platform = process.platform) {
  const target = path.resolve(runDir);
  if (platform === 'win32') return { command: 'explorer.exe', args: [target], windowsHide: true };
  if (platform === 'darwin') return { command: 'open', args: [target], windowsHide: false };
  if (platform === 'linux') return { command: 'xdg-open', args: [target], windowsHide: false };
  return null;
}

export async function createSupportZip(runDir) {
  const entries = {};
  for (const name of await readdir(runDir)) {
    if (!isAllowedSupportEntry(name)) continue;
    const full = path.join(runDir, name);
    if (!(await stat(full)).isFile()) continue;
    const data = await readFile(full);
    entries[name] = new Uint8Array(data);
  }
  const runId = path.basename(runDir);
  const zipPath = path.join(runDir, `session-guard-smoke-${runId}.zip`);
  await writeFile(zipPath, zipSync(entries, { level: 6 }));
  return zipPath;
}

export async function writeLatestRun(runDir, root = process.cwd()) {
  const { smokeRoot } = smokePaths(root);
  const latestPath = path.join(smokeRoot, 'latest-run.txt');
  await writeFile(latestPath, `${path.resolve(runDir)}\n`, 'utf8');
  return latestPath;
}

export async function openArtifactDirectory(runDir, platform = process.platform) {
  const spec = artifactOpenCommand(runDir, platform);
  if (!spec) return false;
  try {
    await execFileAsync(spec.command, spec.args, { windowsHide: spec.windowsHide });
    return true;
  } catch {
    return false;
  }
}

export async function supportBundleManifest(runDir) {
  const names = await readdir(runDir);
  return names.filter(isAllowedSupportEntry).sort();
}
