import { existsSync } from 'node:fs';
import path from 'node:path';

export function nodeMajor(version = process.versions.node) {
  return Number.parseInt(String(version).split('.')[0] ?? '0', 10) || 0;
}

export function assertSupportedNode(version = process.versions.node) {
  if (nodeMajor(version) < 22) throw new Error('NODE_VERSION_UNSUPPORTED');
}

export function dependencyStatus(root = process.cwd()) {
  return {
    nodeModules: existsSync(path.join(root, 'node_modules')),
    playwrightPackage: existsSync(path.join(root, 'node_modules', 'playwright', 'package.json')),
    supportZipPackage: existsSync(path.join(root, 'node_modules', 'fflate', 'package.json'))
  };
}

export function chromiumInstalled(executablePath) {
  return typeof executablePath === 'string' && executablePath.length > 0 && existsSync(executablePath);
}
