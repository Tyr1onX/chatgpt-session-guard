const CHATGPT_ORIGIN = 'https://chatgpt.com';
const TURN_SELECTOR = '[data-testid^="conversation-turn-"], [data-testid="conversation-turn"], article[data-turn-id]';
const STORAGE_KEY = 'csg.settings.v1';
const HISTORY_SESSION_KEY = 'csg.history.expansion.v1';

export function conversationIdFromUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.origin !== CHATGPT_ORIGIN) return null;
    const match = /^\/c\/([^/?#]+)/.exec(url.pathname);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

export async function getOrCreateChatPage(context) {
  const existing = context.pages().find((page) => page.url().startsWith(CHATGPT_ORIGIN));
  return existing ?? context.newPage();
}

export async function isLoggedIn(page) {
  if (!page.url().startsWith(CHATGPT_ORIGIN)) return false;
  const composer = page.locator('#prompt-textarea, textarea[placeholder], [contenteditable="true"]').first();
  try {
    await composer.waitFor({ state: 'attached', timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

export async function openConversation(page, conversationId) {
  await page.goto(`${CHATGPT_ORIGIN}/c/${conversationId}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.locator(TURN_SELECTOR).first().waitFor({ state: 'attached', timeout: 20_000 });
  await page.waitForTimeout(900);
}

export async function openExtensionPage(context, extensionId) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });
  return page;
}

export async function configureUltraLite(extensionPage) {
  await extensionPage.evaluate(async ({ storageKey, historySessionKey }) => {
    const stored = await chrome.storage.local.get(storageKey);
    const current = stored[storageKey] && typeof stored[storageKey] === 'object' ? stored[storageKey] : {};
    await chrome.storage.local.set({
      [storageKey]: {
        ...current,
        version: 2,
        enabled: true,
        mode: 'ultra-lite',
        historyUnit: 'round',
        historyCount: 1,
        historyBatchSize: 10,
        autoLoadHistory: false,
        historyExpansion: 0,
        historyExpansionConversationId: null,
        recentRounds: 1,
        minRounds: 1,
        targetRounds: 1,
        maxRounds: 1,
        temporaryFullHistory: false,
        hardSwitchEnabled: false,
        debug: true
      }
    });
    await chrome.storage.session.remove(historySessionKey);
  }, { storageKey: STORAGE_KEY, historySessionKey: HISTORY_SESSION_KEY });
}

export async function popupSmoke(extensionPage) {
  const lang = await extensionPage.locator('html').getAttribute('lang');
  const body = await extensionPage.locator('body').innerText();
  const required = ['状态', '模式', '极简', '历史记录', '本版本保护情况'];
  const debugRequired = ['性能测试', '超长会话压力测试', '窗口稳定性诊断'];
  return {
    lang,
    missing: required.filter((text) => !body.includes(text)),
    missingDebug: debugRequired.filter((text) => !body.includes(text))
  };
}

async function sendToChatTab(extensionPage, message) {
  return extensionPage.evaluate(async (payload) => {
    const tabs = await chrome.tabs.query({ url: 'https://chatgpt.com/*' });
    const tab = tabs.find((item) => typeof item.id === 'number');
    if (!tab?.id) throw new Error('CHATGPT_TAB_NOT_FOUND');
    return chrome.tabs.sendMessage(tab.id, payload);
  }, message);
}

export async function getExtensionState(extensionPage) {
  return sendToChatTab(extensionPage, { type: 'csg:get-state' });
}

export async function getStabilityTrace(extensionPage) {
  return sendToChatTab(extensionPage, { type: 'csg:stability-trace-get' });
}

export async function waitForGuardStable(extensionPage, { timeoutMs = 10_000 } = {}) {
  const started = Date.now();
  let previous = null;
  while (Date.now() - started < timeoutMs) {
    const state = await getExtensionState(extensionPage);
    const metrics = state?.metrics ?? null;
    if (metrics && previous && metrics.renderedRounds === previous.renderedRounds && metrics.totalRounds === previous.totalRounds) {
      return metrics;
    }
    previous = metrics;
    await new Promise((resolve) => setTimeout(resolve, 450));
  }
  if (previous) return previous;
  throw new Error('DEBUG_METRICS_UNAVAILABLE');
}

export async function readDomSummary(page) {
  return page.evaluate((turnSelector) => {
    const turns = Array.from(document.querySelectorAll(turnSelector));
    const placeholder = document.getElementById('csg-history-placeholder');
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const role = (turn) => {
      const direct = turn.getAttribute('data-message-author-role');
      const nested = turn.querySelector('[data-message-author-role]')?.getAttribute('data-message-author-role');
      const value = direct ?? nested;
      return value === 'user' || value === 'assistant' ? value : 'unknown';
    };
    const visibleTurns = turns.filter(visible);
    let visibleRoundCount = 0;
    let hasRound = false;
    for (const turn of visibleTurns) {
      const turnRole = role(turn);
      if (!hasRound || turnRole === 'user') {
        visibleRoundCount += 1;
        hasRound = true;
      }
    }
    const oldTurnsVisible = Boolean(placeholder && visible(placeholder) && turns.some((turn) => {
      const beforePlaceholder = Boolean(turn.compareDocumentPosition(placeholder) & Node.DOCUMENT_POSITION_FOLLOWING);
      return beforePlaceholder && visible(turn);
    }));
    const scrollingElement = document.scrollingElement;
    return {
      turnCount: turns.length,
      visibleTurnCount: visibleTurns.length,
      visibleRoundCount,
      hiddenTurnCount: Math.max(0, turns.length - visibleTurns.length),
      placeholderPresent: Boolean(placeholder),
      placeholderVisible: Boolean(placeholder && visible(placeholder)),
      oldTurnsVisible,
      scrollHeight: scrollingElement?.scrollHeight ?? 0,
      scrollTop: scrollingElement?.scrollTop ?? 0,
      balancedHiddenCount: document.querySelectorAll('.csg-balanced-hidden').length,
      aggressivePrunedCount: document.querySelectorAll('.csg-aggressive-pruned').length,
      safeWindowedCount: document.querySelectorAll('.csg-safe-windowed').length,
      generationActive: Boolean(document.querySelector('[data-testid="stop-button"], button[aria-label*="stop" i]'))
    };
  }, TURN_SELECTOR);
}

export async function scrollUpOnce(page) {
  return page.evaluate((turnSelector) => {
    const candidates = new Set();
    if (document.scrollingElement) candidates.add(document.scrollingElement);
    const turns = document.querySelectorAll(turnSelector);
    const anchors = [turns[0], turns[turns.length - 1]].filter(Boolean);
    for (const anchor of anchors) {
      let current = anchor.parentElement;
      while (current) {
        if (current.scrollHeight > current.clientHeight + 100) candidates.add(current);
        current = current.parentElement;
      }
    }
    for (const element of document.querySelectorAll('main, [data-scroll-root], [class*="overflow-y-auto"]')) {
      if (element.scrollHeight > element.clientHeight + 100) candidates.add(element);
    }
    const target = [...candidates].sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))[0];
    if (!target) return { moved: false, before: 0, after: 0, max: 0 };
    const before = target.scrollTop;
    const step = Math.max(650, Math.round(target.clientHeight * 0.8));
    target.scrollTop = Math.max(0, before - step);
    target.dispatchEvent(new Event('scroll', { bubbles: true }));
    return { moved: target.scrollTop !== before, before, after: target.scrollTop, max: target.scrollHeight };
  }, TURN_SELECTOR);
}

export async function trySpaSwitch(page, conversationId) {
  const href = `/c/${conversationId}`;
  const link = page.locator(`a[href="${href}"], a[href="${CHATGPT_ORIGIN}${href}"]`).first();
  if (await link.count() === 0) return { ok: false, reason: 'SIDEBAR_LINK_NOT_FOUND' };
  const started = performance.now();
  await link.click({ timeout: 5_000 });
  await page.waitForURL((url) => url.pathname === href, { timeout: 15_000 });
  await page.locator(TURN_SELECTOR).first().waitFor({ state: 'attached', timeout: 15_000 });
  return { ok: true, latencyMs: Math.round(performance.now() - started) };
}
