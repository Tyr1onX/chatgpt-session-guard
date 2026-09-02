import type { GuardConfig, HistoryUnit } from '../shared/config';
import { historyTarget } from '../shared/config';
import { EVENTS } from '../shared/events';

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
  totalMessages: number;
  renderedMessages: number;
  conversationDomNodes: number;
  activeConversationDomNodes: number;
  hiddenRounds: number;
  prunedTurns: number;
  configuredHistoryCount: number;
  historyUnit: HistoryUnit;
  limitedByDomBudget: boolean;
}

type TurnRole = 'user' | 'assistant' | 'unknown';

interface WindowDecision {
  keepFromTurnIndex: number;
  limitedByDomBudget: boolean;
}

function countNodes(element: Element): number {
  return 1 + element.querySelectorAll('*').length;
}

export function turnRole(turn: HTMLElement): TurnRole {
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

export function visibleMessageTurns(turns: HTMLElement[]): HTMLElement[] {
  return turns.filter((turn) => turnRole(turn) !== 'unknown');
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
    }
    #${PLACEHOLDER_ID} .csg-history-title { margin-bottom: 7px; }
    #${PLACEHOLDER_ID} .csg-history-actions { display:flex; justify-content:center; gap:6px; flex-wrap:wrap; }
    #${PLACEHOLDER_ID} button {
      border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
      border-radius: 7px;
      padding: 5px 8px;
      background: Canvas;
      color: CanvasText;
      cursor: pointer;
      font: inherit;
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

function pageHasActiveGeneration(): boolean {
  const stop = document.querySelector<HTMLElement>('[data-testid="stop-button"], button[aria-label*="stop" i]');
  return stop ? isVisible(stop) : false;
}

function resetTurnVisualState(turn: HTMLElement): void {
  turn.classList.remove('csg-safe-windowed', 'csg-balanced-hidden');
  if (turn.dataset.csgPruned !== 'true') turn.classList.remove('csg-aggressive-pruned');
}

function turnIndexForRoundBoundary(turns: HTMLElement[], rounds: DomRound[], requestedRounds: number): number {
  if (rounds.length === 0) return 0;
  const keepRounds = Math.max(1, Math.min(rounds.length, requestedRounds));
  const boundaryRound = rounds[Math.max(0, rounds.length - keepRounds)];
  const firstTurn = boundaryRound?.turns[0];
  return firstTurn ? Math.max(0, turns.indexOf(firstTurn)) : 0;
}

function turnIndexForMessageBoundary(turns: HTMLElement[], requestedMessages: number): number {
  let visibleCount = 0;
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (!turn) continue;
    if (turnRole(turn) !== 'unknown') visibleCount += 1;
    if (visibleCount >= Math.max(1, requestedMessages)) return index;
  }
  return 0;
}

function enforceDomBudget(
  turns: HTMLElement[],
  rounds: DomRound[],
  initialBoundary: number,
  config: GuardConfig
): WindowDecision {
  if (turns.length === 0) return { keepFromTurnIndex: 0, limitedByDomBudget: false };
  const budget = Math.max(1, config.domBudget);
  let boundary = Math.max(0, Math.min(initialBoundary, turns.length - 1));
  const initial = boundary;

  const activeCost = (): number => turns.slice(boundary).reduce((sum, turn) => sum + countNodes(turn), 0);
  const activeUnits = (): number => config.historyUnit === 'message'
    ? countRenderedMessages(turns, boundary)
    : countRenderedRounds(rounds, turns, boundary);

  while (activeCost() > budget && activeUnits() > 1) {
    if (config.historyUnit === 'message') {
      let next = boundary + 1;
      while (next < turns.length && turnRole(turns[next] as HTMLElement) === 'unknown') next += 1;
      if (next >= turns.length) break;
      boundary = next;
      continue;
    }

    const firstKept = turns[boundary];
    const currentRoundIndex = firstKept ? rounds.findIndex((round) => round.turns.includes(firstKept)) : -1;
    const nextRound = currentRoundIndex >= 0 ? rounds[currentRoundIndex + 1] : undefined;
    const nextTurn = nextRound?.turns[0];
    if (!nextTurn) break;
    const nextBoundary = turns.indexOf(nextTurn);
    if (nextBoundary <= boundary) break;
    boundary = nextBoundary;
  }

  return { keepFromTurnIndex: boundary, limitedByDomBudget: boundary > initial };
}

function protectSafetyWindow(turns: HTMLElement[], rounds: DomRound[], boundary: number): number {
  let protectedBoundary = boundary;

  for (let index = 0; index < boundary; index += 1) {
    const turn = turns[index];
    if (turn && containsProtectedInteraction(turn)) {
      protectedBoundary = Math.min(protectedBoundary, index);
      break;
    }
  }

  if (pageHasActiveGeneration() && rounds.length > 0) {
    const latestRound = rounds.at(-1);
    const first = latestRound?.turns[0];
    if (first) protectedBoundary = Math.min(protectedBoundary, Math.max(0, turns.indexOf(first)));
  }
  return protectedBoundary;
}

function countRenderedMessages(turns: HTMLElement[], boundary: number): number {
  return visibleMessageTurns(turns.slice(boundary)).length;
}

