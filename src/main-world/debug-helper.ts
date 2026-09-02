import { EVENTS, dispatchStringEvent, parseStringEvent, type NetworkMode } from '../shared/events';
import type { DebugMetrics } from '../shared/types';

interface CsgDebugApi {
  snapshot(): DebugMetrics | null;
  history(): DebugMetrics[];
  clearHistory(): void;
  setHardSwitchEnabled(enabled: boolean): void;
}

declare global {
  interface Window {
    __CSG_DEBUG__?: CsgDebugApi;
  }
}

const MAX_HISTORY = 200;
const NETWORK_MODES = new Set<NetworkMode>(['legacy', 'paginated', 'unknown', 'disabled']);

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function sanitizeMetrics(value: unknown): DebugMetrics | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Partial<DebugMetrics>;
  const networkMode = NETWORK_MODES.has(item.networkMode as NetworkMode)
    ? item.networkMode as NetworkMode
    : 'unknown';

  return {
    conversationId: typeof item.conversationId === 'string' ? item.conversationId : null,
    spaSwitchCount: finiteNumber(item.spaSwitchCount) ?? 0,
    renderedRounds: finiteNumber(item.renderedRounds) ?? 0,
    totalRounds: finiteNumber(item.totalRounds) ?? 0,
    conversationDomNodes: finiteNumber(item.conversationDomNodes) ?? 0,
    activeConversationDomNodes: finiteNumber(item.activeConversationDomNodes) ?? 0,
    totalDocumentDomNodes: finiteNumber(item.totalDocumentDomNodes) ?? 0,
    networkMode,
    networkModified: item.networkModified === true,
    networkRequestedTurns: finiteNumber(item.networkRequestedTurns),
    networkEffectiveTurns: finiteNumber(item.networkEffectiveTurns),
    cleanupCount: finiteNumber(item.cleanupCount) ?? 0,
    hardSwitchCount: finiteNumber(item.hardSwitchCount) ?? 0,
    switchLatencyMs: finiteNumber(item.switchLatencyMs),
    jsHeapMb: finiteNumber(item.jsHeapMb),
    lastUpdatedAt: finiteNumber(item.lastUpdatedAt) ?? 0
  };
}

export function installDebugHelper(): void {
  if (window.__CSG_DEBUG__) return;

  let latest: DebugMetrics | null = null;
  const snapshots: DebugMetrics[] = [];

  window.addEventListener(EVENTS.debugMetrics, (event) => {
    const parsed = parseStringEvent<unknown>(event);
    const sanitized = sanitizeMetrics(parsed);
    if (sanitized) latest = sanitized;
  });

  window.__CSG_DEBUG__ = Object.freeze({
    snapshot(): DebugMetrics | null {
      if (!latest) return null;
      const copy = { ...latest };
      snapshots.push(copy);
      if (snapshots.length > MAX_HISTORY) snapshots.splice(0, snapshots.length - MAX_HISTORY);
      return { ...copy };
    },
    history(): DebugMetrics[] {
      return snapshots.map((snapshot) => ({ ...snapshot }));
    },
    clearHistory(): void {
      snapshots.length = 0;
    },
    setHardSwitchEnabled(enabled: boolean): void {
      dispatchStringEvent(EVENTS.debugCommand, { type: 'set-hard-switch', enabled: Boolean(enabled) });
    }
  });
}
