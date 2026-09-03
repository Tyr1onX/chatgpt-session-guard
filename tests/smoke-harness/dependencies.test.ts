import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assertSupportedNode, chromiumInstalled, dependencyStatus } from '../../scripts/smoke/dependencies.mjs';

describe('bootstrap dependency detection', () => {
  it('detects missing node_modules and Playwright package', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'csg-deps-'));
    try {
      expect(dependencyStatus(root)).toEqual({ nodeModules: false, playwrightPackage: false, supportZipPackage: false });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('detects a missing Playwright Chromium executable', () => {
    expect(chromiumInstalled(path.join(os.tmpdir(), 'csg-missing-chromium.exe'))).toBe(false);
  });

  it('detects a valid existing installation and Chromium executable', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'csg-deps-'));
    try {
      await mkdir(path.join(root, 'node_modules', 'playwright'), { recursive: true });
      await writeFile(path.join(root, 'node_modules', 'playwright', 'package.json'), '{}');
      await mkdir(path.join(root, 'node_modules', 'fflate'), { recursive: true });
      await writeFile(path.join(root, 'node_modules', 'fflate', 'package.json'), '{}');
      const executable = path.join(root, 'chromium.exe');
      await writeFile(executable, 'fake');
      expect(dependencyStatus(root)).toEqual({ nodeModules: true, playwrightPackage: true, supportZipPackage: true });
      expect(chromiumInstalled(executable)).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects unsupported Node and accepts Node 22+', () => {
    expect(() => assertSupportedNode('20.19.0')).toThrow('NODE_VERSION_UNSUPPORTED');
    expect(() => assertSupportedNode('22.0.0')).not.toThrow();
  });
});
