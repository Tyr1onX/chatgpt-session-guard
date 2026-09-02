import { describe, expect, it } from 'vitest';
import { chooseDomWindow } from '../src/content/dom-budget';

const config = { minRounds: 4, targetRounds: 8, maxRounds: 12, domBudget: 7000 };

describe('DOM complexity budget', () => {
  it('keeps the target when ordinary rounds fit', () => {
    const result = chooseDomWindow(Array.from({ length: 20 }, () => ({ nodeCount: 500 })), config);
    expect(result.keptRounds).toBe(12);
    expect(result.activeNodes).toBe(6000);
    expect(result.keepFromIndex).toBe(8);
  });

  it('keeps fewer than target when recent rounds are very complex', () => {
    const result = chooseDomWindow(Array.from({ length: 20 }, () => ({ nodeCount: 1800 })), config);
    expect(result.keptRounds).toBe(4);
    expect(result.activeNodes).toBe(7200);
  });

  it('never drops below the minimum even if the minimum exceeds budget', () => {
    const result = chooseDomWindow(Array.from({ length: 10 }, () => ({ nodeCount: 5000 })), config);
    expect(result.keptRounds).toBe(4);
    expect(result.keepFromIndex).toBe(6);
  });
});
