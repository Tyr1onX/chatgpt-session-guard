import type { GuardConfig, HistoryUnit } from '../shared/config';
import { historyTarget } from '../shared/config';
import { EVENTS } from '../shared/events';

const TURN_SELECTOR = [
  '[data-testid^="conversation-turn-"]',
  '[data-testid="conversation-turn"]',
  'article[data-turn-id]'
].join(',');
const PROTECTED_SELECTOR = [
  '[role="dialog"]',
  '[data-testid="stop-button"]',
  '[data-testid*="confirm" i]',
  '[data-testid*="permission" i]',
  '[data-testid*="oauth" i]',
  'input[type="file"]',
  '[contenteditable="true"]'
].join(',');
const PLACEHOLDER_ID = 'csg-history-placeholder';
const STYLE_ID = 'csg-window-styles';
const OWNED_SELECTOR = `#${PLACEHOLDER_ID}, #${STYLE_ID}, [data-csg-owned="true"]`;

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
  boundaryIndex: number;
  boundaryTurnId: string | null;
  lastVisibleUserIndex: number;
  generationActive: boolean;
}

type TurnRole = 'user' | 'assistant' | 'unknown';

type CountNodes = (element: Element) => number;

interface WindowDecision {
  keepFromTurnIndex: number;
  limitedByDomBudget: boolean;
}

function countNodes(element: Element): number {
  return 1 + element.querySelectorAll('*').length;
}

function createNodeCounter(): CountNodes {
  const cache = new Map<Element, number>();
  return (element: Element): number => {
    const cached = cache.get(element);
    if (cached !== undefined) return cached;
    const value = countNodes(element);
    cache.set(element, value);
    return value;
  };
}

function elementForNode(node: Node | null): Element | null {
  if (!node) return null;
  if (node instanceof Element) return node;
  return node.parentElement;
}

export function isExtensionOwnedNode(node: Node | null): boolean {
  const element = elementForNode(node);
  return Boolean(element?.closest(OWNED_SELECTOR));
}

function matchesOrContains(element: Element, selector: string): boolean {
  return element.matches(selector) || element.querySelector(selector) !== null;
}

export function mutationChangesGenerationControl(records: MutationRecord[]): boolean {
  for (const record of records) {
    for (const node of [...record.addedNodes, ...record.removedNodes]) {
      const element = elementForNode(node);
      if (!element) continue;
      if (matchesOrContains(element, '[data-testid="stop-button"], button[aria-label*="stop" i]')) return true;
    }
  }
  return false;
}

export function mutationNeedsConversationEvaluate(records: MutationRecord[]): boolean {
  for (const record of records) {
    const target = elementForNode(record.target);
    const changedNodes = [...record.addedNodes, ...record.removedNodes];
    if (isExtensionOwnedNode(record.target) && changedNodes.every((node) => isExtensionOwnedNode(node))) continue;

    if (target?.matches(TURN_SELECTOR)) return true;
    for (const node of changedNodes) {
      if (isExtensionOwnedNode(node)) continue;
      const element = elementForNode(node);
      if (!element) continue;
      if (matchesOrContains(element, TURN_SELECTOR) || matchesOrContains(element, PROTECTED_SELECTOR)) return true;
    }
  }
  return false;
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

export function findConversationObserveRoot(): Node {
  const firstTurn = findTurnElements()[0];
  return firstTurn?.closest('main') ?? document.querySelector('main') ?? document.documentElement;
}

export function visibleMessageTurns(turns: HTMLElement[]): HTMLElement[] {
  return turns.filter((turn) => turnRole(turn) !== 'unknown');
}

/**
 * A round is user-boundary based: once a visible user turn starts a round, every
 * assistant/tool/thinking/unknown top-level turn belongs to it until the next
 * visible user turn. Unknown nodes never create a new round by themselves.
 */
export function buildDomRounds(turns: HTMLElement[], nodeCount: CountNodes = countNodes): DomRound[] {
  const rounds: DomRound[] = [];
  let current: DomRound | null = null;

  for (const turn of turns) {
    const role = turnRole(turn);
    if (current === null || role === 'user') {
      current = { turns: [turn], nodeCount: nodeCount(turn) };
      rounds.push(current);
      continue;
    }
    current.turns.push(turn);
    current.nodeCount += nodeCount(turn);
  }
  return rounds;
}

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.dataset.csgOwned = 'true';
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
  const protectedElement = turn.querySelector<HTMLElement>(PROTECTED_SELECTOR);
  return protectedElement ? isVisible(protectedElement) : false;
}

