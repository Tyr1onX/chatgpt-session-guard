import type { GuardMode } from './config';

export const FIELD_STORAGE_KEY = 'csg.field.incidents.v1';
export const FIELD_SCHEMA_VERSION = 1 as const;
export const FIELD_MAX_INCIDENTS = 5;
export const FIELD_MAX_INCIDENT_BYTES = 1_500_000;
export const FIELD_RING_CAPACITY = 320;
export const FIELD_PRE_TRIGGER_MS = 5_000;
export const FIELD_POST_TRIGGER_MS = 2_500;
export const FIELD_IDLE_SAMPLE_MS = 200;
export const FIELD_BURST_SAMPLE_MS = 32;
export const FIELD_BURST_WINDOW_MS = 1_200;

export type FieldSampleSource = 'idle' | 'scroll' | 'wheel' | 'mutation' | 'evaluate' | 'navigation';
export type FieldIncidentCode =
  | 'PLACEHOLDER_VISIBILITY_CONTRADICTION'
  | 'VISIBLE_HISTORY_LEAK_IN_VIEWPORT'
  | 'METRICS_DOM_DIVERGENCE';
export type FieldDiagnosticCode = 'UNEXPECTED_BOUNDARY_SHIFT' | 'TRANSIENT_SCROLLHEIGHT_SPIKE';

export interface FieldSample {
  timestamp: number;
  source: FieldSampleSource;
  conversationHash: string | null;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  placeholderPresent: boolean;
  placeholderVisible: boolean;
  placeholderIntersectsViewport: boolean;
  configuredRounds: number;
  visibleTurns: number;
  visibleRounds: number;
  oldTurnsVisibleInLayout: boolean;
  oldTurnsIntersectViewport: boolean;
  boundaryIndex: number | null;
  boundaryTurnHash: string | null;
  metricsRenderedRounds: number;
  metricsHiddenRounds: number;
  temporaryFullHistory: boolean;
  historyExpansion: number;
  guardEnabled: boolean;
  guardMode: GuardMode;
  mutationMarker: number;
  evaluateMarker: number;
}

export interface FieldTraceExcerpt {
  timestamp: number;
  type: 'navigation' | 'evaluate' | 'observer';
  reason?: string;
  evaluateDurationMs?: number;
  observerMutationCount?: number;
  ignoredExtensionMutationCount?: number;
  cleanupCount: number;
  visualRestoreCount: number;
  scrollHeight?: number;
}

export interface FieldNetworkSummary {
  historyRequestCount: number;
  olderPageNetworkCount: number;
  olderPageSuppressedCount: number;
  rateLimitedHistoryRequestCount: number;
  singleFlightHitCount: number;
  unclassifiedHistoryLikeCount: number;
}

export interface FieldIncident {
  schemaVersion: 1;
  id: string;
  buildId: string;
  timestamp: number;
  triggerTimestamp: number;
  incidentCodes: FieldIncidentCode[];
  diagnosticCodes: FieldDiagnosticCode[];
  conversationHash: string | null;
  config: {
    guardEnabled: boolean;
    guardMode: GuardMode;
    configuredRounds: number;
    temporaryFullHistory: boolean;
    historyExpansion: number;
  };
  samples: FieldSample[];
  traceExcerpt: FieldTraceExcerpt[];
  networkSummary: FieldNetworkSummary;
  diagnostics: {
    visibleRoundsPeak: number;
    oldTurnsViewportLeak: boolean;
    placeholderVisibleAtTrigger: boolean;
    boundaryShiftDetected: boolean;
    scrollHeightBefore: number;
    scrollHeightPeak: number;
    scrollHeightAfter: number;
  };
}

export interface FieldIncidentStore {
  schemaVersion: 1;
  incidents: FieldIncident[];
}

export interface FieldRecorderStatus {
  enabled: boolean;
  listening: boolean;
  buildId: string;
  incidentCount: number;
  recentCode: FieldIncidentCode | null;
}

