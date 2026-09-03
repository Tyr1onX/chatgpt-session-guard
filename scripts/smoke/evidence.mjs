import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { sanitizeForEvidence } from './sanitizer.mjs';
import { smokeReportMarkdown } from './report.mjs';

export async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function writeSmokeArtifacts({ runDir, report, networkRecords, domSummary, stabilityTrace, stabilityReport, salt }) {
  await mkdir(runDir, { recursive: true });
  await writeJson(path.join(runDir, 'smoke-report.json'), report);
  await writeFile(path.join(runDir, 'smoke-report.md'), smokeReportMarkdown(report), 'utf8');
  await writeJson(path.join(runDir, 'sanitized-network.json'), networkRecords);
  await writeJson(path.join(runDir, 'dom-summary.json'), domSummary);

  if (stabilityTrace) {
    await writeJson(path.join(runDir, 'stability-trace.json'), sanitizeForEvidence(stabilityTrace, salt));
  }
  if (stabilityReport) {
    await writeFile(path.join(runDir, 'stability-report.md'), stabilityReport, 'utf8');
  }
}

export async function captureMaskedFailureScreenshot(page, destination) {
  const masks = [
    page.locator('[data-testid^="conversation-turn-"]'),
    page.locator('[data-testid="conversation-turn"]'),
    page.locator('article[data-turn-id]'),
    page.locator('nav a[href^="/c/"]'),
    page.locator('aside a[href^="/c/"]'),
    page.locator('[data-testid*="profile" i]'),
    page.locator('[data-testid*="account" i]'),
    page.locator('img[alt*="avatar" i]')
  ];
  await page.screenshot({
    path: destination,
    fullPage: false,
    mask: masks
  });
}
