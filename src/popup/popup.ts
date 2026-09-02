import { DEFAULT_CONFIG, STORAGE_KEY, normalizeConfig, type GuardConfig, type GuardMode } from '../shared/config';
import type { DebugMetrics, PopupRequest, PopupResponse } from '../shared/types';

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing popup element: ${id}`);
  return found as T;
}

const modeSelect = element<HTMLSelectElement>('mode');
const recentRoundsInput = element<HTMLInputElement>('recentRounds');
const toggleButton = element<HTMLButtonElement>('toggleEnabled');
const fullHistoryButton = element<HTMLButtonElement>('fullHistory');
const statusText = element<HTMLElement>('statusText');
const statusDot = element<HTMLElement>('statusDot');
const sessionState = element<HTMLElement>('sessionState');
const warning = element<HTMLElement>('warning');
const metricsList = element<HTMLDListElement>('metrics');

let config: GuardConfig = DEFAULT_CONFIG;

async function loadConfig(): Promise<GuardConfig> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return normalizeConfig(stored[STORAGE_KEY]);
}

async function saveConfig(next: GuardConfig): Promise<void> {
  config = normalizeConfig(next);
  await chrome.storage.local.set({ [STORAGE_KEY]: config });
  renderConfig();
}

async function activeTab(): Promise<chrome.tabs.Tab | null> {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0] ?? null;
  } catch {
    return null;
  }
}

async function getMetrics(): Promise<DebugMetrics | null> {
  const tab = await activeTab();
  if (typeof tab?.id !== 'number') return null;
  try {
    const request: PopupRequest = { type: 'csg:get-state' };
    const response = await chrome.tabs.sendMessage(tab.id, request) as PopupResponse | undefined;
    return response?.metrics ?? null;
  } catch {
    return null;
  }
}

function renderConfig(): void {
  modeSelect.value = config.mode;
  recentRoundsInput.value = String(config.recentRounds);
  statusText.textContent = `Status: ${config.enabled ? 'ON' : 'OFF'}`;
  statusDot.classList.toggle('off', !config.enabled);
  toggleButton.textContent = config.enabled ? 'Disable' : 'Enable';
  fullHistoryButton.textContent = config.temporaryFullHistory ? 'Restore Lightweight Mode' : 'Temporary Full History';
  warning.hidden = config.mode !== 'aggressive';
}

function renderMetrics(metrics: DebugMetrics | null): void {
  metricsList.replaceChildren();
  if (!metrics) {
    sessionState.textContent = 'Unavailable';
    return;
  }

  if (!metrics.conversationId) sessionState.textContent = 'No active chat';
  else if (metrics.activeConversationDomNodes <= config.domBudget) sessionState.textContent = 'Clean';
  else sessionState.textContent = 'Pressure';

  const rows: Array<[string, string]> = [
    ['Conversation ID', metrics.conversationId ?? '—'],
    ['SPA switches', String(metrics.spaSwitchCount)],
    ['Rendered rounds', `${metrics.renderedRounds} / ${metrics.totalRounds}`],
    ['Conversation DOM', String(metrics.conversationDomNodes)],
    ['Active DOM', String(metrics.activeConversationDomNodes)],
    ['Document DOM', String(metrics.totalDocumentDomNodes)],
    ['Network Guard', metrics.networkMode],
    ['Cleanup count', String(metrics.cleanupCount)],
    ['Hard switches', String(metrics.hardSwitchCount)],
    ['JS heap', metrics.jsHeapMb === null ? 'n/a' : `${metrics.jsHeapMb} MB`]
  ];

  for (const [key, value] of rows) {
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = key;
    dd.textContent = value;
    metricsList.append(dt, dd);
  }
}

modeSelect.addEventListener('change', () => {
  const mode = modeSelect.value as GuardMode;
  void saveConfig({ ...config, mode });
});

recentRoundsInput.addEventListener('change', () => {
  const recentRounds = Number.parseInt(recentRoundsInput.value, 10);
  void saveConfig({ ...config, recentRounds });
});

toggleButton.addEventListener('click', () => {
  void saveConfig({ ...config, enabled: !config.enabled });
});

fullHistoryButton.addEventListener('click', async () => {
  await saveConfig({ ...config, temporaryFullHistory: !config.temporaryFullHistory });
  const tab = await activeTab();
  if (typeof tab?.id === 'number') {
    try {
      await chrome.tabs.reload(tab.id);
    } catch {
      // Storage state still applies on the user's next manual reload.
    }
  }
});

void (async () => {
  config = await loadConfig();
  renderConfig();
  renderMetrics(await getMetrics());
})();
