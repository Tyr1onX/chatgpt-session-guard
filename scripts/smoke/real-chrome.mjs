import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';

export function chromeExecutableCandidates({ env = process.env, platform = process.platform } = {}) {
  if (platform === 'win32') {
    return [
      env.PROGRAMFILES && path.join(env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      env['PROGRAMFILES(X86)'] && path.join(env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
      env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe')
    ].filter(Boolean);
  }
  if (platform === 'darwin') return ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'];
}

export function discoverChromeExecutable(options = {}) {
  const found = chromeExecutableCandidates(options).find((candidate) => existsSync(candidate));
  if (!found) throw new Error('BRANDED_CHROME_NOT_FOUND');
  return path.resolve(found);
}

function compareVersion(a, b) {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

export async function detectChromeVersion(chromePath) {
  if (process.platform === 'win32') {
    try {
      const entries = await readdir(path.dirname(chromePath), { withFileTypes: true });
      const versions = entries
        .filter((entry) => entry.isDirectory() && /^\d+\.\d+\.\d+\.\d+$/.test(entry.name))
        .map((entry) => entry.name)
        .sort(compareVersion);
      if (versions.length > 0) return versions.at(-1);
    } catch {
      // Fall through to an explicit version probe below.
    }
  }
  const result = spawnSync(chromePath, ['--version'], { encoding: 'utf8', windowsHide: true });
  const text = `${result.stdout ?? ''} ${result.stderr ?? ''}`;
  return /\d+\.\d+\.\d+\.\d+/.exec(text)?.[0] ?? 'unknown';
}

export function validateCdpEndpoint(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: 'CDP_ENDPOINT_INVALID' };
  }
  const localHost = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]';
  if (url.protocol !== 'http:' || !localHost || !url.port) return { ok: false, error: 'CDP_ENDPOINT_NOT_LOCALHOST' };
  return { ok: true, endpoint: `http://127.0.0.1:${url.port}` };
}

export function mayTerminateOwnedChrome({ ownedPid, targetPid }) {
  return Number.isInteger(ownedPid) && ownedPid > 0 && ownedPid === targetPid;
}

function spawnChrome(chromePath, args) {
  const child = spawn(chromePath, args, {
    stdio: 'ignore',
    windowsHide: true,
    detached: false
  });
  if (!child.pid) throw new Error('BRANDED_CHROME_LAUNCH_FAILED');
  return child;
}

export function launchAuthChrome({ chromePath, profileDir, url = 'https://chatgpt.com/' }) {
  return spawnChrome(chromePath, [
    `--user-data-dir=${path.resolve(profileDir)}`,
    '--no-first-run',
    '--no-default-browser-check',
    url
  ]);
}

export async function waitForChromeExit(child) {
  if (child.exitCode !== null) return child.exitCode;
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 0));
  });
}

export async function reserveLoopbackPort() {
  const server = net.createServer();
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : null;
      server.close((error) => {
        if (error) reject(error);
        else if (!Number.isInteger(port) || port <= 0) reject(new Error('CDP_PORT_RESERVATION_FAILED'));
        else resolve(port);
      });
    });
  });
}

async function waitForCdpEndpoint(endpoint, child, timeoutMs = 15_000) {
  const validated = validateCdpEndpoint(endpoint);
  if (!validated.ok) throw new Error(validated.error);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('BRANDED_CHROME_EXITED_BEFORE_CDP');
    try {
      const response = await fetch(`${validated.endpoint}/json/version`, { signal: AbortSignal.timeout(700) });
      if (response.ok) return validated.endpoint;
    } catch {
      // Chrome may still be starting. Retry only the local endpoint probe.
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error('CDP_ENDPOINT_TIMEOUT');
}

export async function launchChromeWithCdp({ chromePath, profileDir, url = 'https://chatgpt.com/' }) {
  const port = await reserveLoopbackPort();
  const endpoint = `http://127.0.0.1:${port}`;
  const child = spawnChrome(chromePath, [
    `--user-data-dir=${path.resolve(profileDir)}`,
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${port}`,
    '--no-first-run',
    '--no-default-browser-check',
    url
  ]);
  try {
    await waitForCdpEndpoint(endpoint, child);
    return { child, endpoint };
  } catch (error) {
    await closeOwnedChrome(child);
    throw error;
  }
}

export async function closeOwnedChrome(child) {
  if (!child?.pid || child.exitCode !== null) return;
  const ownedPid = child.pid;
  child.kill();
  await new Promise((resolve) => setTimeout(resolve, 700));
  if (child.exitCode !== null) return;
  if (process.platform === 'win32' && mayTerminateOwnedChrome({ ownedPid, targetPid: child.pid })) {
    spawnSync('taskkill.exe', ['/PID', String(ownedPid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  }
}
