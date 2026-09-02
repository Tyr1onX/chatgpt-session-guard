import type { GuardConfig } from '../shared/config';
import { chooseDomWindow } from './dom-budget';

const TURN_SELECTOR = [
  '[data-testid^="conversation-turn-"]',
  '[data-testid="conversation-turn"]',
  'article[data-turn-id]'
].join(',');

const PLACEHOLDER_ID = 'csg-history-placeholder';
const STYLE_ID = 'csg-window-styles';

export interface DomRound {
  turns: HTMLElement[];
  nodeCount: number;
}

export interface DomWindowStats {
  totalRounds: number;
  renderedRounds: number;
  conversationDomNodes: number;
  activeConversationDomNodes: number;
  hiddenRounds: number;
  prunedTurns: number;
}

type TurnRole = 'user' | 'assistant' | 'unknown';

function countNodes(element: Element): number {
  return 1 + element.querySelectorAll('*').length;
}

function turnRole(turn: HTMLElement): TurnRole {
  const direct = turn.getAttribute('data-message-author-role');
  const nested = turn.querySelector<HTMLElement>('[data-message-author-role]')?.getAttribute('data-message-author-role');
  const role = direct ?? nested;
  return role === 'user' || role === 'assistant' ? role : 'unknown';
}

export function findTurnElements(root: ParentNode = document): HTMLElement[] {
  const candidates = Array.from(root.querySelectorAll<HTMLElement>(TURN_SELECTOR));
  return candidates.filter((candidate) => {
    const ancestor = candidate.parentElement?.closest(TURN_SELECTOR);
    return ancestor === null || ancestor === undefined;
  });
}

