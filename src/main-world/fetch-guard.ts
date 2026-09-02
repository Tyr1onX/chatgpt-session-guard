import { historyTarget, normalizeConfig, type GuardConfig } from '../shared/config';
import { EVENTS, dispatchStringEvent, parseStringEvent, type NetworkStatus } from '../shared/events';
import { installDebugHelper } from './debug-helper';
import { trimLegacyConversation } from './legacy-adapter';
import {
  adaptPaginatedConversation,
  rewritePaginatedRequest,
  shouldPreflightSuppressOlderHistory,
  shouldSuppressOlderHistory,
  suppressOlderHistoryPage,
  syntheticEmptyOlderHistoryPage
} from './paginated-adapter';
import { classifyRequest, type ClassifiedRequest } from './request-classifier';
import { detectConversationSchema, type ConversationSchema } from './schema-validator';

declare const __CSG_DEBUG_BUILD__: boolean;
declare const __CSG_BUILD_ID__: string;

declare global {
  interface Window {
    __CSG_FETCH_PATCHED__?: boolean;
    __CSG_NAV_PATCHED__?: boolean;
  }
}

export interface NetworkTraceEvent {
  timestamp: number;
  type: 'history-request' | 'unclassified-history-like';
  kind: ClassifiedRequest['kind'];
  conversationId: string | null;
  pathname: string;
  queryKeys: string[];
  fetchStart?: number;
  responseHeaders?: number;
  parseStart?: number;
  parseEnd?: number;
  returnToReact?: number;
  historyParseMs?: number;
  status?: number;
  contentLength?: string | null;
  messageCount?: number;
  toolThinkingMetadataCount?: number;
  schemaKind?: ConversationSchema['kind'];
  requestedTurns?: number | null;
  effectiveTurns?: number | null;
  preflightSuppressed?: boolean;
  heavyHistoryParse?: 'over-100ms' | 'over-250ms' | 'over-500ms';
}

type TraceSink = (event: NetworkTraceEvent) => void;
type ConfigResolver = () => Promise<GuardConfig | null>;
type StatusSink = (status: NetworkStatus) => void;

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