export interface FieldStorageAdapter {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

const EMPTY_NETWORK_SUMMARY: FieldNetworkSummary = {
  historyRequestCount: 0,
  olderPageNetworkCount: 0,
  olderPageSuppressedCount: 0,
  rateLimitedHistoryRequestCount: 0,
  singleFlightHitCount: 0,
  unclassifiedHistoryLikeCount: 0
};

function finite(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function boolean(value: unknown): boolean {
  return value === true;
}

function shortString(value: unknown, max = 96): string | null {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, max) : null;
}

function source(value: unknown): FieldSampleSource {
  return ['idle', 'scroll', 'wheel', 'mutation', 'evaluate', 'navigation'].includes(String(value))
    ? value as FieldSampleSource
    : 'idle';
}

function mode(value: unknown): GuardMode {
  return ['safe', 'balanced', 'ultra-lite', 'aggressive'].includes(String(value))
    ? value as GuardMode
    : 'balanced';
}

export function fieldRecorderEnabled(fieldBuild: boolean): boolean {
  return fieldBuild;
}

export class FieldRingBuffer<T extends { timestamp: number }> {
  private readonly items: T[] = [];

  constructor(private readonly capacity = FIELD_RING_CAPACITY) {}

  push(item: T): void {
    this.items.push(item);
    if (this.items.length > this.capacity) this.items.splice(0, this.items.length - this.capacity);
  }

  values(): T[] {
    return [...this.items];
  }

  since(timestamp: number): T[] {
    return this.items.filter((item) => item.timestamp >= timestamp);
  }

  get size(): number {
    return this.items.length;
  }
}

export function opaqueHash(value: string | null, salt = 'csg-field'): string | null {
  if (!value) return null;
  let a = 0x811c9dc5;
  let b = 0x9e3779b9;
  const input = `${salt}:${value}`;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    a ^= code;
    a = Math.imul(a, 0x01000193) >>> 0;
    b ^= code + index;
    b = Math.imul(b, 0x85ebca6b) >>> 0;
  }
  return `h-${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`;
}

export function sanitizeFieldSample(input: unknown): FieldSample {
  const raw = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const boundaryIndex = typeof raw.boundaryIndex === 'number' && Number.isFinite(raw.boundaryIndex) ? raw.boundaryIndex : null;
  return {
    timestamp: finite(raw.timestamp, Date.now()),
    source: source(raw.source),
    conversationHash: shortString(raw.conversationHash),
    scrollTop: finite(raw.scrollTop),
    scrollHeight: finite(raw.scrollHeight),
    clientHeight: finite(raw.clientHeight),
    placeholderPresent: boolean(raw.placeholderPresent),
    placeholderVisible: boolean(raw.placeholderVisible),
    placeholderIntersectsViewport: boolean(raw.placeholderIntersectsViewport),
    configuredRounds: Math.max(0, Math.round(finite(raw.configuredRounds))),
    visibleTurns: Math.max(0, Math.round(finite(raw.visibleTurns))),
    visibleRounds: Math.max(0, Math.round(finite(raw.visibleRounds))),
    oldTurnsVisibleInLayout: boolean(raw.oldTurnsVisibleInLayout),
    oldTurnsIntersectViewport: boolean(raw.oldTurnsIntersectViewport),
    boundaryIndex,
    boundaryTurnHash: shortString(raw.boundaryTurnHash),
    metricsRenderedRounds: Math.max(0, Math.round(finite(raw.metricsRenderedRounds))),
    metricsHiddenRounds: Math.max(0, Math.round(finite(raw.metricsHiddenRounds))),
    temporaryFullHistory: boolean(raw.temporaryFullHistory),
    historyExpansion: Math.max(0, Math.round(finite(raw.historyExpansion))),
    guardEnabled: boolean(raw.guardEnabled),
    guardMode: mode(raw.guardMode),
    mutationMarker: Math.max(0, Math.round(finite(raw.mutationMarker))),
    evaluateMarker: Math.max(0, Math.round(finite(raw.evaluateMarker)))
  };
}