export function buildDomRounds(turns: HTMLElement[]): DomRound[] {
  const rounds: DomRound[] = [];
  let current: DomRound | null = null;

  for (const turn of turns) {
    const role = turnRole(turn);
    const startsNew = current === null || role === 'user' || role === 'unknown';
    if (startsNew) {
      current = { turns: [turn], nodeCount: countNodes(turn) };
      rounds.push(current);
    } else if (current) {
      current.turns.push(turn);
      current.nodeCount += countNodes(turn);
    }
  }
  return rounds;
}

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .csg-safe-windowed { content-visibility: auto !important; contain-intrinsic-size: auto 260px; }
    .csg-balanced-hidden { display: none !important; }
    .csg-aggressive-pruned { display: none !important; }
    #${PLACEHOLDER_ID} {
      box-sizing: border-box;
      width: min(680px, calc(100% - 32px));
      margin: 12px auto;
      padding: 9px 12px;
      border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
      border-radius: 10px;
      background: color-mix(in srgb, Canvas 94%, currentColor 6%);
      color: color-mix(in srgb, CanvasText 72%, transparent);
      font: 12px/1.4 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      text-align: center;
      cursor: pointer;
    }
  `;
  document.documentElement.appendChild(style);
}

function isVisible(element: Element): boolean {
  const html = element as HTMLElement;
  return html.offsetParent !== null || getComputedStyle(html).position === 'fixed';
}

function containsProtectedInteraction(turn: HTMLElement): boolean {
  if (document.activeElement && turn.contains(document.activeElement)) return true;
  const protectedElement = turn.querySelector<HTMLElement>([
    '[role="dialog"]',
    '[data-testid="stop-button"]',
    '[data-testid*="confirm" i]',
    '[data-testid*="permission" i]',
    '[data-testid*="oauth" i]',
    'input[type="file"]',
    '[contenteditable="true"]'
  ].join(','));
  return protectedElement ? isVisible(protectedElement) : false;
}

function resetTurnVisualState(turn: HTMLElement): void {
  turn.classList.remove('csg-safe-windowed', 'csg-balanced-hidden');
  if (turn.dataset.csgPruned !== 'true') {
    turn.classList.remove('csg-aggressive-pruned');
  }
}

async function requestFullHistory(): Promise<void> {
  const stored = await chrome.storage.local.get('csg.settings.v1');
  const raw = stored['csg.settings.v1'];
  const next = typeof raw === 'object' && raw !== null ? { ...raw, temporaryFullHistory: true } : { temporaryFullHistory: true };
  await chrome.storage.local.set({ 'csg.settings.v1': next });
  location.reload();
}

function ensurePlaceholder(before: HTMLElement | null, hiddenRounds: number, mode: GuardConfig['mode']): void {
  if (!before || hiddenRounds <= 0 || mode === 'safe') {
    document.getElementById(PLACEHOLDER_ID)?.remove();
    return;
  }

  let placeholder = document.getElementById(PLACEHOLDER_ID) as HTMLButtonElement | null;
  if (!placeholder) {
    placeholder = document.createElement('button');
    placeholder.id = PLACEHOLDER_ID;
    placeholder.type = 'button';
    placeholder.addEventListener('click', () => { void requestFullHistory(); });
    before.parentNode?.insertBefore(placeholder, before);
  }

  const label = mode === 'aggressive' ? 'unloaded from the page' : 'paused from rendering';
  const text = `${hiddenRounds} earlier round${hiddenRounds === 1 ? '' : 's'} ${label} · View earlier history`;
  if (placeholder.textContent !== text) placeholder.textContent = text;
}

export class DomRollingWindow {
  private prunedTurns = 0;

  apply(config: GuardConfig): DomWindowStats {
    ensureStyles();
    const turns = findTurnElements();
    const rounds = buildDomRounds(turns);

    if (!config.enabled || config.temporaryFullHistory) {
      for (const turn of turns) resetTurnVisualState(turn);
      document.getElementById(PLACEHOLDER_ID)?.remove();
      return this.stats(rounds, rounds.length, 0);
    }

    const decision = chooseDomWindow(rounds, config);
    let keepFromIndex = decision.keepFromIndex;

    for (let index = 0; index < keepFromIndex; index += 1) {
      const round = rounds[index];
      if (round?.turns.some(containsProtectedInteraction)) {
        keepFromIndex = index;
        break;
      }
    }

    for (let index = 0; index < rounds.length; index += 1) {
      const round = rounds[index];
      if (!round) continue;
      const keep = index >= keepFromIndex;

      for (const turn of round.turns) {
        if (keep) {
          resetTurnVisualState(turn);
          continue;
        }

        if (config.mode === 'safe') {
          turn.classList.add('csg-safe-windowed');
          turn.classList.remove('csg-balanced-hidden');
          continue;
        }

        if (config.mode === 'balanced') {
          turn.classList.add('csg-balanced-hidden');
          turn.classList.remove('csg-safe-windowed');
          continue;
        }

        if (turn.dataset.csgPruned !== 'true' && !containsProtectedInteraction(turn)) {
          turn.replaceChildren();
          turn.dataset.csgPruned = 'true';
          this.prunedTurns += 1;
        }
        turn.classList.add('csg-aggressive-pruned');
      }
    }

    const firstKeptTurn = rounds[keepFromIndex]?.turns[0] ?? null;
    ensurePlaceholder(firstKeptTurn, keepFromIndex, config.mode);
    return this.stats(rounds, rounds.length - keepFromIndex, keepFromIndex);
  }

  cleanup(): void {
    document.getElementById(PLACEHOLDER_ID)?.remove();
    for (const turn of findTurnElements()) resetTurnVisualState(turn);
  }

  private stats(rounds: DomRound[], renderedRounds: number, hiddenRounds: number): DomWindowStats {
    const measuredCost = (round: DomRound): number => round.turns.reduce((sum, turn) => sum + countNodes(turn), 0);
    const conversationDomNodes = rounds.reduce((sum, round) => sum + measuredCost(round), 0);
    const activeStart = Math.max(0, rounds.length - renderedRounds);
    const activeConversationDomNodes = rounds.slice(activeStart).reduce((sum, round) => sum + measuredCost(round), 0);
    return {
      totalRounds: rounds.length,
      renderedRounds,
      conversationDomNodes,
      activeConversationDomNodes,
      hiddenRounds,
      prunedTurns: this.prunedTurns
    };
  }
}
