import { readFileSync } from 'node:fs';
import {
  FIELD_MAX_INCIDENT_BYTES,
  FIELD_MAX_INCIDENTS,
  FIELD_RING_CAPACITY,
  FIELD_STORAGE_KEY,
  FieldIncidentRepository,
  FieldRingBuffer,
  createFieldIncident,
  emptyFieldStore,
  evaluateFieldSample,
  fieldDiagnostics,
  fieldRecorderEnabled,
  normalizeFieldStore,
  sanitizeFieldSample,
  serializedIncidentSize,
  type FieldIncident,
  type FieldSample,
  type FieldStorageAdapter
} from '../src/shared/field-recorder';

function sample(overrides: Partial<FieldSample> = {}): FieldSample {
  return {
    timestamp: 1_000,
    source: 'idle',
    conversationHash: 'h-conversation',
    scrollTop: 10_000,
    scrollHeight: 20_000,
    clientHeight: 800,
    placeholderPresent: true,
    placeholderVisible: true,
    placeholderIntersectsViewport: false,
    configuredRounds: 1,
    visibleTurns: 2,
    visibleRounds: 1,
    oldTurnsVisibleInLayout: false,
    oldTurnsIntersectViewport: false,
    boundaryIndex: 10,
    boundaryTurnHash: 'h-boundary',
    metricsRenderedRounds: 1,
    metricsHiddenRounds: 10,
    temporaryFullHistory: false,
    historyExpansion: 0,
    guardEnabled: true,
    guardMode: 'ultra-lite',
    mutationMarker: 0,
    evaluateMarker: 0,
    ...overrides
  };
}

function incident(id: string, timestamp: number): FieldIncident {
  return createFieldIncident({
    id,
    buildId: 'abc-field',
    triggerTimestamp: timestamp,
    incidentCodes: ['PLACEHOLDER_VISIBILITY_CONTRADICTION'],
    samples: [sample({ timestamp, oldTurnsVisibleInLayout: true })]
  });
}

class MemoryStorage implements FieldStorageAdapter {
  readonly data: Record<string, unknown> = {};

  async get(key: string): Promise<Record<string, unknown>> {
    return { [key]: this.data[key] };
  }

  async set(items: Record<string, unknown>): Promise<void> {
    Object.assign(this.data, items);
  }

  async remove(key: string): Promise<void> {
    delete this.data[key];
  }
}

