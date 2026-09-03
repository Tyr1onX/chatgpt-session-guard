import { buildSmokeReport, createTestResult, smokeReportMarkdown } from '../../scripts/smoke/report.mjs';

function base(tests: ReturnType<typeof createTestResult>[], safetyStops: string[] = []) {
  return buildSmokeReport({
    buildId: 'abc123',
    commitSha: 'abc123full',
    startedAt: '2026-09-03T00:00:00.000Z',
    finishedAt: '2026-09-03T00:00:01.000Z',
    browser: 'Playwright Chromium',
    browserVersion: '140.0.0',
    headed: false,
    tests,
    safetyStops,
    networkSummary: { rateLimitedResponses: 0, requestAmplification: false },
    stabilitySummary: {}
  });
}

describe('smoke report', () => {
  it('renders a PASS report', () => {
    const report = base([createTestResult('extension-load', 'PASS')]);
    expect(report.overallStatus).toBe('PASS');
    expect(smokeReportMarkdown(report)).toContain('OVERALL: PASS');
  });

  it('renders a FAIL report with invariant failure', () => {
    const report = base([createTestResult('ultra-lite-scroll-containment', 'FAIL', {
      failureCode: 'PLACEHOLDER_VISIBILITY_CONTRADICTION',
      metrics: {
        configuredRounds: 1,
        visibleBefore: 1,
        visibleAfter: 9,
        placeholderVisible: true,
        oldTurnsVisible: true,
        olderPageRequests: 0,
        failureCodes: ['PLACEHOLDER_VISIBILITY_CONTRADICTION']
      }
    })]);
    expect(report.overallStatus).toBe('FAIL');
    const markdown = smokeReportMarkdown(report);
    expect(markdown).toContain('PLACEHOLDER_VISIBILITY_CONTRADICTION');
    expect(markdown).toContain('Visible after scroll: 9');
  });

  it('renders a 429 abort report', () => {
    const report = base([
      createTestResult('ultra-lite-scroll-containment', 'ABORTED', { failureCode: 'ABORTED_RATE_LIMIT' })
    ], ['ABORTED_RATE_LIMIT']);
    report.networkSummary.rateLimitedResponses = 1;
    expect(report.overallStatus).toBe('ABORTED');
    expect(smokeReportMarkdown(report)).toContain('429 detected: yes');
  });

  it('renders a request amplification abort report', () => {
    const report = base([
      createTestResult('ultra-lite-scroll-containment', 'ABORTED', { failureCode: 'ABORTED_REQUEST_AMPLIFICATION' })
    ], ['ABORTED_REQUEST_AMPLIFICATION']);
    report.networkSummary.requestAmplification = true;
    expect(report.overallStatus).toBe('ABORTED');
    expect(smokeReportMarkdown(report)).toContain('Request amplification: yes');
  });
});
