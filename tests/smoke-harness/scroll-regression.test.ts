import {
  HARD_WHEEL_EVENT_LIMIT,
  createRealisticWheelPlan,
  evaluateRealisticScrollPlanCompletion,
  evaluateTransientScrollSample,
  runRealisticScrollPlan,
  summarizeTransientSamples
} from '../../scripts/smoke/scroll-regression.mjs';

function frame(overrides: Record<string, unknown> = {}) {
  return {
    timestampOffsetMs: 0,
    scrollTop: 1000,
    scrollHeight: 5000,
    placeholderVisible: true,
    placeholderIntersectsViewport: false,
    visibleRoundCount: 1,
    viewportVisibleRoundCount: 1,
    oldTurnsVisible: false,
    oldTurnsIntersectViewport: false,
    generationActive: false,
    metricsRenderedRounds: 1,
    metricsHiddenRounds: 10,
    metricsBoundaryIndex: 10,
    ...overrides
  };
}

describe('realistic scroll regression harness', () => {
  it('builds a bounded gentle/normal/burst wheel plan', () => {
    const plan = createRealisticWheelPlan();
    expect(plan).toHaveLength(16);
    expect(new Set(plan.map((event) => event.profile))).toEqual(new Set(['gentle', 'normal', 'burst']));
    expect(plan.every((event) => event.deltaY < 0)).toBe(true);
    expect(createRealisticWheelPlan({ maxEvents: 100 })).toHaveLength(16);
    expect(plan.length).toBeLessThanOrEqual(HARD_WHEEL_EVENT_LIMIT);
  });

  it('hard-caps custom wheel plans at 30 events', async () => {
    let wheels = 0;
    const plan = Array.from({ length: 40 }, () => ({ profile: 'normal', deltaY: -420, sampleOffsetsMs: [0] }));
    const result = await runRealisticScrollPlan({
      plan,
      wheel: async () => {
        wheels += 1;
        return { moved: true, before: 1000, after: 900, max: 5000 };
      },
      sample: async (meta: Record<string, unknown>) => frame(meta),
      sleep: async () => undefined
    });
    expect(wheels).toBe(HARD_WHEEL_EVENT_LIMIT);
    expect(result.wheelEvents).toHaveLength(HARD_WHEEL_EVENT_LIMIT);
  });

  it('passes when old history stays hidden throughout the sampling window', () => {
    const samples = [frame({ timestampOffsetMs: 0 }), frame({ timestampOffsetMs: 32 }), frame({ timestampOffsetMs: 250 })];
    expect(summarizeTransientSamples(samples).failureCodes).toEqual([]);
  });

  it('fails when an old turn is transiently visible while the placeholder remains visible', () => {
    const samples = [
      frame({ timestampOffsetMs: 0 }),
      frame({ timestampOffsetMs: 32, oldTurnsVisible: true }),
      frame({ timestampOffsetMs: 100, oldTurnsVisible: false })
    ];
    const result = summarizeTransientSamples(samples);
    expect(result.failureCodes).toContain('PLACEHOLDER_VISIBILITY_CONTRADICTION');
    expect(result.failureCodes).toContain('TRANSIENT_HISTORY_VISIBILITY_LEAK');
  });

  it('keeps a one-frame metrics/DOM divergence as a failure even after recovery', () => {
    const samples = [
      frame({ timestampOffsetMs: 0 }),
      frame({ timestampOffsetMs: 50, visibleRoundCount: 2, metricsRenderedRounds: 1 }),
      frame({ timestampOffsetMs: 150, visibleRoundCount: 1, metricsRenderedRounds: 1 })
    ];
    const result = summarizeTransientSamples(samples);
    expect(result.failureCodes).toContain('METRICS_DOM_DIVERGENCE');
  });

  it('flags a viewport-visible history leak as an additive transient failure', () => {
    const codes = evaluateTransientScrollSample(frame({
      placeholderIntersectsViewport: true,
      oldTurnsVisible: true,
      oldTurnsIntersectViewport: true,
      viewportVisibleRoundCount: 2,
      visibleRoundCount: 2
    }));
    expect(codes).toContain('VISIBLE_HISTORY_LEAK_IN_VIEWPORT');
    expect(codes).toContain('TRANSIENT_HISTORY_VISIBILITY_LEAK');
    expect(codes).toContain('PLACEHOLDER_VISIBILITY_CONTRADICTION');
  });

  it('records a transient scroll-height spike as diagnostic only', () => {
    const result = summarizeTransientSamples([
      frame({ scrollHeight: 5000 }),
      frame({ scrollHeight: 6200 }),
      frame({ scrollHeight: 5050 })
    ]);
    expect(result.diagnostics.transientScrollHeightSpike).toBe(true);
    expect(result.failureCodes).toEqual([]);
  });

  it('records an older-boundary shift as a diagnostic', () => {
    const result = summarizeTransientSamples([
      frame({ metricsBoundaryIndex: 10 }),
      frame({ metricsBoundaryIndex: 8 }),
      frame({ metricsBoundaryIndex: 10 })
    ]);
    expect(result.diagnostics.unexpectedBoundaryShift).toBe(true);
  });

  it('stops wheel orchestration immediately after a transient failure', async () => {
    let wheels = 0;
    let samples = 0;
    const plan = createRealisticWheelPlan({ maxEvents: 5 });
    const result = await runRealisticScrollPlan({
      plan,
      wheel: async () => {
        wheels += 1;
        return { moved: true, before: 1000, after: 900, max: 5000 };
      },
      sample: async (meta: Record<string, unknown>) => {
        samples += 1;
        return frame({ ...meta, oldTurnsVisible: true });
      },
      sleep: async () => undefined
    });
    expect(result.failureCodes).toContain('PLACEHOLDER_VISIBILITY_CONTRADICTION');
    expect(wheels).toBe(1);
    expect(samples).toBe(1);
  });

  it('runs the full realistic wheel plan even when movement telemetry reports false', async () => {
    const plan = createRealisticWheelPlan();
    const result = await runRealisticScrollPlan({
      plan,
      wheel: async () => ({ moved: false, before: 0, after: 0, max: 5000 }),
      sample: async (meta: Record<string, unknown>) => frame(meta),
      sleep: async () => undefined
    });
    expect(result.wheelEvents).toHaveLength(plan.length);
    expect(new Set(result.wheelEvents.map((event) => event.profile))).toEqual(new Set(['gentle', 'normal', 'burst']));
  });

  it('marks an incomplete plan as a harness failure when there is no legitimate stop', () => {
    const plan = createRealisticWheelPlan();
    const wheelEvents = plan.slice(0, 3).map((event) => ({ profile: event.profile }));
    const samples = Array.from({ length: 21 }, () => frame());
    const result = evaluateRealisticScrollPlanCompletion({ plan, wheelEvents, samples });
    expect(result.complete).toBe(false);
    expect(result.failureCode).toBe('INCOMPLETE_REALISTIC_SCROLL_PLAN');
    expect(result.plannedPhases).toEqual(['gentle', 'normal', 'burst']);
    expect(result.executedPhases).toEqual(['gentle']);
    expect(result.executedWheelEvents).toBe(3);
  });

  it('does not replace a legitimate scroll failure with incomplete-plan failure', () => {
    const plan = createRealisticWheelPlan();
    const result = evaluateRealisticScrollPlanCompletion({
      plan,
      wheelEvents: [{ profile: 'gentle' }],
      samples: [frame()],
      failureCodes: ['PLACEHOLDER_VISIBILITY_CONTRADICTION']
    });
    expect(result.complete).toBe(false);
    expect(result.failureCode).toBeNull();
  });

  it('stops immediately when an older-page network request appears', async () => {
    let olderPages = 0;
    let wheels = 0;
    const result = await runRealisticScrollPlan({
      plan: createRealisticWheelPlan({ maxEvents: 5 }),
      wheel: async () => {
        wheels += 1;
        olderPages = 1;
        return { moved: true, before: 1000, after: 900, max: 5000 };
      },
      sample: async (meta: Record<string, unknown>) => frame(meta),
      sleep: async () => undefined,
      getOlderPageCount: () => olderPages
    });
    expect(result.failureCodes).toContain('UNEXPECTED_OLDER_PAGE_NETWORK_REQUEST');
    expect(wheels).toBe(1);
    expect(result.samples).toHaveLength(0);
  });

  it('honors a 429-style safety stop before issuing another wheel event', async () => {
    let wheels = 0;
    let safetyStop: string | null = null;
    const result = await runRealisticScrollPlan({
      plan: createRealisticWheelPlan({ maxEvents: 5 }),
      wheel: async () => {
        wheels += 1;
        safetyStop = 'ABORTED_RATE_LIMIT';
        return { moved: true, before: 1000, after: 900, max: 5000 };
      },
      sample: async (meta: Record<string, unknown>) => frame(meta),
      sleep: async () => undefined,
      getSafetyStop: () => safetyStop
    });
    expect(result.safetyStop).toBe('ABORTED_RATE_LIMIT');
    expect(wheels).toBe(1);
    expect(result.samples).toHaveLength(0);
  });
});
