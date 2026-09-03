export const HARD_WHEEL_EVENT_LIMIT = 30;
export const DEFAULT_WHEEL_EVENT_COUNT = 16;
export const DEFAULT_SAMPLE_OFFSETS_MS = Object.freeze([0, 16, 32, 50, 100, 150, 250]);
export const BURST_SAMPLE_OFFSETS_MS = Object.freeze([0, 16, 32, 50]);

function uniquePush(list, value) {
  if (!list.includes(value)) list.push(value);
}

function appendStage(plan, profile, count, deltaY, sampleOffsetsMs = DEFAULT_SAMPLE_OFFSETS_MS) {
  for (let index = 0; index < count; index += 1) {
    plan.push({ profile, deltaY, sampleOffsetsMs: [...sampleOffsetsMs] });
  }
}

export function createRealisticWheelPlan({ maxEvents = DEFAULT_WHEEL_EVENT_COUNT } = {}) {
  const boundedMax = Math.min(HARD_WHEEL_EVENT_LIMIT, Math.max(1, Math.round(maxEvents)));
  const plan = [];
  appendStage(plan, 'gentle', 4, -180);
  appendStage(plan, 'normal', 6, -420);
  appendStage(plan, 'burst', 5, -680, BURST_SAMPLE_OFFSETS_MS);
  appendStage(plan, 'burst', 1, -680, DEFAULT_SAMPLE_OFFSETS_MS);
  return plan.slice(0, boundedMax);
}

function phaseList(events) {
  return [...new Set(events.map((event) => event.profile))];
}

/** @param {{ plan: Array<{ profile: string, sampleOffsetsMs: number[] }>, wheelEvents: Array<{ profile: string }>, samples: unknown[], safetyStop?: string | null, failureCodes?: string[] }} input */
export function evaluateRealisticScrollPlanCompletion({
  plan,
  wheelEvents,
  samples,
  safetyStop = null,
  failureCodes = []
}) {
  const boundedPlan = plan.slice(0, HARD_WHEEL_EVENT_LIMIT);
  const plannedPhases = phaseList(boundedPlan);
  const executedPhases = phaseList(wheelEvents);
  const plannedWheelEvents = boundedPlan.length;
  const executedWheelEvents = wheelEvents.length;
  const plannedSamples = boundedPlan.reduce((total, event) => total + event.sampleOffsetsMs.length, 0);
  const executedSamples = samples.length;
  const phasesComplete = plannedPhases.length === executedPhases.length
    && plannedPhases.every((phase, index) => executedPhases[index] === phase);
  const complete = phasesComplete
    && executedWheelEvents === plannedWheelEvents
    && executedSamples === plannedSamples;
  const hasLegitimateStop = Boolean(safetyStop) || failureCodes.length > 0;

  return {
    complete,
    failureCode: !complete && !hasLegitimateStop ? 'INCOMPLETE_REALISTIC_SCROLL_PLAN' : null,
    plannedPhases,
    executedPhases,
    plannedWheelEvents,
    executedWheelEvents,
    plannedSamples,
    executedSamples
  };
}

export function evaluateTransientScrollSample(sample, { configuredRounds = 1 } = {}) {
  const failureCodes = [];
  const allowedVisibleRounds = sample.generationActive ? Math.max(configuredRounds, 2) : configuredRounds;

  if (sample.visibleRoundCount > allowedVisibleRounds) {
    uniquePush(failureCodes, 'VISIBLE_HISTORY_BOUNDARY_EXCEEDED');
  }
  if (sample.placeholderVisible && sample.oldTurnsVisible) {
    uniquePush(failureCodes, 'PLACEHOLDER_VISIBILITY_CONTRADICTION');
    uniquePush(failureCodes, 'TRANSIENT_HISTORY_VISIBILITY_LEAK');
  }
  if (Number.isFinite(sample.metricsRenderedRounds) && sample.visibleRoundCount > sample.metricsRenderedRounds) {
    uniquePush(failureCodes, 'METRICS_DOM_DIVERGENCE');
  }
  if (sample.placeholderIntersectsViewport && sample.oldTurnsIntersectViewport) {
    uniquePush(failureCodes, 'VISIBLE_HISTORY_LEAK_IN_VIEWPORT');
    uniquePush(failureCodes, 'TRANSIENT_HISTORY_VISIBILITY_LEAK');
  }
  if (sample.viewportVisibleRoundCount > allowedVisibleRounds) {
    uniquePush(failureCodes, 'VISIBLE_HISTORY_LEAK_IN_VIEWPORT');
    uniquePush(failureCodes, 'TRANSIENT_HISTORY_VISIBILITY_LEAK');
  }

  return failureCodes;
}

