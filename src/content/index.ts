import { DEFAULT_CONFIG, STORAGE_KEY, normalizeConfig, type GuardConfig } from '../shared/config';
import { EVENTS, dispatchStringEvent } from '../shared/events';
import type { PopupRequest, PopupResponse } from '../shared/types';
import { SessionController } from './session-controller';

let config: GuardConfig = DEFAULT_CONFIG;
let controller: SessionController | null = null;

function sendConfigToMainWorld(): void {
  dispatchStringEvent(EVENTS.config, config);
}

async function loadConfig(): Promise<GuardConfig> {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    return normalizeConfig(stored[STORAGE_KEY]);
  } catch {
    return DEFAULT_CONFIG;
  }
}

async function init(): Promise<void> {
  window.addEventListener(EVENTS.requestConfig, sendConfigToMainWorld);

  config = await loadConfig();
  sendConfigToMainWorld();

  controller = new SessionController(config);
  controller.start();

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes[STORAGE_KEY]) return;
    config = normalizeConfig(changes[STORAGE_KEY]?.newValue);
    sendConfigToMainWorld();
    controller?.updateConfig(config);
  });

  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    const request = message as Partial<PopupRequest>;
    if (request.type !== 'csg:get-state') return false;
    const response: PopupResponse = { metrics: controller?.getMetrics() ?? {
      conversationId: null,
      spaSwitchCount: 0,
      renderedRounds: 0,
      totalRounds: 0,
      conversationDomNodes: 0,
      activeConversationDomNodes: 0,
      totalDocumentDomNodes: 0,
      networkMode: 'unknown',
      cleanupCount: 0,
      hardSwitchCount: 0,
      jsHeapMb: null,
      lastUpdatedAt: 0
    } };
    sendResponse(response);
    return false;
  });

  window.addEventListener('pagehide', () => controller?.destroy(), { once: true });
}

void init();