async function configBeforeConversationRequest(timeoutMs = 500): Promise<GuardConfig | null> {
  if (currentConfig) return currentConfig;

  // The MAIN-world script and the isolated content script both run at document_start, but
  // their relative listener-install timing is not guaranteed. The bridge's initial request
  // can therefore be missed. Re-request immediately when the first history fetch arrives so
  // an already-mounted content listener can answer synchronously instead of letting an
  // ultra-long conversation fail open into an unbounded history request chain.
  window.dispatchEvent(new Event(EVENTS.requestConfig));
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

function emitNetworkTrace(event: NetworkTraceEvent): void {
  dispatchStringEvent('csg:stability-network-trace', event);
}

function isJsonResponse(response: Response): boolean {
  return (response.headers.get('content-type') ?? '').toLowerCase().includes('application/json');
}

function responseWithMetadata(data: unknown, options: {
  original?: Response;
  url: string;
  status?: number;
  statusText?: string;
  headers?: HeadersInit;
}): Response {
  const headers = new Headers(options.original?.headers ?? options.headers);
  headers.delete('content-length');
  headers.delete('content-encoding');
  headers.set('content-type', 'application/json; charset=utf-8');
  const replacement = new Response(JSON.stringify(data), {
    status: options.original?.status ?? options.status ?? 200,
    statusText: options.original?.statusText ?? options.statusText ?? 'OK',
    headers
  });
  const metadata = options.original
    ? [['url', options.original.url], ['redirected', options.original.redirected], ['type', options.original.type]] as const
    : [['url', options.url], ['redirected', false], ['type', 'basic']] as const;
  for (const [key, value] of metadata) {
    try {
      Object.defineProperty(replacement, key, { value });
    } catch {
      // Response metadata is non-critical.
    }
  }
  return replacement;
}

function modifiedResponse(original: Response, data: unknown): Response {
  return responseWithMetadata(data, { original, url: original.url });
}

function syntheticOlderResponse(classification: ClassifiedRequest): Response {
  return responseWithMetadata(syntheticEmptyOlderHistoryPage(), { url: classification.url.toString() });
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

async function parseConversationResponse(response: Response): Promise<ConversationSchema | null> {
  if (!response.ok || !isJsonResponse(response)) return null;
  try {
    return detectConversationSchema(await response.clone().json() as unknown);
  } catch {
    return null;
  }
}

function heavyParseBucket(durationMs: number): NetworkTraceEvent['heavyHistoryParse'] {
  if (durationMs > 500) return 'over-500ms';
  if (durationMs > 250) return 'over-250ms';
  if (durationMs > 100) return 'over-100ms';
  return undefined;
}

function countToolThinkingMetadata(schema: ConversationSchema): number | undefined {
  if (schema.kind !== 'paginated') return undefined;
  let count = 0;
  for (const message of schema.data.messages) {
    const type = message.content?.content_type?.toLowerCase() ?? '';
    const metadata = message.metadata ?? {};
    if (/tool|thought|thinking|reason/.test(type)) count += 1;
    else if (Object.keys(metadata).some((key) => /tool|thought|thinking|reason/i.test(key))) count += 1;
  }
  return count;
}

function traceBase(classification: ClassifiedRequest): Pick<NetworkTraceEvent, 'timestamp' | 'kind' | 'conversationId' | 'pathname' | 'queryKeys'> {
  return {
    timestamp: Date.now(),
    kind: classification.kind,
    conversationId: classification.conversationId,
    pathname: classification.url.pathname,
    queryKeys: [...classification.url.searchParams.keys()].sort()
  };
}

function suspiciousOther(classification: ClassifiedRequest): boolean {
  return classification.kind === 'other' && classification.method === 'GET' && classification.url.origin === location.origin &&
    /conversation|messages|history|turn|cursor/i.test(classification.url.pathname);
}

export function createGuardedFetch(
  nativeFetch: typeof fetch,
  resolveConfig: ConfigResolver = configBeforeConversationRequest,
  statusSink: StatusSink = emitNetworkStatus,
  traceSink?: TraceSink
): typeof fetch {
  return async (...args: Parameters<typeof fetch>): Promise<Response> => {
    let classification: ClassifiedRequest;
    try {
      classification = classifyRequest(args[0], args[1]);
    } catch {
      return nativeFetch(...args);
    }

    if (classification.kind === 'other') {
      if (__CSG_DEBUG_BUILD__ && traceSink && suspiciousOther(classification)) {
        traceSink({ ...traceBase(classification), type: 'unclassified-history-like' });
      }
      return nativeFetch(...args);
    }

    const config = await resolveConfig();
    if (!config || !config.enabled || config.temporaryFullHistory) {
      const response = await nativeFetch(...args);
      statusSink({ mode: config ? 'disabled' : 'unknown', modified: false });
      return response;
    }

    if (classification.kind === 'paginated-conversation-page' && shouldPreflightSuppressOlderHistory(classification, config)) {
      statusSink({ mode: 'paginated', modified: true });
      if (__CSG_DEBUG_BUILD__ && traceSink) {
        const now = performance.now();
        traceSink({
          ...traceBase(classification),
          type: 'history-request',
          fetchStart: now,
          returnToReact: now,
          messageCount: 0,
          schemaKind: 'paginated',
          preflightSuppressed: true
        });
      }
      return syntheticOlderResponse(classification);
    }

    if (
      classification.kind === 'paginated-conversation-history' ||
      classification.kind === 'paginated-conversation-page'
    ) {
      const rewrite = rewritePaginatedRequest(classification, config, args);
      let timing: { fetchStart: number; responseHeaders: number; parseStart: number; parseEnd: number } | null = null;
      if (__CSG_DEBUG_BUILD__) timing = { fetchStart: performance.now(), responseHeaders: 0, parseStart: 0, parseEnd: 0 };
      const response = await nativeFetch(...rewrite.args);
      if (__CSG_DEBUG_BUILD__ && timing) timing.responseHeaders = performance.now();
      if (__CSG_DEBUG_BUILD__ && timing) timing.parseStart = performance.now();
      const schema = await parseConversationResponse(response);
      if (__CSG_DEBUG_BUILD__ && timing) timing.parseEnd = performance.now();

      if (schema?.kind !== 'paginated') {
        statusSink({ mode: 'unknown', modified: false });
        if (__CSG_DEBUG_BUILD__ && traceSink) {
          traceSink({
            ...traceBase(classification),
            type: 'history-request',
            fetchStart: timing?.fetchStart ?? 0,
            responseHeaders: timing?.responseHeaders ?? 0,
            parseStart: timing?.parseStart ?? 0,
            parseEnd: timing?.parseEnd ?? 0,
            returnToReact: performance.now(),
            historyParseMs: (timing?.parseEnd ?? 0) - (timing?.parseStart ?? 0),
            ...(() => { const duration = (timing?.parseEnd ?? 0) - (timing?.parseStart ?? 0); const heavy = heavyParseBucket(duration); return heavy ? { heavyHistoryParse: heavy } : {}; })(),
            status: response.status,
            contentLength: response.headers.get('content-length'),
            schemaKind: schema?.kind ?? 'unknown',
            requestedTurns: rewrite.requestedTurns,
            effectiveTurns: rewrite.effectiveTurns,
            preflightSuppressed: false
          });
        }
        return response;
      }

      adaptPaginatedConversation(schema.data);
      const suppressOlder = shouldSuppressOlderHistory(classification, config);
      statusSink({
        mode: 'paginated',
        modified: rewrite.modified || suppressOlder,
        ...(rewrite.requestedTurns === null ? {} : { requestedTurns: rewrite.requestedTurns }),
        ...(rewrite.effectiveTurns === null ? {} : { effectiveTurns: rewrite.effectiveTurns })
      });
      if (__CSG_DEBUG_BUILD__ && traceSink) {
        const duration = (timing?.parseEnd ?? 0) - (timing?.parseStart ?? 0);
        const heavy = heavyParseBucket(duration);
        const toolThinking = countToolThinkingMetadata(schema);
        traceSink({
          ...traceBase(classification),
          type: 'history-request',
          fetchStart: timing?.fetchStart ?? 0,
          responseHeaders: timing?.responseHeaders ?? 0,
          parseStart: timing?.parseStart ?? 0,
          parseEnd: timing?.parseEnd ?? 0,
          returnToReact: performance.now(),
          historyParseMs: duration,
          ...(heavy ? { heavyHistoryParse: heavy } : {}),
          status: response.status,
          contentLength: response.headers.get('content-length'),
          messageCount: schema.data.messages.length,
          ...(toolThinking === undefined ? {} : { toolThinkingMetadataCount: toolThinking }),
          schemaKind: schema.kind,
          requestedTurns: rewrite.requestedTurns,
          effectiveTurns: rewrite.effectiveTurns,
          preflightSuppressed: false
        });
      }
      return suppressOlder ? modifiedResponse(response, suppressOlderHistoryPage(schema.data)) : response;
    }

    let timing: { fetchStart: number; responseHeaders: number; parseStart: number; parseEnd: number } | null = null;
    if (__CSG_DEBUG_BUILD__) timing = { fetchStart: performance.now(), responseHeaders: 0, parseStart: 0, parseEnd: 0 };
    const response = await nativeFetch(...args);
    if (__CSG_DEBUG_BUILD__ && timing) timing.responseHeaders = performance.now();
    if (__CSG_DEBUG_BUILD__ && timing) timing.parseStart = performance.now();
    const schema = await parseConversationResponse(response);
    if (__CSG_DEBUG_BUILD__ && timing) timing.parseEnd = performance.now();

    if (schema?.kind !== 'legacy') {
      statusSink({ mode: 'unknown', modified: false });
      if (__CSG_DEBUG_BUILD__ && traceSink) {
        const duration = (timing?.parseEnd ?? 0) - (timing?.parseStart ?? 0);
        const heavy = heavyParseBucket(duration);
        traceSink({
          ...traceBase(classification),
          type: 'history-request',
          fetchStart: timing?.fetchStart ?? 0,
          responseHeaders: timing?.responseHeaders ?? 0,
          parseStart: timing?.parseStart ?? 0,
          parseEnd: timing?.parseEnd ?? 0,
          returnToReact: performance.now(),
          historyParseMs: duration,
          ...(heavy ? { heavyHistoryParse: heavy } : {}),
          status: response.status,
          contentLength: response.headers.get('content-length'),
          schemaKind: schema?.kind ?? 'unknown',
          preflightSuppressed: false
        });
      }
      return response;
    }

    const result = trimLegacyConversation(schema.data, historyTarget(config));
    if (!result) {
      statusSink({ mode: 'unknown', modified: false });
      return response;
    }

    statusSink({
      mode: 'legacy',
      modified: result.modified,
      totalRounds: result.totalRounds,
      keptRounds: result.keptRounds
    });
    if (__CSG_DEBUG_BUILD__ && traceSink) {
      const duration = (timing?.parseEnd ?? 0) - (timing?.parseStart ?? 0);
      const heavy = heavyParseBucket(duration);
      traceSink({
        ...traceBase(classification),
        type: 'history-request',
        fetchStart: timing?.fetchStart ?? 0,
        responseHeaders: timing?.responseHeaders ?? 0,
        parseStart: timing?.parseStart ?? 0,
        parseEnd: timing?.parseEnd ?? 0,
        returnToReact: performance.now(),
        historyParseMs: duration,
        ...(heavy ? { heavyHistoryParse: heavy } : {}),
        status: response.status,
        contentLength: response.headers.get('content-length'),
        schemaKind: schema.kind,
        preflightSuppressed: false
      });
    }
    return result.modified ? modifiedResponse(response, result.data) : response;
  };
}

function patchFetch(): void {
  if (window.__CSG_FETCH_PATCHED__) return;
  window.__CSG_FETCH_PATCHED__ = true;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = createGuardedFetch(
    nativeFetch,
    configBeforeConversationRequest,
    emitNetworkStatus,
    __CSG_DEBUG_BUILD__ ? emitNetworkTrace : undefined
  );
}

export function initializeFetchGuard(): void {
  if (__CSG_DEBUG_BUILD__) installDebugHelper();
  setupConfigBridge();
  setupNavigationBridge();
  patchFetch();
}

if (typeof __CSG_BUILD_ID__ !== 'undefined') initializeFetchGuard();
