import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { unzipSync, zipSync } from 'fflate';

const root = process.cwd();
const dist = path.join(root, 'dist');
const outputDir = path.join(root, 'artifacts', 'field-debug');
const zipPath = path.join(outputDir, 'ChatGPT-Session-Guard-Field-Debug.zip');
const installGuidePath = path.join(root, 'FIELD-DEBUG-INSTALL.md');
const requiredFiles = [
  'manifest.json',
  'popup.html',
  'popup.css',
  'popup.js',
  'content.js',
  'main-world.js',
  'background.js'
];
const forbiddenPatterns = [
  /(^|\/)node_modules(\/|$)/,
  /(^|\/)\.git(\/|$)/,
  /(^|\/)\.csg-smoke(\/|$)/,
  /(^|\/)tests?(\/|$)/,
  /(^|\/)scripts?(\/|$)/,
  /profile/i,
  /artifacts?(\/|$)/,
  /\.map$/i
];

execFileSync(process.execPath, ['scripts/build.mjs', '--field'], { cwd: root, stdio: 'inherit' });
await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

const distFiles = (await readdir(dist, { withFileTypes: true }))
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name)
  .sort();
for (const required of requiredFiles) {
  if (!distFiles.includes(required)) throw new Error(`FIELD_PACKAGE_MISSING:${required}`);
}
for (const name of distFiles) {
  if (forbiddenPatterns.some((pattern) => pattern.test(name))) throw new Error(`FIELD_PACKAGE_FORBIDDEN:${name}`);
}

const manifest = JSON.parse(await readFile(path.join(dist, 'manifest.json'), 'utf8'));
if (manifest.manifest_version !== 3) throw new Error('FIELD_PACKAGE_BAD_MANIFEST');
if (!String(manifest.name).includes('Field Debug')) throw new Error('FIELD_PACKAGE_NAME_NOT_FIELD_DEBUG');
if (!manifest.content_scripts || !manifest.background?.service_worker) throw new Error('FIELD_PACKAGE_ENTRYPOINTS_MISSING');

const contentBundle = await readFile(path.join(dist, 'content.js'), 'utf8');
if (!contentBundle.includes('csg.field.incidents.v1')) throw new Error('FIELD_RECORDER_NOT_ENABLED_IN_FIELD_BUNDLE');
if (!contentBundle.includes('-field')) throw new Error('FIELD_BUILD_ID_NOT_MARKED');

const entries = {};
for (const name of distFiles) {
  entries[name] = new Uint8Array(await readFile(path.join(dist, name)));
}
entries['FIELD-DEBUG-INSTALL.md'] = new Uint8Array(await readFile(installGuidePath));

const zipBytes = zipSync(entries, { level: 6 });
await writeFile(zipPath, zipBytes);

const unpacked = unzipSync(zipBytes);
const names = Object.keys(unpacked).sort();
for (const required of requiredFiles) {
  if (!names.includes(required)) throw new Error(`FIELD_ZIP_MISSING:${required}`);
}
for (const name of names) {
  if (forbiddenPatterns.some((pattern) => pattern.test(name))) throw new Error(`FIELD_ZIP_FORBIDDEN:${name}`);
}
JSON.parse(new TextDecoder().decode(unpacked['manifest.json']));

console.log(`Field Debug package: ${zipPath}`);
console.log(`Files: ${names.join(', ')}`);