export function summarizeTransientSamples(samples, { configuredRounds = 1 } = {}) {
  const failureCodes = [];
  for (const sample of samples) {
    for (const code of evaluateTransientScrollSample(sample, { configuredRounds })) uniquePush(failureCodes, code);
  }

  const heights = samples.map((sample) => sample.scrollHeight).filter(Number.isFinite);
  const boundaries = samples.map((sample) => sample.metricsBoundaryIndex).filter(Number.isFinite);
  const baselineHeight = heights[0] ?? 0;
  const peakHeight = heights.length > 0 ? Math.max(...heights) : 0;
  const finalHeight = heights.at(-1) ?? baselineHeight;
  const spikeThreshold = Math.max(500, baselineHeight * 0.15);
  const transientScrollHeightSpike = peakHeight > baselineHeight + spikeThreshold
    && finalHeight < peakHeight - Math.max(250, (peakHeight - baselineHeight) * 0.5);
  const baselineBoundaryIndex = boundaries[0] ?? null;
  const minimumBoundaryIndex = boundaries.length > 0 ? Math.min(...boundaries) : null;
  const unexpectedBoundaryShift = baselineBoundaryIndex !== null
    && minimumBoundaryIndex !== null
    && minimumBoundaryIndex < baselineBoundaryIndex;

  return {
    failureCodes,
    diagnostics: {
      transientScrollHeightSpike,
      baselineScrollHeight: baselineHeight,
      peakScrollHeight: peakHeight,
      finalScrollHeight: finalHeight,
      unexpectedBoundaryShift,
      baselineBoundaryIndex,
      minimumBoundaryIndex,
      viewportLeakDetected: failureCodes.includes('VISIBLE_HISTORY_LEAK_IN_VIEWPORT')
    }
  };
}

export async function runRealisticScrollPlan({
  plan = createRealisticWheelPlan(),
  wheel,
  sample,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  getSafetyStop = () => /** @type {string | null} */ (null),
  getOlderPageCount = () => 0,
  configuredRounds = 1
}) {
  const boundedPlan = plan.slice(0, HARD_WHEEL_EVENT_LIMIT);
  const samples = [];
  const wheelEvents = [];
  const failureCodes = [];
  const olderPageStart = getOlderPageCount();
  let safetyStop = null;

  for (let eventIndex = 0; eventIndex < boundedPlan.length; eventIndex += 1) {
    safetyStop = getSafetyStop();
    if (safetyStop) break;

    const event = boundedPlan[eventIndex];
    const wheelResult = await wheel(event.deltaY, event);
    wheelEvents.push({
      eventIndex: eventIndex + 1,
      profile: event.profile,
      deltaY: event.deltaY,
      moved: Boolean(wheelResult?.moved),
      selectedScrollerTag: wheelResult?.selectedScrollerTag ?? null,
      scrollTopBefore: wheelResult?.before ?? null,
      scrollTopAfter: wheelResult?.after ?? null,
      scrollHeightBefore: wheelResult?.scrollHeightBefore ?? wheelResult?.max ?? null,
      scrollHeightAfter: wheelResult?.scrollHeightAfter ?? wheelResult?.max ?? null,
      scrollClientHeight: wheelResult?.clientHeight ?? null
    });

    let previousOffset = 0;
    for (const offsetMs of event.sampleOffsetsMs) {
      const waitMs = Math.max(0, offsetMs - previousOffset);
      if (waitMs > 0) await sleep(waitMs);
      previousOffset = offsetMs;

      safetyStop = getSafetyStop();
      if (safetyStop) break;
      if (getOlderPageCount() > olderPageStart) {
        uniquePush(failureCodes, 'UNEXPECTED_OLDER_PAGE_NETWORK_REQUEST');
        break;
      }

      const current = await sample({
        eventIndex: eventIndex + 1,
        profile: event.profile,
        deltaY: event.deltaY,
        timestampOffsetMs: offsetMs
      });
      samples.push(current);
      for (const code of evaluateTransientScrollSample(current, { configuredRounds })) uniquePush(failureCodes, code);

      safetyStop = getSafetyStop();
      if (safetyStop) break;
      if (getOlderPageCount() > olderPageStart) uniquePush(failureCodes, 'UNEXPECTED_OLDER_PAGE_NETWORK_REQUEST');
      if (failureCodes.length > 0) break;
    }

    if (safetyStop || failureCodes.length > 0) break;
  }

  const summary = summarizeTransientSamples(samples, { configuredRounds });
  for (const code of summary.failureCodes) uniquePush(failureCodes, code);
  const planCompletion = evaluateRealisticScrollPlanCompletion({
    plan: boundedPlan,
    wheelEvents,
    samples,
    safetyStop,
    failureCodes
  });
  if (planCompletion.failureCode) uniquePush(failureCodes, planCompletion.failureCode);

  return {
    wheelEvents,
    samples,
    failureCodes,
    safetyStop,
    planCompletion,
    olderPageRequests: Math.max(0, getOlderPageCount() - olderPageStart),
    diagnostics: summary.diagnostics
  };
}