function countRenderedRounds(rounds: DomRound[], turns: HTMLElement[], boundary: number): number {
  if (rounds.length === 0) return 0;
  const firstKept = turns[boundary];
  if (!firstKept) return 0;
  const firstRound = rounds.findIndex((round) => round.turns.includes(firstKept));
  return firstRound < 0 ? rounds.length : rounds.length - firstRound;
}

function ensurePlaceholder(before: HTMLElement | null, hiddenUnits: number, config: GuardConfig): void {
  if (!before || hiddenUnits <= 0 || config.mode === 'safe') {
    document.getElementById(PLACEHOLDER_ID)?.remove();
    return;
  }

  let placeholder = document.getElementById(PLACEHOLDER_ID) as HTMLDivElement | null;
  if (!placeholder) {
    placeholder = document.createElement('div');
    placeholder.id = PLACEHOLDER_ID;
    before.parentNode?.insertBefore(placeholder, before);
  }

  placeholder.replaceChildren();
  const title = document.createElement('div');
  title.className = 'csg-history-title';
  const unitLabel = config.historyUnit === 'message' ? 'message' : 'round';
  title.textContent = config.autoLoadHistory
    ? `${hiddenUnits} earlier ${unitLabel}${hiddenUnits === 1 ? '' : 's'} paused from rendering`
    : 'Earlier history is not loaded automatically';

  const actions = document.createElement('div');
  actions.className = 'csg-history-actions';
  if (!config.autoLoadHistory) {
    const load = document.createElement('button');
    load.type = 'button';
    load.textContent = `Load previous ${config.historyBatchSize}`;
    load.addEventListener('click', () => window.dispatchEvent(new Event(EVENTS.loadPreviousHistory)));
    actions.appendChild(load);
  }

  const full = document.createElement('button');
  full.type = 'button';
  full.textContent = 'Temporary Full History';
  full.addEventListener('click', () => window.dispatchEvent(new Event(EVENTS.temporaryFullHistory)));
  actions.appendChild(full);
  placeholder.append(title, actions);
}

export class DomRollingWindow {
  private prunedTurns = 0;

  apply(config: GuardConfig, conversationId: string | null = null): DomWindowStats {
    ensureStyles();
    const turns = findTurnElements();
    const rounds = buildDomRounds(turns);
    const totalMessages = visibleMessageTurns(turns).length;
    const requested = historyTarget(config, conversationId);

    if (!config.enabled || config.temporaryFullHistory) {
      for (const turn of turns) resetTurnVisualState(turn);
      document.getElementById(PLACEHOLDER_ID)?.remove();
      return this.stats(config, turns, rounds, 0, false, requested);
    }

    const initialBoundary = config.historyUnit === 'message'
      ? turnIndexForMessageBoundary(turns, requested)
      : turnIndexForRoundBoundary(turns, rounds, requested);
    const budgetDecision = enforceDomBudget(turns, rounds, initialBoundary, config);
    const keepFromTurnIndex = protectSafetyWindow(turns, rounds, budgetDecision.keepFromTurnIndex);

    for (let index = 0; index < turns.length; index += 1) {
      const turn = turns[index];
      if (!turn) continue;
      const keep = index >= keepFromTurnIndex;
      if (keep) {
        resetTurnVisualState(turn);
        continue;
      }

      if (config.mode === 'safe') {
        turn.classList.add('csg-safe-windowed');
        turn.classList.remove('csg-balanced-hidden');
        continue;
      }

      if (config.mode === 'balanced' || config.mode === 'ultra-lite') {
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

    const renderedMessages = countRenderedMessages(turns, keepFromTurnIndex);
    const renderedRounds = countRenderedRounds(rounds, turns, keepFromTurnIndex);
    const hiddenUnits = config.historyUnit === 'message'
      ? Math.max(0, totalMessages - renderedMessages)
      : Math.max(0, rounds.length - renderedRounds);
    ensurePlaceholder(turns[keepFromTurnIndex] ?? null, hiddenUnits, config);
    return this.stats(config, turns, rounds, keepFromTurnIndex, budgetDecision.limitedByDomBudget, requested);
  }

  cleanup(): void {
    document.getElementById(PLACEHOLDER_ID)?.remove();
    for (const turn of findTurnElements()) resetTurnVisualState(turn);
  }

  private stats(
    config: GuardConfig,
    turns: HTMLElement[],
    rounds: DomRound[],
    boundary: number,
    limitedByDomBudget: boolean,
    configuredHistoryCount: number
  ): DomWindowStats {
    const conversationDomNodes = turns.reduce((sum, turn) => sum + countNodes(turn), 0);
    const activeConversationDomNodes = turns.slice(boundary).reduce((sum, turn) => sum + countNodes(turn), 0);
    const renderedMessages = countRenderedMessages(turns, boundary);
    const renderedRounds = countRenderedRounds(rounds, turns, boundary);
    return {
      totalRounds: rounds.length,
      renderedRounds,
      totalMessages: visibleMessageTurns(turns).length,
      renderedMessages,
      conversationDomNodes,
      activeConversationDomNodes,
      hiddenRounds: Math.max(0, rounds.length - renderedRounds),
      prunedTurns: this.prunedTurns,
      configuredHistoryCount,
      historyUnit: config.historyUnit,
      limitedByDomBudget
    };
  }
}
