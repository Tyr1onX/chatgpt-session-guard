import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  MIN_SAFE_NETWORK_TURNS,
  applyModePreset,
  networkHistoryTarget,
  normalizeConfig
} from '../src/shared/config';

describe('configuration', () => {
  it('uses Balanced 8-round conservative defaults', () => {
    expect(normalizeConfig(null)).toEqual(DEFAULT_CONFIG);
    expect(DEFAULT_CONFIG.version).toBe(2);
    expect(DEFAULT_CONFIG.mode).toBe('balanced');
    expect(DEFAULT_CONFIG.historyUnit).toBe('round');
    expect(DEFAULT_CONFIG.historyCount).toBe(8);
    expect(DEFAULT_CONFIG.autoLoadHistory).toBe(false);
    expect(DEFAULT_CONFIG.hardSwitchEnabled).toBe(false);
  });

  it('migrates v1 recentRounds without losing the user setting', () => {
    const config = normalizeConfig({ version: 1, recentRounds: 6, mode: 'balanced', domBudget: 6500 });
    expect(config.version).toBe(2);
    expect(config.historyUnit).toBe('round');
    expect(config.historyCount).toBe(6);
    expect(config.recentRounds).toBe(6);
    expect(config.domBudget).toBe(6500);
  });

  it('supports 1..50 visible history and clamps batches', () => {
    const config = normalizeConfig({ historyUnit: 'message', historyCount: 99, historyBatchSize: 0, domBudget: 999999, mode: 'bad' });
    expect(config.historyUnit).toBe('message');
    expect(config.historyCount).toBe(50);
    expect(config.historyBatchSize).toBe(1);
    expect(config.domBudget).toBe(30000);
    expect(config.mode).toBe('balanced');
  });

  it('applies Ultra Lite as a Balanced-engine low-history preset', () => {
    const config = applyModePreset(DEFAULT_CONFIG, 'ultra-lite');
    expect(config.mode).toBe('ultra-lite');
    expect(config.historyUnit).toBe('round');
    expect(config.historyCount).toBe(1);
    expect(config.historyBatchSize).toBe(10);
    expect(config.autoLoadHistory).toBe(false);
    expect(config.hardSwitchEnabled).toBe(false);
    expect(config.domBudget).toBe(DEFAULT_CONFIG.domBudget);
  });

  it('keeps a conservative network floor for 1-message and 1-round targets', () => {
    expect(MIN_SAFE_NETWORK_TURNS).toBe(4);
    expect(networkHistoryTarget(normalizeConfig({ historyUnit: 'message', historyCount: 1 }))).toBe(4);
    expect(networkHistoryTarget(normalizeConfig({ historyUnit: 'round', historyCount: 1 }))).toBe(4);
    expect(networkHistoryTarget(normalizeConfig({ historyUnit: 'round', historyCount: 8 }))).toBe(8);
  });
});
