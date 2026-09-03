import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { unzipSync } from 'fflate';
import {
  artifactOpenCommand,
  createSupportZip,
  isAllowedSupportEntry,
  resultActions,
  writeLatestRun
} from '../../scripts/smoke/support-bundle.mjs';

describe('bootstrap support bundle', () => {
  it('allows only the documented sanitized evidence files', () => {
    expect(isAllowedSupportEntry('smoke-report.md')).toBe(true);
    expect(isAllowedSupportEntry('sanitized-network.json')).toBe(true);
    expect(isAllowedSupportEntry('screenshot-failure-masked.png')).toBe(true);
  });

  it('rejects profile, Cookie, token, raw HAR and raw HTML names', () => {
    for (const name of ['profile', 'Cookies', 'Login Data', 'session-token.json', 'trace.har', 'page.html']) {
      expect(isAllowedSupportEntry(name)).toBe(false);
    }
  });

  it('creates a ZIP containing sanitized evidence but never profile data', async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), 'csg-support-'));
    try {
      await writeFile(path.join(runDir, 'smoke-report.md'), '# safe');
      await writeFile(path.join(runDir, 'sanitized-network.json'), '[]');
      await mkdir(path.join(runDir, 'profile'));
      await writeFile(path.join(runDir, 'Cookies'), 'secret');
      await writeFile(path.join(runDir, 'session-token.json'), 'secret');
      const zipPath = await createSupportZip(runDir);
      const entries = unzipSync(new Uint8Array(await readFile(zipPath)));
      expect(Object.keys(entries).sort()).toEqual(['sanitized-network.json', 'smoke-report.md']);
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  });

  it('writes a latest-run pointer outside the artifact payload', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'csg-latest-'));
    try {
      const runDir = path.join(root, '.csg-smoke', 'artifacts', 'run-1');
      await mkdir(runDir, { recursive: true });
      const latest = await writeLatestRun(runDir, root);
      expect((await readFile(latest, 'utf8')).trim()).toBe(path.resolve(runDir));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('uses Explorer with hidden child-process behavior on Windows', () => {
    const spec = artifactOpenCommand('C:/tmp/run', 'win32');
    expect(spec?.command).toBe('explorer.exe');
    expect(spec?.windowsHide).toBe(true);
  });

  it('opens the artifact directory for successful one-click runs without creating a ZIP', () => {
    expect(resultActions('PASS', { autoUx: true })).toEqual({ openArtifacts: true, createSupportZip: false });
  });

  it('creates a support ZIP for FAIL and 429-style ABORTED outcomes', () => {
    expect(resultActions('FAIL', { autoUx: true })).toEqual({ openArtifacts: true, createSupportZip: true });
    expect(resultActions('ABORTED', { autoUx: true }).createSupportZip).toBe(true);
  });
});
