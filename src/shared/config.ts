export type GuardMode = 'safe' | 'balanced' | 'ultra-lite' | 'aggressive';
export type HistoryUnit = 'message' | 'round';

export interface GuardConfig {
  version: 2;
  enabled: boolean;
  mode: GuardMode;
  historyUnit: HistoryUnit;
  historyCount: number;
  historyBatchSize: number;
  autoLoadHistory: boolean;
  /** Runtime-only expansion supplied from chrome.storage.session. Never persisted as the user's default. */
  historyExpansion: number;
  historyExpansionConversationId: string | null;
  /** @deprecated v1 compatibility mirror. historyUnit/historyCount are authoritative. */
  recentRounds: number;
  /** @deprecated retained for migration/backward compatibility. */
  minRounds: number;
  /** @deprecated retained for migration/backward compatibility. */
  targetRounds: number;
  /** @deprecated retained for migration/backward compatibility. */
  maxRounds: number;
  domBudget: number;
  temporaryFullHistory: boolean;
  hardSwitchEnabled: boolean;
  debug: boolean;
}

export const STORAGE_KEY = 'csg.settings.v1';
export const MIN_SAFE_NETWORK_TURNS = 4;

export const DEFAULT_CONFIG: GuardConfig = {
  version: 2,
  enabled: true,
  mode: 'balanced',
  historyUnit: 'round',
  historyCount: 8,
  historyBatchSize: 10,
  autoLoadHistory: false,
  historyExpansion: 0,
  historyExpansionConversationId: null,
  recentRounds: 8,
  minRounds: 1,
  targetRounds: 8,
  maxRounds: 8,
  domBudget: 7000,
  temporaryFullHistory: false,
  hardSwitchEnabled: false,
  debug: false
};

const MODES = new Set<GuardMode>(['safe', 'balanced', 'ultra-lite', 'aggressive']);
const HISTORY_UNITS = new Set<HistoryUnit>(['message', 'round']);

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback;
}

export function normalizeConfig(input: unknown): GuardConfig {
  const raw = typeof input === 'object' && input !== null
    ? input as Partial<GuardConfig> & { version?: number }
    : {};
  const historyUnit: HistoryUnit = typeof raw.historyUnit === 'string' && HISTORY_UNITS.has(raw.historyUnit as HistoryUnit)
    ? raw.historyUnit as HistoryUnit
    : 'round';
  const migratedCount = raw.historyCount ?? raw.recentRounds;
  const historyCount = clampInteger(migratedCount, DEFAULT_CONFIG.historyCount, 1, 50);
  const historyBatchSize = clampInteger(raw.historyBatchSize, DEFAULT_CONFIG.historyBatchSize, 1, 50);
  const mode = typeof raw.mode === 'string' && MODES.has(raw.mode as GuardMode)
    ? raw.mode as GuardMode
    : DEFAULT_CONFIG.mode;

  return {
    version: 2,
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_CONFIG.enabled,
    mode,
    historyUnit,
    historyCount,
    historyBatchSize,
    autoLoadHistory: typeof raw.autoLoadHistory === 'boolean' ? raw.autoLoadHistory : DEFAULT_CONFIG.autoLoadHistory,
    historyExpansion: clampInteger(raw.historyExpansion, 0, 0, 200),
    historyExpansionConversationId: typeof raw.historyExpansionConversationId === 'string'
      ? raw.historyExpansionConversationId
      : null,
    recentRounds: historyUnit === 'round' ? historyCount : historyCount,
    minRounds: 1,
    targetRounds: historyCount,
    maxRounds: historyCount,
    domBudget: clampInteger(raw.domBudget, DEFAULT_CONFIG.domBudget, 2000, 30000),
    temporaryFullHistory: typeof raw.temporaryFullHistory === 'boolean'
      ? raw.temporaryFullHistory
      : DEFAULT_CONFIG.temporaryFullHistory,
    hardSwitchEnabled: typeof raw.hardSwitchEnabled === 'boolean'
      ? raw.hardSwitchEnabled
      : DEFAULT_CONFIG.hardSwitchEnabled,
    debug: typeof raw.debug === 'boolean' ? raw.debug : DEFAULT_CONFIG.debug
  };
}

export function persistentConfig(config: GuardConfig): GuardConfig {
  return { ...config, historyExpansion: 0, historyExpansionConversationId: null };
}

export function applyModePreset(config: GuardConfig, mode: GuardMode): GuardConfig {
  if (mode !== 'ultra-lite') return normalizeConfig({ ...config, mode });
  return normalizeConfig({
    ...config,
    mode: 'ultra-lite',
    historyUnit: 'round',
    historyCount: 1,
    historyBatchSize: 10,
    autoLoadHistory: false,
    hardSwitchEnabled: false,
    temporaryFullHistory: false
  });
}

export function historyTarget(config: GuardConfig, conversationId?: string | null): number {
  const expansion = conversationId && config.historyExpansionConversationId === conversationId
    ? config.historyExpansion
    : 0;
  return Math.min(250, config.historyCount + expansion);
}

/**
 * ChatGPT Web currently uses num_turns on the initial paginated history request,
 * but its exact low-value semantics for tool/thinking/branch conversations are not public.
 * Keep a conservative floor until real logged-in compatibility benchmarks prove lower values safe.
 */
export function networkHistoryTarget(config: GuardConfig, conversationId?: string | null): number {
  return Math.max(MIN_SAFE_NETWORK_TURNS, historyTarget(config, conversationId));
}
