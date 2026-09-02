import { networkHistoryTarget, type GuardConfig } from '../shared/config';
import type { ClassifiedRequest } from './request-classifier';
import type { PaginatedConversationData } from './schema-validator';

export interface PaginatedRequestRewrite {
  args: Parameters<typeof fetch>;
  modified: boolean;
  requestedTurns: number | null;
  effectiveTurns: number | null;
}

export interface PaginatedAdaptResult {
  data: PaginatedConversationData;
  modified: false;
}

function rewriteInputUrl(input: RequestInfo | URL, url: URL): RequestInfo | URL {
  if (input instanceof Request) return new Request(url.toString(), input);
  if (input instanceof URL) return url;
  return url.toString();
}

function conversationIdFromUrl(url: URL): string | null {
  const match = url.pathname.match(/^\/backend-api\/conversations\/([^/]+)$/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export function rewritePaginatedRequest(
  classification: ClassifiedRequest,
  config: GuardConfig,
  args: Parameters<typeof fetch>
): PaginatedRequestRewrite {
  if (classification.kind !== 'paginated-conversation-history') {
    return { args, modified: false, requestedTurns: null, effectiveTurns: null };
  }

  const raw = classification.url.searchParams.get('num_turns');
  if (raw === null || !/^\d+$/.test(raw)) {
    return { args, modified: false, requestedTurns: null, effectiveTurns: null };
  }

  const requestedTurns = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(requestedTurns) || requestedTurns < 1 || requestedTurns > 100) {
    return { args, modified: false, requestedTurns, effectiveTurns: null };
  }

  const conversationId = conversationIdFromUrl(classification.url);
  const target = networkHistoryTarget(config, conversationId);
  const effectiveTurns = Math.min(requestedTurns, target);
  if (effectiveTurns === requestedTurns) {
    return { args, modified: false, requestedTurns, effectiveTurns };
  }

  const rewrittenUrl = new URL(classification.url.toString());
  rewrittenUrl.searchParams.set('num_turns', String(effectiveTurns));
  const rewrittenInput = rewriteInputUrl(args[0], rewrittenUrl);
  return {
    args: [rewrittenInput, args[1]],
    modified: true,
    requestedTurns,
    effectiveTurns
  };
}

export function isKnownOlderPageRequestShape(classification: ClassifiedRequest): boolean {
  if (classification.method !== 'GET' || classification.kind !== 'paginated-conversation-page') return false;
  const before = classification.url.searchParams.get('before');
  if (!before) return false;
  // On this exact endpoint a non-empty `before` cursor is the semantic marker for an
  // older-history page. Query flags and page-size parameters may drift independently,
  // so they must not punch a hole through the zero older-page network guarantee.
  // A conflicting forward cursor is treated conservatively as an unknown shape.
  return !classification.url.searchParams.has('after');
}

export function shouldSuppressOlderHistory(classification: ClassifiedRequest, config: GuardConfig): boolean {
  if (!isKnownOlderPageRequestShape(classification)) return false;
  if (config.autoLoadHistory || config.temporaryFullHistory) return false;
  const conversationId = classification.conversationId;
  const manualExpansionActive = Boolean(
    conversationId &&
    config.historyExpansionConversationId === conversationId &&
    config.historyExpansion > 0
  );
  return !manualExpansionActive;
}

export function shouldPreflightSuppressOlderHistory(classification: ClassifiedRequest, config: GuardConfig): boolean {
  return shouldSuppressOlderHistory(classification, config);
}

/** Canonical empty envelope matching the validated paginated response schema. */
export function syntheticEmptyOlderHistoryPage(): PaginatedConversationData {
  return {
    messages: [],
    page_info: {
      start_cursor: null,
      end_cursor: null,
      has_previous_page: false,
      has_next_page: false
    }
  };
}

export function suppressOlderHistoryPage(data: PaginatedConversationData): PaginatedConversationData {
  return {
    ...data,
    messages: [],
    page_info: {
      ...data.page_info,
      has_previous_page: false
    }
  };
}

export function adaptPaginatedConversation(data: PaginatedConversationData): PaginatedAdaptResult {
  return { data, modified: false };
}