export function evaluateFieldSample(sample: FieldSample): FieldIncidentCode[] {
  const codes: FieldIncidentCode[] = [];
  if (sample.placeholderVisible && sample.oldTurnsVisibleInLayout) {
    codes.push('PLACEHOLDER_VISIBILITY_CONTRADICTION');
  }
  if (sample.oldTurnsIntersectViewport) {
    codes.push('VISIBLE_HISTORY_LEAK_IN_VIEWPORT');
  }
  if (sample.metricsRenderedRounds <= sample.configuredRounds && sample.visibleRounds > sample.configuredRounds) {
    codes.push('METRICS_DOM_DIVERGENCE');
  }
  return codes;
}

export function fieldDiagnostics(samples: FieldSample[]): FieldDiagnosticCode[] {
  if (samples.length < 2) return [];
  const codes: FieldDiagnosticCode[] = [];
  const eligible = samples.filter((sample) => sample.guardEnabled && !sample.temporaryFullHistory && sample.historyExpansion === 0);
  for (let index = 1; index < eligible.length; index += 1) {
    const previous = eligible[index - 1];
    const current = eligible[index];
    if (previous?.conversationHash && previous.conversationHash === current?.conversationHash
      && previous.boundaryIndex !== null && current?.boundaryIndex !== null
      && current.boundaryIndex < previous.boundaryIndex) {
      codes.push('UNEXPECTED_BOUNDARY_SHIFT');
      break;
    }
  }

  const heights = samples.map((sample) => sample.scrollHeight).filter((value) => Number.isFinite(value));
  if (heights.length >= 3) {
    const before = heights[0] ?? 0;
    const peak = Math.max(...heights);
    const after = heights.at(-1) ?? before;
    const threshold = Math.max(500, before * 0.15);
    if (peak > before + threshold && after < peak - Math.max(250, (peak - before) * 0.5)) {
      codes.push('TRANSIENT_SCROLLHEIGHT_SPIKE');
    }
  }
  return codes;
}

function safeTraceExcerpt(input: FieldTraceExcerpt[]): FieldTraceExcerpt[] {
  return input.slice(-40).map((event) => ({
    timestamp: finite(event.timestamp),
    type: ['navigation', 'evaluate', 'observer'].includes(event.type) ? event.type : 'observer',
    ...(typeof event.reason === 'string' ? { reason: event.reason.slice(0, 48) } : {}),
    ...(typeof event.evaluateDurationMs === 'number' ? { evaluateDurationMs: finite(event.evaluateDurationMs) } : {}),
    ...(typeof event.observerMutationCount === 'number' ? { observerMutationCount: Math.max(0, Math.round(event.observerMutationCount)) } : {}),
    ...(typeof event.ignoredExtensionMutationCount === 'number' ? { ignoredExtensionMutationCount: Math.max(0, Math.round(event.ignoredExtensionMutationCount)) } : {}),
    cleanupCount: Math.max(0, Math.round(finite(event.cleanupCount))),
    visualRestoreCount: Math.max(0, Math.round(finite(event.visualRestoreCount))),
    ...(typeof event.scrollHeight === 'number' ? { scrollHeight: finite(event.scrollHeight) } : {})
  }));
}

function safeNetworkSummary(input?: Partial<FieldNetworkSummary>): FieldNetworkSummary {
  return {
    historyRequestCount: Math.max(0, Math.round(finite(input?.historyRequestCount))),
    olderPageNetworkCount: Math.max(0, Math.round(finite(input?.olderPageNetworkCount))),
    olderPageSuppressedCount: Math.max(0, Math.round(finite(input?.olderPageSuppressedCount))),
    rateLimitedHistoryRequestCount: Math.max(0, Math.round(finite(input?.rateLimitedHistoryRequestCount))),
    singleFlightHitCount: Math.max(0, Math.round(finite(input?.singleFlightHitCount))),
    unclassifiedHistoryLikeCount: Math.max(0, Math.round(finite(input?.unclassifiedHistoryLikeCount)))
  };
}

