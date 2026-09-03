import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const dist = path.join(root, 'dist');
const fieldBuild = process.argv.includes('--field');
const explicitDebugBuild = process.argv.includes('--debug');
const debugBuild = explicitDebugBuild;
const buildFlavor = fieldBuild ? 'field' : explicitDebugBuild ? 'debug' : 'production';
let buildId = 'uncommitted';
try {
  buildId = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim().length > 0;
  if (dirty) buildId += '-dirty';
} catch {
  // A source archive without .git still produces a usable build.
}
if (fieldBuild) buildId += '-field';

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const common = {
  bundle: true,
  minify: false,
  minifySyntax: true,
  sourcemap: explicitDebugBuild,
  target: 'chrome120',
  platform: 'browser',
  logLevel: 'info',
  define: {
    __CSG_DEBUG_BUILD__: debugBuild ? 'true' : 'false',
    __CSG_FIELD_BUILD__: fieldBuild ? 'true' : 'false',
    __CSG_BUILD_ID__: JSON.stringify(buildId)
  }
};

await Promise.all([
  build({ ...common, entryPoints: ['src/main-world/bootstrap.ts'], outfile: 'dist/main-world.js', format: 'iife' }),
  build({ ...common, entryPoints: ['src/content/index.ts'], outfile: 'dist/content.js', format: 'iife' }),
  build({ ...common, entryPoints: ['src/popup/popup.ts'], outfile: 'dist/popup.js', format: 'iife' }),
  build({ ...common, entryPoints: ['src/background/index.ts'], outfile: 'dist/background.js', format: 'iife' })
]);

for (const file of ['manifest.json', 'popup.html', 'popup.css']) {
  await cp(path.join(root, 'extension', file), path.join(dist, file));
}

const popupPath = path.join(dist, 'popup.html');
let popupHtml = await readFile(popupPath, 'utf8');
if (!explicitDebugBuild || fieldBuild) {
  popupHtml = popupHtml.replace(/\s*<!-- CSG_DEBUG_START -->[\s\S]*?<!-- CSG_DEBUG_END -->\s*/g, '\n');
}
if (!fieldBuild) {
  popupHtml = popupHtml.replace(/\s*<!-- CSG_FIELD_START -->[\s\S]*?<!-- CSG_FIELD_END -->\s*/g, '\n');
}
if (fieldBuild) {
  popupHtml = popupHtml
    .replace('<title>ChatGPT Session Guard</title>', '<title>ChatGPT Session Guard — Field Debug</title>')
    .replace('<h1>ChatGPT Session Guard</h1>', '<h1>ChatGPT Session Guard — Field Debug</h1>');
}
await writeFile(popupPath, popupHtml, 'utf8');

if (fieldBuild) {
  const manifestPath = path.join(dist, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.name = 'ChatGPT Session Guard — Field Debug';
  manifest.description = 'ChatGPT Session Guard 现场诊断版：本地、被动、脱敏记录真实滚动异常。';
  if (manifest.action) manifest.action.default_title = manifest.name;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

console.log(`Built ChatGPT Session Guard (${buildFlavor}, ${buildId}) into dist/`);
