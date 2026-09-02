import { DEFAULT_CONFIG, STORAGE_KEY, normalizeConfig, type GuardConfig } from '../shared/config';
import { EVENTS, dispatchStringEvent, parseStringEvent, type DebugCommand } from '../shared/events';
import { EMPTY_METRICS, type DebugMetrics, type PopupRequest, type PopupResponse } from '../shared/types';
import { SessionController } from './session-controller';

declare const __CSG_DEBUG_BUILD__: boolean;

let config: GuardConfig = DEFAULT_CONFIG;
let controller: SessionController | null = null;

function sendConfigToMainWorld(): void {
  dispatchStringEvent(EVENTS.config, config);
}

function sendDebugMetrics(metrics: DebugMetrics): void {
  if (__CSG_DEBUG_BUILD__) dispatchStringEvent(EVENTS.debugMetrics, metrics);
}

async function saveConfig(next: GuardConfig): Promise<void> {
  config = normalizeConfig(next);
  await chrome.storage.local.set({ [STORAGE_KEY]: config });
  sendConfigToMainWorld();
  controller?.updateConfig(config);
}

async function loadConfig(): Promise<GuardConfig> {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    return normalizeConfig(stored[STORAGE_KEY]);
  } catch {
    return DEFAULT_CONFIG;
  }
}

function setupDebugCommands(): void {
  if (!__CSG_DEBUG_BUILD__) return;
  window.addEventListener(EVENTS.debugCommand, (event) => {
    const command = parseStringEvent<DebugCommand>(event);
    if (!command || command.type !== 'set-hard-switch' || typeof command.enabled !== 'boolean') return;
    void saveConfig({ ...config, hardSwitchEnabled: command.enabled });
  });
}

async function init(): Promise<void> {
  window.addEventListener(EVENTS.requestConfig, sendConfigToMainWorld);
  setupDebugCommands();

  config = await loadConfig();
  sendConfigToMainWorld();

  controller = new SessionController(config, __CSG_DEBUG_BUILD__ ? sendDebugMetrics : undefined);
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
    const response: PopupResponse = { metrics: controller?.getMetrics() ?? { ...EMPTY_METRICS } };
    sendResponse(response);
    return false;
  });

  window.addEventListener('pagehide', () => controller?.destroy(), { once: true });
}

void init();
