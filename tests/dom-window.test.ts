import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/shared/config';
import { DomRollingWindow, findTurnElements } from '../src/content/dom-window';

function addRound(index: number, childCount = 4): void {
  for (const role of ['user', 'assistant'] as const) {
    const turn = document.createElement('article');
    turn.setAttribute('data-testid', `conversation-turn-${index}-${role}`);
    const message = document.createElement('div');
    message.setAttribute('data-message-author-role', role);
    for (let child = 0; child < childCount; child += 1) {
      message.appendChild(document.createElement('span'));
    }
    turn.appendChild(message);
    document.body.appendChild(turn);
  }
}

function populate(rounds = 20): void {
  for (let index = 0; index < rounds; index += 1) addRound(index);
}

describe('DOM rolling window', () => {
  beforeEach(() => {
    document.head.querySelector('#csg-window-styles')?.remove();
    document.body.replaceChildren();
    populate();
  });

  it('Safe keeps DOM attached and only marks older turns for content-visibility', () => {
    const guard = new DomRollingWindow();
    const before = document.querySelectorAll('*').length;
    const stats = guard.apply({ ...DEFAULT_CONFIG, mode: 'safe', minRounds: 4, targetRounds: 4, maxRounds: 4, domBudget: 1000 });
    expect(stats.renderedRounds).toBe(4);
    expect(findTurnElements()).toHaveLength(40);
    expect(document.querySelectorAll('.csg-safe-windowed').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('*').length).toBeGreaterThanOrEqual(before);
  });

  it('Balanced hides old turn roots without deleting their descendants', () => {
    const guard = new DomRollingWindow();
    const oldest = findTurnElements()[0];
    const descendantsBefore = oldest?.querySelectorAll('*').length ?? 0;
    const stats = guard.apply({ ...DEFAULT_CONFIG, mode: 'balanced', minRounds: 4, targetRounds: 4, maxRounds: 4, domBudget: 1000 });
    expect(stats.renderedRounds).toBe(4);
    expect(oldest?.classList.contains('csg-balanced-hidden')).toBe(true);
    expect(oldest?.querySelectorAll('*').length).toBe(descendantsBefore);
    expect(document.getElementById('csg-history-placeholder')).not.toBeNull();
  });

  it('Aggressive drops descendants of settled old turns but never prunes a protected dialog round', () => {
    const turns = findTurnElements();
    const protectedTurn = turns[4];
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.style.position = 'fixed';
    protectedTurn?.appendChild(dialog);

    const guard = new DomRollingWindow();
    const stats = guard.apply({ ...DEFAULT_CONFIG, mode: 'aggressive', minRounds: 4, targetRounds: 4, maxRounds: 4, domBudget: 1000 });
    expect(stats.totalRounds).toBe(20);
    expect(turns[0]?.dataset.csgPruned).toBe('true');
    expect((turns[0]?.querySelectorAll('*').length ?? 1)).toBe(0);
    expect(protectedTurn?.dataset.csgPruned).not.toBe('true');
  });

  it('cleanup removes recoverable Safe/Balanced presentation state', () => {
    const guard = new DomRollingWindow();
    guard.apply({ ...DEFAULT_CONFIG, mode: 'balanced', minRounds: 4, targetRounds: 4, maxRounds: 4, domBudget: 1000 });
    expect(document.querySelectorAll('.csg-balanced-hidden').length).toBeGreaterThan(0);
    guard.cleanup();
    expect(document.querySelectorAll('.csg-balanced-hidden').length).toBe(0);
    expect(document.getElementById('csg-history-placeholder')).toBeNull();
  });
});
