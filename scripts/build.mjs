import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const dist = path.join(root, 'dist');
const debugBuild = process.argv.includes('--debug');
let buildId = 'uncommitted';
try {
  buildId = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim().length > 0;
  if (dirty) buildId += '-dirty';
} catch {
  // A source archive without .git still produces a usable debug build.
}

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const common = {
  bundle: true,
  minify: false,
  minifySyntax: true,
  sourcemap: debugBuild,
  target: 'chrome120',
  platform: 'browser',
  logLevel: 'info',
  define: {
    __CSG_DEBUG_BUILD__: debugBuild ? 'true' : 'false',
    __CSG_BUILD_ID__: JSON.stringify(buildId)
  }
};

await Promise.all([
  build({ ...common, entryPoints: ['src/main-world/fetch-guard.ts'], outfile: 'dist/main-world.js', format: 'iife' }),
  build({ ...common, entryPoints: ['src/content/index.ts'], outfile: 'dist/content.js', format: 'iife' }),
  build({ ...common, entryPoints: ['src/popup/popup.ts'], outfile: 'dist/popup.js', format: 'iife' }),
  build({ ...common, entryPoints: ['src/background/index.ts'], outfile: 'dist/background.js', format: 'iife' })
]);

for (const file of ['manifest.json', 'popup.html', 'popup.css']) {
  await cp(path.join(root, 'extension', file), path.join(dist, file));
}

if (!debugBuild) {
  const popupPath = path.join(dist, 'popup.html');
  const html = await readFile(popupPath, 'utf8');
  await writeFile(
    popupPath,
    html.replace(/\s*<!-- CSG_DEBUG_START -->[\s\S]*?<!-- CSG_DEBUG_END -->\s*/g, '\n'),
    'utf8'
  );

}

console.log(`Built ChatGPT Session Guard (${debugBuild ? 'debug' : 'production'}, ${buildId}) into dist/`);
