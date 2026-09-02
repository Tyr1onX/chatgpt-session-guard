export type RequestKind =
  | 'legacy-conversation-history'
  | 'shared-conversation-history'
  | 'paginated-conversation-history'
  | 'paginated-conversation-page'
  | 'other';

export interface ClassifiedRequest {
  kind: RequestKind;
  method: string;
  url: URL;
  conversationId: string | null;
}

const LEGACY_PATH = /^\/backend-api\/conversation\/([^/]+)\/?$/;
const SHARED_PATH = /^\/backend-api\/shared_conversation\/([^/]+)\/?$/;
const PAGINATED_PATH = /^\/backend-api\/conversations\/([^/]+)\/?$/;
const PAGINATED_PAGE_PATH = /^\/backend-api\/conversations\/([^/]+)\/messages\/?$/;

export function classifyRequest(input: RequestInfo | URL, init?: RequestInit): ClassifiedRequest {
  let rawUrl: string;
  let method: string;

  if (input instanceof Request) {
    rawUrl = input.url;
    method = (init?.method ?? input.method ?? 'GET').toUpperCase();
  } else if (input instanceof URL) {
    rawUrl = input.href;
    method = (init?.method ?? 'GET').toUpperCase();
  } else {
    rawUrl = String(input);
    method = (init?.method ?? 'GET').toUpperCase();
  }

  const url = new URL(rawUrl, location.href);
  if (method !== 'GET' || url.origin !== location.origin) {
    return { kind: 'other', method, url, conversationId: null };
  }

  const paginatedPageMatch = url.pathname.match(PAGINATED_PAGE_PATH);
  if (paginatedPageMatch?.[1]) {
    return {
      kind: 'paginated-conversation-page',
      method,
      url,
      conversationId: paginatedPageMatch[1]
    };
  }

  const paginatedMatch = url.pathname.match(PAGINATED_PATH);
  if (paginatedMatch?.[1]) {
    return {
      kind: 'paginated-conversation-history',
      method,
      url,
      conversationId: paginatedMatch[1]
    };
  }

  const legacyMatch = url.pathname.match(LEGACY_PATH);
  if (legacyMatch?.[1]) {
    return {
      kind: 'legacy-conversation-history',
      method,
      url,
      conversationId: legacyMatch[1]
    };
  }

  const sharedMatch = url.pathname.match(SHARED_PATH);
  if (sharedMatch?.[1]) {
    return {
      kind: 'shared-conversation-history',
      method,
      url,
      conversationId: sharedMatch[1]
    };
  }

  return { kind: 'other', method, url, conversationId: null };
}
