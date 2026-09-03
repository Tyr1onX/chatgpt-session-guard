export const EVENTS = {
  config: 'csg:config',
  requestConfig: 'csg:request-config',
  navigation: 'csg:navigation',
  networkStatus: 'csg:network-status',
  debugMetrics: 'csg:debug-metrics',
  debugCommand: 'csg:debug-command',
  loadPreviousHistory: 'csg:load-previous-history',
  temporaryFullHistory: 'csg:temporary-full-history',
  stats: 'csg:stats-event'
} as const;

export type NetworkMode = 'legacy' | 'paginated' | 'unknown' | 'disabled';

export interface NetworkStatus {
  mode: NetworkMode;
  modified: boolean;
  totalRounds?: number;
  keptRounds?: number;
  requestedTurns?: number;
  effectiveTurns?: number;
}

export interface DebugCommand {
  type: 'set-hard-switch';
  enabled: boolean;
}

export type GuardStatsEvent = {
  type:
    | 'session-open-attempt'
    | 'session-open-success'
    | 'failed-open-429'
    | 'history-request'
    | 'single-flight-hit'
    | 'older-page-suppressed'
    | 'rate-limit-cooldown-start'
    | 'rate-limit-cooldown-hit';
};

export function dispatchStringEvent(name: string, value: unknown): void {
  window.dispatchEvent(new CustomEvent<string>(name, { detail: JSON.stringify(value) }));
}

export function parseStringEvent<T>(event: Event): T | null {
  if (!(event instanceof CustomEvent) || typeof event.detail !== 'string') return null;
  try {
    return JSON.parse(event.detail) as T;
  } catch {
    return null;
  }
}