export function createFieldIncident(params: {
  id: string;
  buildId: string;
  triggerTimestamp: number;
  incidentCodes: FieldIncidentCode[];
  samples: unknown[];
  traceExcerpt?: FieldTraceExcerpt[];
  networkSummary?: Partial<FieldNetworkSummary>;
}): FieldIncident {
  const samples = params.samples.map(sanitizeFieldSample).slice(-512);
  const trigger = [...samples].reverse().find((sample) => sample.timestamp <= params.triggerTimestamp) ?? samples.at(-1) ?? sanitizeFieldSample({ timestamp: params.triggerTimestamp });
  const diagnostics = fieldDiagnostics(samples);
  const heights = samples.map((sample) => sample.scrollHeight);
  const before = heights[0] ?? 0;
  const peak = heights.length > 0 ? Math.max(...heights) : before;
  const after = heights.at(-1) ?? before;
  const incident: FieldIncident = {
    schemaVersion: FIELD_SCHEMA_VERSION,
    id: shortString(params.id, 96) ?? `incident-${params.triggerTimestamp}`,
    buildId: shortString(params.buildId, 96) ?? 'unknown-field',
    timestamp: Date.now(),
    triggerTimestamp: finite(params.triggerTimestamp),
    incidentCodes: [...new Set(params.incidentCodes)].slice(0, 8),
    diagnosticCodes: diagnostics,
    conversationHash: trigger.conversationHash,
    config: {
      guardEnabled: trigger.guardEnabled,
      guardMode: trigger.guardMode,
      configuredRounds: trigger.configuredRounds,
      temporaryFullHistory: trigger.temporaryFullHistory,
      historyExpansion: trigger.historyExpansion
    },
    samples,
    traceExcerpt: safeTraceExcerpt(params.traceExcerpt ?? []),
    networkSummary: safeNetworkSummary(params.networkSummary ?? EMPTY_NETWORK_SUMMARY),
    diagnostics: {
      visibleRoundsPeak: Math.max(0, ...samples.map((sample) => sample.visibleRounds)),
      oldTurnsViewportLeak: samples.some((sample) => sample.oldTurnsIntersectViewport),
      placeholderVisibleAtTrigger: trigger.placeholderVisible,
      boundaryShiftDetected: diagnostics.includes('UNEXPECTED_BOUNDARY_SHIFT'),
      scrollHeightBefore: before,
      scrollHeightPeak: peak,
      scrollHeightAfter: after
    }
  };
  return fitIncidentSize(incident);
}

export function serializedIncidentSize(incident: FieldIncident): number {
  return new TextEncoder().encode(JSON.stringify(incident)).byteLength;
}

export function fitIncidentSize(incident: FieldIncident, maxBytes = FIELD_MAX_INCIDENT_BYTES): FieldIncident {
  let next: FieldIncident = { ...incident, samples: [...incident.samples], traceExcerpt: [...incident.traceExcerpt] };
  while (serializedIncidentSize(next) > maxBytes && next.traceExcerpt.length > 0) {
    next = { ...next, traceExcerpt: next.traceExcerpt.slice(Math.ceil(next.traceExcerpt.length / 4)) };
  }
  while (serializedIncidentSize(next) > maxBytes && next.samples.length > 16) {
    const triggerIndex = Math.max(0, next.samples.findIndex((sample) => sample.timestamp >= next.triggerTimestamp));
    const keepStart = Math.max(0, triggerIndex - Math.floor((next.samples.length - 1) / 3));
    const kept = next.samples.slice(keepStart);
    next = { ...next, samples: kept.length < next.samples.length ? kept : next.samples.slice(Math.floor(next.samples.length / 4)) };
  }
  return next;
}

