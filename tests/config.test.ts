import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, normalizeConfig } from '../src/shared/config';

describe('configuration', () => {
  it('uses conservative defaults', () => {
    expect(normalizeConfig(null)).toEqual(DEFAULT_CONFIG);
    expect(DEFAULT_CONFIG.mode).toBe('balanced');
    expect(DEFAULT_CONFIG.recentRounds).toBe(8);
    expect(DEFAULT_CONFIG.hardSwitchEnabled).toBe(false);
  });

  it('clamps user-controlled values', () => {
    const config = normalizeConfig({ recentRounds: 99, minRounds: 0, targetRounds: 99, maxRounds: 2, domBudget: 999999, mode: 'bad' });
    expect(config.recentRounds).toBe(20);
    expect(config.minRounds).toBe(1);
    expect(config.maxRounds).toBe(2);
    expect(config.targetRounds).toBe(2);
    expect(config.domBudget).toBe(30000);
    expect(config.mode).toBe('balanced');
  });
});
