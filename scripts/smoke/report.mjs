const ORDER = ['PASS', 'FAIL', 'SKIPPED', 'ABORTED'];

/**
 * @param {string} id
 * @param {'PASS'|'FAIL'|'SKIPPED'|'ABORTED'} status
 * @param {{durationMs?: number, failureCode?: string|null, metrics?: Record<string, unknown>}} [options]
 */
export function createTestResult(id, status, { durationMs = 0, failureCode = null, metrics = {} } = {}) {
  if (!ORDER.includes(status)) throw new Error(`Unknown smoke status: ${status}`);
  return {
    id,
    status,
    durationMs: Math.max(0, Math.round(durationMs)),
    failureCode,
    metrics
  };
}

/** @param {Array<{status: string}>} tests @param {string[]} [safetyStops] */
export function overallStatus(tests, safetyStops = []) {
  if (safetyStops.length > 0 || tests.some((test) => test.status === 'ABORTED')) return 'ABORTED';
  if (tests.some((test) => test.status === 'FAIL')) return 'FAIL';
  return 'PASS';
}

/**
 * @param {{
 * buildId: string,
 * commitSha: string,
 * startedAt: string,
 * finishedAt: string,
 * browser: string,
 * browserVersion: string,
 * headed: boolean,
 * tests: Array<ReturnType<typeof createTestResult>>,
 * safetyStops?: string[],
 * networkSummary?: Record<string, unknown>,
 * stabilitySummary?: Record<string, unknown>
 * }} input
 */
export function buildSmokeReport({
  buildId,
  commitSha,
  startedAt,
  finishedAt,
  browser,
  browserVersion,
  headed,
  tests,
  safetyStops = [],
  networkSummary = {},
  stabilitySummary = {}
}) {
  return {
    schemaVersion: 1,
    buildId,
    commitSha,
    startedAt,
    finishedAt,
    durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt)),
    browser,
    browserVersion,
    headless: !headed,
    headed,
    profileKind: 'dedicated-persistent-smoke-profile',
    tests,
    overallStatus: overallStatus(tests, safetyStops),
    safetyStops,
    networkSummary,
    stabilitySummary
  };
}

function value(value) {
  if (value === null || value === undefined) return 'n/a';
  return String(value);
}

/** @param {ReturnType<typeof buildSmokeReport>} report */
export function smokeReportMarkdown(report) {
  const lines = [
    '# ChatGPT Session Guard Real Chrome Smoke',
    '',
    `- Build: ${report.buildId}`,
    `- Commit: ${report.commitSha}`,
    `- Browser: ${report.browser} ${report.browserVersion}`,
    `- Profile: ${report.profileKind}`,
    `- Mode: ${report.headed ? 'isolated headed' : 'isolated headless'}`,
    '',
    '## Result',
    ''
  ];

  for (const test of report.tests) {
    const suffix = test.failureCode ? ` — ${test.failureCode}` : '';
    lines.push(`- ${test.id}: ${test.status}${suffix}`);
  }

  const scroll = report.tests.find((test) => test.id === 'ultra-lite-scroll-containment');
  if (scroll) {
    lines.push(
      '',
      '## Scroll Containment',
      '',
      `- Configured history: ${value(scroll.metrics.configuredRounds)} round(s)`,
      `- Visible before scroll: ${value(scroll.metrics.visibleBefore)}`,
      `- Visible after scroll: ${value(scroll.metrics.visibleAfter)}`,
      `- Placeholder visible: ${value(scroll.metrics.placeholderVisible)}`,
      `- Old turns visible: ${value(scroll.metrics.oldTurnsVisible)}`,
      `- Network older-page requests: ${value(scroll.metrics.olderPageRequests)}`
    );
    const failures = Array.isArray(scroll.metrics.failureCodes) ? scroll.metrics.failureCodes : [];
    if (failures.length > 0) {
      lines.push('', 'FAIL:', ...failures.map((code) => `- ${code}`));
    }
  }

  lines.push(
    '',
    '## Safety',
    '',
    `- 429 detected: ${Number(report.networkSummary.rateLimitedResponses ?? 0) > 0 ? 'yes' : 'no'}`,
    `- Request amplification: ${report.networkSummary.requestAmplification === true ? 'yes' : 'no'}`,
    `- Safety stops: ${report.safetyStops.length > 0 ? report.safetyStops.join(', ') : 'none'}`,
    '',
    `OVERALL: ${report.overallStatus}`,
    ''
  );
  return lines.join('\n');
}
