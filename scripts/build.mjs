import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const dist = path.join(root, 'dist');
const debugBuild = process.argv.includes('--debug');

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const common = {
  bundle: true,
  minify: false,
  sourcemap: true,
  target: 'chrome120',
  platform: 'browser',
  logLevel: 'info',
  define: {
    __CSG_DEBUG_BUILD__: debugBuild ? 'true' : 'false'
  }
};

await Promise.all([
  build({ ...common, entryPoints: ['src/main-world/fetch-guard.ts'], outfile: 'dist/main-world.js', format: 'iife' }),
  build({ ...common, entryPoints: ['src/content/index.ts'], outfile: 'dist/content.js', format: 'iife' }),
  build({ ...common, entryPoints: ['src/popup/popup.ts'], outfile: 'dist/popup.js', format: 'iife' })
]);

for (const file of ['manifest.json', 'popup.html', 'popup.css']) {
  await cp(path.join(root, 'extension', file), path.join(dist, file));
}

console.log(`Built ChatGPT Session Guard (${debugBuild ? 'debug' : 'production'}) into dist/`);