describe('Passive Field Recorder', () => {
  it('does not trigger for a normal Ultra Lite sample', () => {
    expect(evaluateFieldSample(sample())).toEqual([]);
  });

  it('captures placeholder plus old-turn visibility in the same frame', () => {
    expect(evaluateFieldSample(sample({ oldTurnsVisibleInLayout: true })))
      .toContain('PLACEHOLDER_VISIBILITY_CONTRADICTION');
  });

  it('captures a 32ms viewport-visible old-turn transient', () => {
    const frames = [
      sample({ timestamp: 0 }),
      sample({ timestamp: 32, oldTurnsVisibleInLayout: true, oldTurnsIntersectViewport: true }),
      sample({ timestamp: 64 })
    ];
    const codes = new Set(frames.flatMap(evaluateFieldSample));
    expect(codes).toContain('VISIBLE_HISTORY_LEAK_IN_VIEWPORT');
  });

  it('captures metrics/DOM divergence', () => {
    expect(evaluateFieldSample(sample({ visibleRounds: 2, metricsRenderedRounds: 1 })))
      .toContain('METRICS_DOM_DIVERGENCE');
  });

  it('keeps an incident after the transient frame recovers', () => {
    const frames = [
      sample({ timestamp: 100 }),
      sample({ timestamp: 132, oldTurnsVisibleInLayout: true }),
      sample({ timestamp: 200, oldTurnsVisibleInLayout: false })
    ];
    const codes = [...new Set(frames.flatMap(evaluateFieldSample))];
    const captured = createFieldIncident({
      id: 'transient',
      buildId: 'abc-field',
      triggerTimestamp: 132,
      incidentCodes: codes,
      samples: frames
    });
    expect(captured.incidentCodes).toContain('PLACEHOLDER_VISIBILITY_CONTRADICTION');
    expect(captured.samples.at(-1)?.oldTurnsVisibleInLayout).toBe(false);
  });

  it('records an older boundary shift as a diagnostic only', () => {
    const diagnostics = fieldDiagnostics([
      sample({ timestamp: 100, boundaryIndex: 10 }),
      sample({ timestamp: 200, boundaryIndex: 8 })
    ]);
    expect(diagnostics).toContain('UNEXPECTED_BOUNDARY_SHIFT');
    expect(evaluateFieldSample(sample())).toEqual([]);
  });

  it('records a transient scrollHeight spike as diagnostic only', () => {
    const diagnostics = fieldDiagnostics([
      sample({ timestamp: 100, scrollHeight: 10_000 }),
      sample({ timestamp: 150, scrollHeight: 13_000 }),
      sample({ timestamp: 220, scrollHeight: 10_100 })
    ]);
    expect(diagnostics).toContain('TRANSIENT_SCROLLHEIGHT_SPIKE');
  });

  it('keeps a bounded pre-trigger ring window', () => {
    const ring = new FieldRingBuffer<FieldSample>(5);
    for (let index = 0; index < 10; index += 1) ring.push(sample({ timestamp: index * 1_000 }));
    expect(ring.size).toBe(5);
    expect(ring.since(7_000).map((item) => item.timestamp)).toEqual([7_000, 8_000, 9_000]);
  });

  it('preserves post-trigger samples in the frozen incident', () => {
    const captured = createFieldIncident({
      id: 'post',
      buildId: 'abc-field',
      triggerTimestamp: 5_000,
      incidentCodes: ['PLACEHOLDER_VISIBILITY_CONTRADICTION'],
      samples: [
        sample({ timestamp: 0 }),
        sample({ timestamp: 5_000, oldTurnsVisibleInLayout: true }),
        sample({ timestamp: 7_500 })
      ]
    });
    expect(captured.samples.map((item) => item.timestamp)).toEqual([0, 5_000, 7_500]);
  });

  it('limits persistent storage to the newest incidents', async () => {
    const storage = new MemoryStorage();
    const repository = new FieldIncidentRepository(storage);
    for (let index = 0; index < FIELD_MAX_INCIDENTS + 3; index += 1) {
      await repository.add(incident(`i-${index}`, index));
    }
    const store = await repository.load();
    expect(store.incidents).toHaveLength(FIELD_MAX_INCIDENTS);
    expect(store.incidents.map((item) => item.id)).toEqual(['i-3', 'i-4', 'i-5', 'i-6', 'i-7']);
  });

  it('evicts the oldest incident first', async () => {
    const storage = new MemoryStorage();
    const repository = new FieldIncidentRepository(storage);
    for (let index = 0; index < 6; index += 1) await repository.add(incident(`oldest-${index}`, index));
    expect((await repository.load()).incidents[0]?.id).toBe('oldest-1');
  });

  it('falls back to an empty store when storage is corrupted', () => {
    expect(normalizeFieldStore('broken')).toEqual(emptyFieldStore());
    expect(normalizeFieldStore({ schemaVersion: 999, incidents: ['bad'] })).toEqual(emptyFieldStore());
  });

  it('resets persisted incidents', async () => {
    const storage = new MemoryStorage();
    const repository = new FieldIncidentRepository(storage);
    await repository.add(incident('reset-me', 1));
    expect(storage.data[FIELD_STORAGE_KEY]).toBeTruthy();
    await repository.reset();
    expect(await repository.load()).toEqual(emptyFieldStore());
  });

  it('keeps the recorder disabled for production builds', () => {
    expect(fieldRecorderEnabled(false)).toBe(false);
  });

  it('enables the recorder for Field Debug builds', () => {
    expect(fieldRecorderEnabled(true)).toBe(true);
  });

  it('never serializes chat text, answers, titles, files or HTML from untrusted sample input', () => {
    const sanitized = sanitizeFieldSample({
      ...sample(),
      textContent: 'SECRET_PROMPT_123',
      innerText: 'SECRET_ANSWER_456',
      innerHTML: '<b>SECRET_PROMPT_123</b>',
      title: 'PRIVATE_CHAT_TITLE',
      uploadedFileName: 'PRIVATE_FILE.pdf',
      imageContent: 'PRIVATE_IMAGE'
    });
    const captured = createFieldIncident({
      id: 'privacy',
      buildId: 'abc-field',
      triggerTimestamp: sanitized.timestamp,
      incidentCodes: ['PLACEHOLDER_VISIBILITY_CONTRADICTION'],
      samples: [sanitized]
    });
    const serialized = JSON.stringify(captured);
    for (const secret of ['SECRET_PROMPT_123', 'SECRET_ANSWER_456', 'PRIVATE_CHAT_TITLE', 'PRIVATE_FILE.pdf', 'PRIVATE_IMAGE']) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('contains no active network API in the recorder runtime', () => {
    const source = readFileSync('src/content/field-recorder.ts', 'utf8');
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toContain('XMLHttpRequest');
    expect(source).not.toContain('sendBeacon');
  });

  it('stays bounded after 10,000 samples and keeps incident serialization under the cap', () => {
    const ring = new FieldRingBuffer<FieldSample>();
    for (let index = 0; index < 10_000; index += 1) ring.push(sample({ timestamp: index }));
    expect(ring.size).toBe(FIELD_RING_CAPACITY);
    const captured = createFieldIncident({
      id: 'bounded',
      buildId: 'abc-field',
      triggerTimestamp: 9_900,
      incidentCodes: ['VISIBLE_HISTORY_LEAK_IN_VIEWPORT'],
      samples: ring.values()
    });
    expect(captured.samples.length).toBeLessThanOrEqual(FIELD_RING_CAPACITY);
    expect(serializedIncidentSize(captured)).toBeLessThanOrEqual(FIELD_MAX_INCIDENT_BYTES);
  });
});
