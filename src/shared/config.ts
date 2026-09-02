export type GuardMode = 'safe' | 'balanced' | 'aggressive';

export interface GuardConfig {
  version: 1;
  enabled: boolean;
  mode: GuardMode;
  recentRounds: number;
  minRounds: number;
  targetRounds: number;
  maxRounds: number;
  domBudget: number;
  temporaryFullHistory: boolean;
  hardSwitchEnabled: boolean;
  debug: boolean;
}

export const STORAGE_KEY = 'csg.settings.v1';

export const DEFAULT_CONFIG: GuardConfig = {
  version: 1,
  enabled: true,
  mode: 'balanced',
  recentRounds: 8,
  minRounds: 4,
  targetRounds: 8,
  maxRounds: 12,
  domBudget: 7000,
  temporaryFullHistory: false,
  hardSwitchEnabled: false,
  debug: false
};

const MODES = new Set<GuardMode>(['safe', 'balanced', 'aggressive']);

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback;
}

export function normalizeConfig(input: unknown): GuardConfig {
  const raw = typeof input === 'object' && input !== null ? input as Partial<GuardConfig> : {};
  const minRounds = clampInteger(raw.minRounds, DEFAULT_CONFIG.minRounds, 1, 20);
  const maxRounds = Math.max(minRounds, clampInteger(raw.maxRounds, DEFAULT_CONFIG.maxRounds, minRounds, 30));
  const targetRounds = clampInteger(raw.targetRounds, DEFAULT_CONFIG.targetRounds, minRounds, maxRounds);

  return {
    version: 1,
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_CONFIG.enabled,
    mode: typeof raw.mode === 'string' && MODES.has(raw.mode as GuardMode)
      ? raw.mode as GuardMode
      : DEFAULT_CONFIG.mode,
    recentRounds: clampInteger(raw.recentRounds, DEFAULT_CONFIG.recentRounds, 4, 20),
    minRounds,
    targetRounds,
    maxRounds,
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
