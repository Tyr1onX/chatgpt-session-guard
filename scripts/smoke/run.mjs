import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { assertDedicatedProfile } from './profile-guard.mjs';
import { createRunId } from './paths.mjs';
import { loadSmokeConfig } from './config.mjs';
import { buildDebugExtension, launchSmokeBrowser, verifyDebugBuild } from './browser.mjs';
import {
  configureUltraLite,
  getExtensionState,
  getOrCreateChatPage,
  getStabilityTrace,
  isLoggedIn,
  openConversation,
  openExtensionPage,
  popupSmoke,
  readDomSummary,
  scrollUpOnce,
  trySpaSwitch,
  waitForGuardStable
} from './chatgpt.mjs';
import { SanitizedNetworkMonitor } from './network-monitor.mjs';
import { createRunSalt, sanitizeForEvidence } from './sanitizer.mjs';
import { buildSmokeReport, createTestResult } from './report.mjs';
import { captureMaskedFailureScreenshot, writeSmokeArtifacts } from './evidence.mjs';
import { createSupportZip, openArtifactDirectory, resultActions, writeLatestRun } from './support-bundle.mjs';

const HARD_SCROLL_LIMIT = 25;
const DEFAULT_SCROLL_ATTEMPTS = 12;
const SETTLE_MS = 600;

function elapsed(started) {
  return performance.now() - started;
}

function pushUnique(list, value) {
  if (!list.includes(value)) list.push(value);
}

function safetyStatus(code) {
  return code?.startsWith('ABORTED_') ? code : null;
}

const args = new Set(process.argv.slice(2));
const headed = args.has('--headed');
const extended = args.has('--extended');
const autoUx = args.has('--auto-ux');
const requestedAttemptsArg = process.argv.find((item) => item.startsWith('--scroll-attempts='));
const requestedAttempts = requestedAttemptsArg ? Number(requestedAttemptsArg.split('=')[1]) : DEFAULT_SCROLL_ATTEMPTS;
const scrollAttempts = Math.min(HARD_SCROLL_LIMIT, Math.max(1, Number.isFinite(requestedAttempts) ? Math.round(requestedAttempts) : DEFAULT_SCROLL_ATTEMPTS));

const root = process.cwd();
const startedAt = new Date().toISOString();
const salt = createRunSalt();
const tests = [];
const safetyStops = [];
const domEvidence = { baseline: null, attempts: [], final: null };
let paths;
let runDir;
let context;
let chatPage;
let monitor;
let identity = { commitSha: 'unknown', buildId: 'unknown' };
let browserVersion = 'not-launched';
let stabilityTrace = null;
let stabilityReport = null;

