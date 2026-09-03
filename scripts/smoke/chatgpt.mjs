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

export async function loginSignals(page) {
  if (!page.url().startsWith(CHATGPT_ORIGIN)) return { loggedIn: false, score: 0 };
  const selectors = [
    '#prompt-textarea',
    'main [contenteditable="true"]',
    'nav a[href^="/c/"]',
    '[data-testid*="profile" i], button[aria-label*="profile" i], button[aria-label*="account" i]'
  ];
  let score = 0;
  let composerPresent = false;
  for (const selector of selectors) {
    try {
      const present = (await page.locator(selector).first().count()) > 0;
      if (present) score += 1;
      if (selector === '#prompt-textarea' && present) composerPresent = true;
    } catch {
      // Login navigation can replace the document while signals are sampled.
    }
  }
  let authControlsPresent = false;
  try {
    authControlsPresent = (await page.locator('a[href*="auth/login"], a[href*="auth/signup"], button[data-testid*="login" i]').count()) > 0;
  } catch {
    authControlsPresent = false;
  }
  return { loggedIn: score >= 2 || (composerPresent && !authControlsPresent) || (score >= 1 && page.url().includes('/c/')), score };
}

export async function isLoggedIn(page) {
  return (await loginSignals(page)).loggedIn;
}

export async function showBootstrapStatus(page, title, detail) {
  try {
    await page.evaluate(({ title, detail }) => {
      let box = document.getElementById('csg-bootstrap-status');
      if (!box) {
        box = document.createElement('div');
        box.id = 'csg-bootstrap-status';
        Object.assign(box.style, {
          position: 'fixed', right: '20px', top: '20px', zIndex: '2147483647', maxWidth: '360px',
          padding: '14px 16px', borderRadius: '12px', background: 'Canvas', color: 'CanvasText',
          border: '1px solid color-mix(in srgb, currentColor 20%, transparent)',
          boxShadow: '0 8px 30px rgba(0,0,0,.18)', font: '14px/1.5 system-ui,sans-serif'
        });
        document.documentElement.appendChild(box);
      }
      box.replaceChildren();
      const strong = document.createElement('strong');
      strong.textContent = title;
      const text = document.createElement('div');
      text.textContent = detail;
      text.style.marginTop = '6px';
      box.append(strong, text);
    }, { title, detail });
  } catch {
    // Navigation may briefly destroy the document; the next polling pass retries.
  }
}

export async function waitForLogin(page, { timeoutMs = 10 * 60_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await showBootstrapStatus(page, 'Session Guard 自动测试', '请在这个独立测试浏览器中登录 ChatGPT。登录完成后无需关闭窗口，程序会自动继续。');
    if (await isLoggedIn(page)) return true;
    await page.waitForTimeout(1200);
  }
  return false;
}

export async function waitForConversationSelection(page, { timeoutMs = 10 * 60_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await showBootstrapStatus(page, '登录成功', '现在只需要在左侧历史记录中点开一个很长、容易出现问题的旧聊天。程序会自动识别并继续。');
    const id = conversationIdFromUrl(page.url());
    if (id) {
      try {
        await page.locator(TURN_SELECTOR).first().waitFor({ state: 'attached', timeout: 5000 });
        return id;
      } catch {
        // Keep waiting until a usable conversation is selected.
      }
    }
    await page.waitForTimeout(900);
  }
  return null;
}

export async function probeBoundConversation(page, conversationId) {
  try {
    const response = await page.goto(CHATGPT_ORIGIN + '/c/' + conversationId, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    if (response && [403, 404, 410].includes(response.status())) return { status: 'missing' };
    await page.waitForTimeout(900);
    if (!(await isLoggedIn(page))) return { status: 'login-lost' };
    await page.locator(TURN_SELECTOR).first().waitFor({ state: 'attached', timeout: 12_000 });
    return { status: 'ok' };
  } catch {
    if (!page.url().includes('/c/' + conversationId)) return { status: 'missing' };
    return { status: 'ui-changed' };
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

export async function waitForLoadedBuildId(extensionPage, { timeoutMs = 10_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const state = await getExtensionState(extensionPage);
      const buildId = state?.benchmark?.environment?.buildId ?? state?.longStress?.buildId ?? null;
      if (typeof buildId === 'string' && buildId.length > 0) return buildId;
    } catch {
      // The content script may still be attaching after navigation or extension startup.
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  throw new Error('EXTENSION_RUNTIME_BUILD_ID_UNAVAILABLE');
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