export function emptyFieldStore(): FieldIncidentStore {
  return { schemaVersion: FIELD_SCHEMA_VERSION, incidents: [] };
}

function isIncident(value: unknown): value is FieldIncident {
  if (!value || typeof value !== 'object') return false;
  const incident = value as Partial<FieldIncident>;
  return incident.schemaVersion === FIELD_SCHEMA_VERSION
    && typeof incident.id === 'string'
    && typeof incident.buildId === 'string'
    && typeof incident.timestamp === 'number'
    && Array.isArray(incident.incidentCodes)
    && Array.isArray(incident.samples);
}

export function normalizeFieldStore(value: unknown): FieldIncidentStore {
  if (!value || typeof value !== 'object') return emptyFieldStore();
  const raw = value as Partial<FieldIncidentStore>;
  if (raw.schemaVersion !== FIELD_SCHEMA_VERSION || !Array.isArray(raw.incidents)) return emptyFieldStore();
  const incidents = raw.incidents.filter(isIncident).slice(-FIELD_MAX_INCIDENTS).map((incident) => fitIncidentSize(incident));
  return { schemaVersion: FIELD_SCHEMA_VERSION, incidents };
}

export function appendFieldIncident(store: FieldIncidentStore, incident: FieldIncident): FieldIncidentStore {
  return {
    schemaVersion: FIELD_SCHEMA_VERSION,
    incidents: [...store.incidents, fitIncidentSize(incident)].slice(-FIELD_MAX_INCIDENTS)
  };
}

export class FieldIncidentRepository {
  constructor(private readonly storage: FieldStorageAdapter) {}

  async load(): Promise<FieldIncidentStore> {
    try {
      const stored = await this.storage.get(FIELD_STORAGE_KEY);
      return normalizeFieldStore(stored[FIELD_STORAGE_KEY]);
    } catch {
      return emptyFieldStore();
    }
  }

  async add(incident: FieldIncident): Promise<FieldIncidentStore> {
    const next = appendFieldIncident(await this.load(), incident);
    try {
      await this.storage.set({ [FIELD_STORAGE_KEY]: next });
    } catch {
      return await this.load();
    }
    return next;
  }

  async reset(): Promise<void> {
    try {
      await this.storage.remove(FIELD_STORAGE_KEY);
    } catch {
      // Diagnostics storage failure must never affect normal browsing.
    }
  }
}

export function fieldIncidentReport(incident: FieldIncident): string {
  return [
    '# ChatGPT Session Guard Field Incident',
    '',
    `- Build ID: ${incident.buildId}`,
    `- Mode: ${incident.config.guardMode}`,
    `- Configured rounds: ${incident.config.configuredRounds}`,
    `- Incident codes: ${incident.incidentCodes.join(', ') || 'none'}`,
    `- Trigger time: ${new Date(incident.triggerTimestamp).toISOString()}`,
    `- Visible rounds peak: ${incident.diagnostics.visibleRoundsPeak}`,
    `- Old turns viewport leak: ${incident.diagnostics.oldTurnsViewportLeak}`,
    `- Placeholder visible at trigger: ${incident.diagnostics.placeholderVisibleAtTrigger}`,
    `- Boundary shift: ${incident.diagnostics.boundaryShiftDetected}`,
    `- Scroll geometry: ${incident.diagnostics.scrollHeightBefore} → ${incident.diagnostics.scrollHeightPeak} → ${incident.diagnostics.scrollHeightAfter}`,
    `- Older-page network: ${incident.networkSummary.olderPageNetworkCount}`,
    `- Older-page suppressed: ${incident.networkSummary.olderPageSuppressedCount}`,
    `- 429 history responses: ${incident.networkSummary.rateLimitedHistoryRequestCount}`,
    '',
    'Local-only diagnostic. Chat text, prompts, answers, titles, HTML, files and images are not recorded.',
    ''
  ].join('\n');
}