try {
  paths = await assertDedicatedProfile(root);
  const config = await loadSmokeConfig(root);
  runDir = path.join(paths.artifactsDir, createRunId());
  await mkdir(runDir, { recursive: true });

  identity = buildDebugExtension(root);
  const extensionCheckStarted = performance.now();
  const buildMeta = await verifyDebugBuild({ root, distDir: paths.distDir, expectedBuildId: identity.buildId });

  const launched = await launchSmokeBrowser({ root, headed });
  context = launched.context;
  browserVersion = launched.browserVersion;
  monitor = new SanitizedNetworkMonitor(context, { salt }).start();
  chatPage = await getOrCreateChatPage(context);
  const extensionPage = await openExtensionPage(context, launched.extensionId);

  tests.push(createTestResult('extension-load', 'PASS', {
    durationMs: elapsed(extensionCheckStarted),
    metrics: {
      manifestVersion: buildMeta.manifestVersion,
      extensionVersion: buildMeta.extensionVersion,
      extensionIdDiscovered: true,
      expectedBuildId: identity.buildId
    }
  }));

  const popupStarted = performance.now();
  const popup = await popupSmoke(extensionPage);
  const popupFailures = [];
  if (popup.lang !== 'zh-CN') popupFailures.push('POPUP_LANG_NOT_ZH_CN');
  if (popup.missing.length > 0) popupFailures.push('POPUP_CHINESE_UI_MISSING');
  if (popup.missingDebug.length > 0) popupFailures.push('POPUP_DEBUG_UI_MISSING');
  tests.push(createTestResult('chinese-popup', popupFailures.length === 0 ? 'PASS' : 'FAIL', {
    durationMs: elapsed(popupStarted),
    failureCode: popupFailures[0] ?? null,
    metrics: {
      lang: popup.lang,
      missingCount: popup.missing.length,
      missingDebugCount: popup.missingDebug.length
    }
  }));
  if (popupFailures.length > 0) throw new Error(popupFailures[0]);

  await configureUltraLite(extensionPage);
  await openConversation(chatPage, config.longConversationId);
  if (!(await isLoggedIn(chatPage))) {
    pushUnique(safetyStops, 'ABORTED_LOGIN_LOST');
    throw new Error('ABORTED_LOGIN_LOST');
  }
  if (monitor.abortReason) {
    pushUnique(safetyStops, monitor.abortReason);
    throw new Error(monitor.abortReason);
  }

  const ultraStarted = performance.now();
  const baselineMetrics = await waitForGuardStable(extensionPage);
  const baselineDom = await readDomSummary(chatPage);
  domEvidence.baseline = baselineDom;
  const configOk = baselineMetrics.configuredHistoryCount === 1 && baselineMetrics.historyUnit === 'round';
  tests.push(createTestResult('ultra-lite-window', configOk ? 'PASS' : 'FAIL', {
    durationMs: elapsed(ultraStarted),
    failureCode: configOk ? null : 'ULTRA_LITE_CONFIG_NOT_APPLIED',
    metrics: {
      configuredHistoryCount: baselineMetrics.configuredHistoryCount,
      historyUnit: baselineMetrics.historyUnit,
      renderedRounds: baselineMetrics.renderedRounds,
      visibleRounds: baselineDom.visibleRoundCount
    }
  }));
  if (!configOk) throw new Error('ULTRA_LITE_CONFIG_NOT_APPLIED');

  const scrollStarted = performance.now();
  const olderBefore = monitor.records.filter((record) => record.requestClassification === 'older-page').length;
  const failureCodes = [];
  let finalDom = baselineDom;
  let finalMetrics = baselineMetrics;

  for (let attempt = 1; attempt <= scrollAttempts; attempt += 1) {
    if (monitor.abortReason) {
      pushUnique(safetyStops, monitor.abortReason);
      break;
    }

    const scroll = await scrollUpOnce(chatPage);
    await chatPage.waitForTimeout(SETTLE_MS);
    finalMetrics = await waitForGuardStable(extensionPage, { timeoutMs: 3_000 });
    finalDom = await readDomSummary(chatPage);
    const olderAfter = monitor.records.filter((record) => record.requestClassification === 'older-page').length;
    const olderDuringScroll = Math.max(0, olderAfter - olderBefore);
    const allowedVisibleRounds = finalDom.generationActive ? 2 : 1;

    if (finalDom.visibleRoundCount > allowedVisibleRounds) {
      pushUnique(failureCodes, 'VISIBLE_HISTORY_BOUNDARY_EXCEEDED');
    }
    if (finalDom.placeholderVisible && finalDom.oldTurnsVisible) {
      pushUnique(failureCodes, 'PLACEHOLDER_VISIBILITY_CONTRADICTION');
    }
    if (finalDom.visibleRoundCount > finalMetrics.renderedRounds) {
      pushUnique(failureCodes, 'METRICS_DOM_DIVERGENCE');
    }
    if (olderDuringScroll > 0) {
      pushUnique(failureCodes, 'UNEXPECTED_OLDER_PAGE_NETWORK_REQUEST');
    }

    domEvidence.attempts.push({
      attempt,
      moved: scroll.moved,
      visibleRoundCount: finalDom.visibleRoundCount,
      visibleTurnCount: finalDom.visibleTurnCount,
      placeholderPresent: finalDom.placeholderPresent,
      placeholderVisible: finalDom.placeholderVisible,
      oldTurnsVisible: finalDom.oldTurnsVisible,
      renderedRoundsMetric: finalMetrics.renderedRounds,
      configuredHistoryCount: finalMetrics.configuredHistoryCount,
      olderPageRequestsDuringScroll: olderDuringScroll,
      scrollTopBefore: scroll.before,
      scrollTopAfter: scroll.after,
      scrollHeight: scroll.max
    });

    if (failureCodes.length > 0) break;
    if (!scroll.moved && attempt >= 3) break;
  }

  domEvidence.final = finalDom;
  const olderAfterScroll = monitor.records.filter((record) => record.requestClassification === 'older-page').length;
  const olderDuringScroll = Math.max(0, olderAfterScroll - olderBefore);
  const safetyFailure = safetyStatus(monitor.abortReason);
  if (safetyFailure) pushUnique(safetyStops, safetyFailure);

  tests.push(createTestResult('ultra-lite-scroll-containment', safetyFailure ? 'ABORTED' : failureCodes.length > 0 ? 'FAIL' : 'PASS', {
    durationMs: elapsed(scrollStarted),
    failureCode: safetyFailure ?? failureCodes[0] ?? null,
    metrics: {
      configuredRounds: 1,
      visibleBefore: baselineDom.visibleRoundCount,
      visibleAfter: finalDom.visibleRoundCount,
      placeholderVisible: finalDom.placeholderVisible,
      oldTurnsVisible: finalDom.oldTurnsVisible,
      renderedRoundsMetric: finalMetrics.renderedRounds,
      olderPageRequests: olderDuringScroll,
      attempts: domEvidence.attempts.length,
      failureCodes
    }
  }));

  if (safetyFailure || failureCodes.length > 0) {
    tests.push(createTestResult('spa-switching', 'SKIPPED', {
      metrics: { reason: safetyFailure ? 'SAFETY_FAIL_FAST' : 'SCROLL_CONTAINMENT_FAIL_FAST' }
    }));
  } else {
    const switchStarted = performance.now();
    const sequence = [config.longConversationId, ...config.switchConversationIds.slice(0, 2), config.longConversationId];
    if (sequence.length < 4 && !extended) {
      tests.push(createTestResult('spa-switching', 'SKIPPED', {
        durationMs: elapsed(switchStarted),
        metrics: { reason: 'NEED_TWO_SWITCH_CONVERSATIONS_FROM_SMOKE_SETUP' }
      }));
    } else {
      const switchMetrics = [];
      let switchFailure = null;
      const targets = sequence.slice(1, 5);
      for (const target of targets) {
        if (monitor.abortReason) {
          switchFailure = monitor.abortReason;
          pushUnique(safetyStops, monitor.abortReason);
          break;
        }
        const switched = await trySpaSwitch(chatPage, target);
        if (!switched.ok) {
          switchFailure = switched.reason;
          break;
        }
        await chatPage.waitForTimeout(SETTLE_MS);
        const dom = await readDomSummary(chatPage);
        const state = await getExtensionState(extensionPage);
        switchMetrics.push({
          latencyMs: switched.latencyMs,
          blankState: dom.turnCount === 0,
          visibleRoundCount: dom.visibleRoundCount,
          renderedRounds: state?.metrics?.renderedRounds ?? null
        });
        if (dom.turnCount === 0) {
          switchFailure = 'SPA_SWITCH_BLANK_STATE';
          break;
        }
      }
      tests.push(createTestResult('spa-switching', switchFailure?.startsWith('ABORTED_') ? 'ABORTED' : switchFailure ? 'FAIL' : 'PASS', {
        durationMs: elapsed(switchStarted),
        failureCode: switchFailure,
        metrics: { switches: switchMetrics }
      }));
    }
  }

  try {
    const traceResponse = await getStabilityTrace(extensionPage);
    stabilityTrace = traceResponse?.stabilityTrace ?? null;
    stabilityReport = typeof traceResponse?.stabilityReport === 'string' ? traceResponse.stabilityReport : null;
  } catch {
    stabilityTrace = null;
    stabilityReport = null;
  }

  const failed = tests.some((test) => test.status === 'FAIL' || test.status === 'ABORTED');
  if (failed && chatPage) {
    await captureMaskedFailureScreenshot(chatPage, path.join(runDir, 'screenshot-failure-masked.png'));
  }
} catch (error) {
  const code = error instanceof Error ? error.message : String(error);
  if (code.startsWith('ABORTED_')) pushUnique(safetyStops, code);
  if (!tests.some((test) => test.id === 'harness-runtime')) {
    tests.push(createTestResult('harness-runtime', code.startsWith('ABORTED_') ? 'ABORTED' : 'FAIL', {
      failureCode: code
    }));
  }
} finally {
  if (monitor) monitor.stop();
  if (paths && !runDir) {
    runDir = path.join(paths.artifactsDir, createRunId());
    await mkdir(runDir, { recursive: true });
  }

  const networkSummary = monitor?.summary() ?? {
    totalObserved: 0,
    historyRequests: 0,
    olderPageRequests: 0,
    rateLimitedResponses: 0,
    requestAmplification: false,
    unexpectedWrite: false
  };
  const stabilitySummary = stabilityTrace?.summary ? sanitizeForEvidence(stabilityTrace.summary, salt) : {};
  const finishedAt = new Date().toISOString();
  const report = buildSmokeReport({
    buildId: identity.buildId,
    commitSha: identity.commitSha,
    startedAt,
    finishedAt,
    browser: 'Playwright Chromium',
    browserVersion,
    headed,
    tests,
    safetyStops,
    networkSummary,
    stabilitySummary
  });

  if (runDir) {
    await writeSmokeArtifacts({
      runDir,
      report,
      networkRecords: monitor?.records ?? [],
      domSummary: domEvidence,
      stabilityTrace,
      stabilityReport,
      salt
    });
    await writeLatestRun(runDir, root);
    const actions = resultActions(report.overallStatus, { autoUx });
    let supportZip = null;
    if (actions.createSupportZip) supportZip = await createSupportZip(runDir);
    if (actions.openArtifacts) await openArtifactDirectory(runDir);
    console.log('Smoke report: ' + path.join(runDir, 'smoke-report.md'));
    if (supportZip) {
      console.log('如果测试失败，请把这个文件直接发送给 GPT：');
      console.log(supportZip);
    }
  }
  const resultOf = (id) => tests.find((test) => test.id === id)?.status ?? '未运行';
  console.log('Session Guard 自动测试完成');
  console.log('扩展加载：' + resultOf('extension-load'));
  console.log('中文界面：' + resultOf('chinese-popup'));
  console.log('极简窗口：' + resultOf('ultra-lite-window'));
  console.log('向上滚动历史隔离：' + resultOf('ultra-lite-scroll-containment'));
  if (safetyStops.includes('ABORTED_RATE_LIMIT')) console.log('已检测到 HTTP 429，为避免继续触发限流，测试没有重试。');
  console.log('结果：' + report.overallStatus);

  if (context) await context.close();
  if (report.overallStatus !== 'PASS') process.exitCode = 1;
}
