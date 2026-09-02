import { build } from 'esbuild';
import { mkdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const tempDir = path.join(process.cwd(), '.benchmark');
const bundle = path.join(tempDir, 'synthetic-benchmark.cjs');
await rm(tempDir, { recursive: true, force: true });
await mkdir(tempDir, { recursive: true });

await build({
  entryPoints: ['scripts/synthetic-benchmark-entry.ts'],
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  sourcemap: false,
  logLevel: 'silent'
});

function runScenario(name) {
  const result = spawnSync(process.execPath, ['--expose-gc', bundle, name], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    throw new Error(`Synthetic benchmark scenario failed: ${name}`);
  }
  return JSON.parse(result.stdout);
}

try {
  const single = runScenario('single');
  const off = runScenario('switch-off');
  const balanced = runScenario('switch-balanced');
  console.log(JSON.stringify({
    ...single,
    hundredSwitches: {
      off: off.hundredSwitches,
      balanced: balanced.hundredSwitches,
      balancedMinusOffGrowthMb: Math.round((balanced.hundredSwitches.growthMb - off.hundredSwitches.growthMb) * 10) / 10
    }
  }, null, 2));
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
