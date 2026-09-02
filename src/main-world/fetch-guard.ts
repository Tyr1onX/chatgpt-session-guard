import { normalizeConfig, type GuardConfig } from '../shared/config';
import { EVENTS, dispatchStringEvent, parseStringEvent, type NetworkStatus } from '../shared/events';
import { installDebugHelper } from './debug-helper';
import { trimLegacyConversation } from './legacy-adapter';
import { adaptPaginatedConversation, rewritePaginatedRequest } from './paginated-adapter';
import { classifyRequest } from './request-classifier';
import { detectConversationSchema } from './schema-validator';

declare const __CSG_DEBUG_BUILD__: boolean;

declare global {
  interface Window {
    __CSG_FETCH_PATCHED__?: boolean;
    __CSG_NAV_PATCHED__?: boolean;
  }
}

let currentConfig: GuardConfig | null = null;
let resolveFirstConfig: (() => void) | null = null;
const firstConfig = new Promise<void>((resolve) => {
  resolveFirstConfig = resolve;
});

function updateConfig(config: GuardConfig): void {
  currentConfig = config;
  resolveFirstConfig?.();
  resolveFirstConfig = null;
}

async function configBeforeConversationRequest(timeoutMs = 60): Promise<GuardConfig | null> {
  if (currentConfig) return currentConfig;
  await Promise.race([
    firstConfig,
    new Promise<void>((resolve) => window.setTimeout(resolve, timeoutMs))
  ]);
  return currentConfig;
}

function emitNetworkStatus(status: NetworkStatus): void {
  dispatchStringEvent(EVENTS.networkStatus, status);
}

function isJsonResponse(response: Response): boolean {
  return (response.headers.get('content-type') ?? '').toLowerCase().includes('application/json');
}

function modifiedResponse(original: Response, data: unknown): Response {
  const headers = new Headers(original.headers);
  headers.delete('content-length');
  headers.delete('content-encoding');
  headers.set('content-type', 'application/json; charset=utf-8');

  const replacement = new Response(JSON.stringify(data), {
    status: original.status,
    statusText: original.statusText,
    headers
  });

  for (const [key, value] of [
    ['url', original.url],
    ['redirected', original.redirected],
    ['type', original.type]
  ] as const) {
    try {
      Object.defineProperty(replacement, key, { value });
    } catch {
      // Response metadata is non-critical. Fail open on browsers that reject overrides.
    }
  }
  return replacement;
}

function setupConfigBridge(): void {
  window.addEventListener(EVENTS.config, (event) => {
    const parsed = parseStringEvent<unknown>(event);
    if (parsed !== null) updateConfig(normalizeConfig(parsed));
  });
  window.dispatchEvent(new Event(EVENTS.requestConfig));
}

function setupNavigationBridge(): void {
  if (window.__CSG_NAV_PATCHED__) return;
  window.__CSG_NAV_PATCHED__ = true;

  const notify = (): void => { window.dispatchEvent(new Event(EVENTS.navigation)); };
  const pushState = history.pushState.bind(history);
  const replaceState = history.replaceState.bind(history);

  history.pushState = (...args): void => {
    pushState(...args);
    notify();
  };
  history.replaceState = (...args): void => {
    replaceState(...args);
    notify();
  };
  window.addEventListener('popstate', notify);
}

async function parseConversationResponse(response: Response): Promise<ReturnType<typeof detectConversationSchema> | null> {
  if (!response.ok || !isJsonResponse(response)) return null;
  try {
    return detectConversationSchema(await response.clone().json() as unknown);
  } catch {
    return null;
  }
}

function patchFetch(): void {
  if (window.__CSG_FETCH_PATCHED__) return;
  window.__CSG_FETCH_PATCHED__ = true;

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (...args: Parameters<typeof fetch>): Promise<Response> => {
    let classification;
    try {
      classification = classifyRequest(args[0], args[1]);
    } catch {
      return nativeFetch(...args);
    }

    if (classification.kind === 'other') return nativeFetch(...args);

    const config = await configBeforeConversationRequest();
    if (!config || !config.enabled || config.temporaryFullHistory) {
      const response = await nativeFetch(...args);
      emitNetworkStatus({ mode: config ? 'disabled' : 'unknown', modified: false });
      return response;
    }

    if (
      classification.kind === 'paginated-conversation-history' ||
      classification.kind === 'paginated-conversation-page'
    ) {
      const rewrite = rewritePaginatedRequest(classification, config, args);
      const response = await nativeFetch(...rewrite.args);
      const schema = await parseConversationResponse(response);
      if (schema?.kind !== 'paginated') {
        emitNetworkStatus({ mode: 'unknown', modified: false });
        return response;
      }

      adaptPaginatedConversation(schema.data);
      emitNetworkStatus({
        mode: 'paginated',
        modified: rewrite.modified,
        ...(rewrite.requestedTurns === null ? {} : { requestedTurns: rewrite.requestedTurns }),
        ...(rewrite.effectiveTurns === null ? {} : { effectiveTurns: rewrite.effectiveTurns })
      });
      return response;
    }

    const response = await nativeFetch(...args);
    const schema = await parseConversationResponse(response);
    if (schema?.kind !== 'legacy') {
      emitNetworkStatus({ mode: 'unknown', modified: false });
      return response;
    }

    const result = trimLegacyConversation(schema.data, config.recentRounds);
    if (!result) {
      emitNetworkStatus({ mode: 'unknown', modified: false });
      return response;
    }

    emitNetworkStatus({
      mode: 'legacy',
      modified: result.modified,
      totalRounds: result.totalRounds,
      keptRounds: result.keptRounds
    });
    return result.modified ? modifiedResponse(response, result.data) : response;
  };
}

(function init(): void {
  if (__CSG_DEBUG_BUILD__) installDebugHelper();
  setupConfigBridge();
  setupNavigationBridge();
  patchFetch();
})();