export function pageHasActiveGeneration(): boolean {
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
  config: GuardConfig,
  nodeCount: CountNodes
): WindowDecision {
  if (turns.length === 0) return { keepFromTurnIndex: 0, limitedByDomBudget: false };
  const budget = Math.max(1, config.domBudget);
  let boundary = Math.max(0, Math.min(initialBoundary, turns.length - 1));
  const initial = boundary;

  const activeCost = (): number => turns.slice(boundary).reduce((sum, turn) => sum + nodeCount(turn), 0);
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

function protectSafetyWindow(turns: HTMLElement[], boundary: number): number {
  let protectedBoundary = boundary;
  for (let index = 0; index < boundary; index += 1) {
    const turn = turns[index];
    if (turn && containsProtectedInteraction(turn)) {
      protectedBoundary = Math.min(protectedBoundary, index);
      break;
    }
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

function setTextIfChanged(element: HTMLElement, value: string): void {
  if (element.textContent !== value) element.textContent = value;
}

function createPlaceholder(): HTMLDivElement {
  const placeholder = document.createElement('div');
  placeholder.id = PLACEHOLDER_ID;
  placeholder.dataset.csgOwned = 'true';

  const title = document.createElement('div');
  title.className = 'csg-history-title';
  title.dataset.csgOwned = 'true';

  const actions = document.createElement('div');
  actions.className = 'csg-history-actions';
  actions.dataset.csgOwned = 'true';

  const load = document.createElement('button');
  load.type = 'button';
  load.dataset.csgOwned = 'true';
  load.dataset.csgAction = 'load-previous';
  load.addEventListener('click', () => window.dispatchEvent(new Event(EVENTS.loadPreviousHistory)));

  const full = document.createElement('button');
  full.type = 'button';
  full.dataset.csgOwned = 'true';
  full.dataset.csgAction = 'temporary-full';
  full.addEventListener('click', () => window.dispatchEvent(new Event(EVENTS.temporaryFullHistory)));

  actions.append(load, full);
  placeholder.append(title, actions);
  return placeholder;
}

function ensurePlaceholder(before: HTMLElement | null, hiddenUnits: number, config: GuardConfig): void {
  const existing = document.getElementById(PLACEHOLDER_ID) as HTMLDivElement | null;
  if (!before || hiddenUnits <= 0 || config.mode === 'safe') {
    existing?.remove();
    return;
  }

  const placeholder = existing ?? createPlaceholder();
  if (!existing) before.parentNode?.insertBefore(placeholder, before);
  else if (placeholder.parentNode !== before.parentNode || placeholder.nextSibling !== before) {
    before.parentNode?.insertBefore(placeholder, before);
  }

  const title = placeholder.querySelector<HTMLElement>('.csg-history-title');
  const load = placeholder.querySelector<HTMLButtonElement>('[data-csg-action="load-previous"]');
  const full = placeholder.querySelector<HTMLButtonElement>('[data-csg-action="temporary-full"]');
  if (!title || !load || !full) return;

  const unitLabel = config.historyUnit === 'message' ? 'message' : 'round';
  setTextIfChanged(title, config.autoLoadHistory
    ? `${hiddenUnits} earlier ${unitLabel}${hiddenUnits === 1 ? '' : 's'} paused from rendering`
    : 'Earlier history is not loaded automatically');
  const loadText = `Load previous ${config.historyBatchSize}`;
  setTextIfChanged(load, loadText);
  load.hidden = config.autoLoadHistory;
  setTextIfChanged(full, 'Temporary Full History');
}

function turnId(turn: HTMLElement | undefined): string | null {
  return turn?.getAttribute('data-turn-id') ?? turn?.getAttribute('data-testid') ?? null;
}

function lastVisibleUserIndex(turns: HTMLElement[]): number {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn && turnRole(turn) === 'user') return index;
  }
  return -1;
}

export class DomRollingWindow {
  private prunedTurns = 0;
  private activeRoundStart: HTMLElement | null = null;

  apply(config: GuardConfig, conversationId: string | null = null): DomWindowStats {
    ensureStyles();
    const turns = findTurnElements();
    const nodeCount = createNodeCounter();
    const rounds = buildDomRounds(turns, nodeCount);
    const totalMessages = visibleMessageTurns(turns).length;
    const requested = historyTarget(config, conversationId);
    const generationActive = pageHasActiveGeneration();

    if (!config.enabled || config.temporaryFullHistory) {
      this.activeRoundStart = null;
      for (const turn of turns) resetTurnVisualState(turn);
      document.getElementById(PLACEHOLDER_ID)?.remove();
      return this.stats(config, turns, rounds, 0, false, requested, nodeCount, generationActive);
    }

    const initialBoundary = config.historyUnit === 'message'
      ? turnIndexForMessageBoundary(turns, requested)
      : turnIndexForRoundBoundary(turns, rounds, requested);
    const budgetDecision = enforceDomBudget(turns, rounds, initialBoundary, config, nodeCount);
    let keepFromTurnIndex = protectSafetyWindow(turns, budgetDecision.keepFromTurnIndex);

    if (generationActive) {
      const latestUserIndex = lastVisibleUserIndex(turns);
      const latestUser = latestUserIndex >= 0 ? turns[latestUserIndex] ?? null : null;
      const pinnedIndex = this.activeRoundStart ? turns.indexOf(this.activeRoundStart) : -1;
      if (!this.activeRoundStart || pinnedIndex < 0 || (latestUser && latestUserIndex > pinnedIndex)) {
        this.activeRoundStart = latestUser;
      }
      const activeIndex = this.activeRoundStart ? turns.indexOf(this.activeRoundStart) : -1;
      if (activeIndex >= 0) keepFromTurnIndex = Math.min(keepFromTurnIndex, activeIndex);
    } else {
      this.activeRoundStart = null;
    }

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
    return this.stats(config, turns, rounds, keepFromTurnIndex, budgetDecision.limitedByDomBudget, requested, nodeCount, generationActive);
  }

  /** Route switches release extension-owned nodes but do not unhide the outgoing React tree. */
  cleanupForNavigation(): void {
    document.getElementById(PLACEHOLDER_ID)?.remove();
    this.activeRoundStart = null;
  }

  /** Explicit native/full-history restore path. */
  restoreAllVisualState(): void {
    document.getElementById(PLACEHOLDER_ID)?.remove();
    for (const turn of findTurnElements()) resetTurnVisualState(turn);
    this.activeRoundStart = null;
  }

  /** Backward-compatible explicit cleanup used by tests/benchmarks. */
  cleanup(): void {
    this.restoreAllVisualState();
  }

  private stats(
    config: GuardConfig,
    turns: HTMLElement[],
    rounds: DomRound[],
    boundary: number,
    limitedByDomBudget: boolean,
    configuredHistoryCount: number,
    nodeCount: CountNodes,
    generationActive: boolean
  ): DomWindowStats {
    const conversationDomNodes = turns.reduce((sum, turn) => sum + nodeCount(turn), 0);
    const activeConversationDomNodes = turns.slice(boundary).reduce((sum, turn) => sum + nodeCount(turn), 0);
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
      limitedByDomBudget,
      boundaryIndex: boundary,
      boundaryTurnId: turnId(turns[boundary]),
      lastVisibleUserIndex: lastVisibleUserIndex(turns),
      generationActive
    };
  }
}
