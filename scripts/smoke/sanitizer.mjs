import { createHash, randomBytes } from 'node:crypto';

const SENSITIVE_KEY = /(authorization|cookie|body|prompt|answer|content|html|text|token|secret|password)/i;
const BOOTSTRAP_READ_PATHS = new Set([
  '/backend-api/conversation/init',
  '/backend-api/f/conversation/prepare'
]);

export function createRunSalt() {
  return randomBytes(16).toString('hex');
}

/** @param {unknown} value @param {string} salt */
export function hashIdentifier(value, salt) {
  if (typeof value !== 'string' || value.length === 0) return null;
  return createHash('sha256').update(`${salt}:${value}`).digest('hex').slice(0, 16);
}

/** @param {string} rawUrl @param {string} salt */
export function sanitizeUrl(rawUrl, salt) {
  try {
    const url = new URL(rawUrl);
    const queryKeys = [...new Set([...url.searchParams.keys()])].sort();
    const segments = url.pathname.split('/').filter(Boolean);
    let pathname = url.pathname;
    let conversationHash = null;
    const conversationIndex = segments.findIndex((item) => item === 'conversation' || item === 'c');
    const candidate = conversationIndex >= 0 ? segments[conversationIndex + 1] : null;
    if (candidate && candidate.length >= 8) {
      conversationHash = hashIdentifier(candidate, salt);
      pathname = pathname.replace(candidate, ':conversation');
    }
    return { pathname, queryKeys, conversationHash };
  } catch {
    return { pathname: 'INVALID_URL', queryKeys: [], conversationHash: null };
  }
}

/** @param {string} pathname @param {string[]} queryKeys */
export function classifyRequest(pathname, queryKeys) {
  const lower = pathname.toLowerCase();
  if (BOOTSTRAP_READ_PATHS.has(lower)) return 'bootstrap-read';
  if (!lower.startsWith('/backend-api/')) return 'other';

  const historyLike = lower.includes('/conversation') || lower.includes('/conversations');
  if (!historyLike) return 'other';
  if (queryKeys.includes('before')) return 'older-page';
  if (lower.includes('/conversation/')) return 'conversation-history';
  if (lower.endsWith('/conversations')) return 'conversation-list';
  return 'history-like';
}

/**
 * @param {{timestamp: string, method: string, status?: number|null, url: string, durationMs?: number|null}} input
 * @param {string} salt
 */
export function sanitizeNetworkObservation({ timestamp, method, status = null, url, durationMs = null }, salt) {
  const sanitizedUrl = sanitizeUrl(url, salt);
  return {
    timestamp,
    method: typeof method === 'string' ? method.toUpperCase() : 'UNKNOWN',
    status: Number.isFinite(status) ? status : null,
    pathname: sanitizedUrl.pathname,
    queryKeys: sanitizedUrl.queryKeys,
    requestClassification: classifyRequest(sanitizedUrl.pathname, sanitizedUrl.queryKeys),
    conversationHash: sanitizedUrl.conversationHash,
    durationMs: Number.isFinite(durationMs) ? Math.max(0, Math.round(durationMs ?? 0)) : null
  };
}

/** @param {unknown} value @param {string} salt @returns {unknown} */
export function sanitizeForEvidence(value, salt) {
  if (Array.isArray(value)) return value.map((item) => sanitizeForEvidence(item, salt));
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) continue;
    if (/conversationId/i.test(key)) {
      result[`${key}Hash`] = hashIdentifier(item, salt);
      continue;
    }
    if ((key === 'url' || key === 'path' || key === 'pathname') && typeof item === 'string') {
      result[key] = sanitizeUrl(item, salt).pathname;
      continue;
    }
    result[key] = sanitizeForEvidence(item, salt);
  }
  return result;
}

/** @param {unknown} value */
export function evidenceContainsSensitiveMaterial(value) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  return /authorization|cookie|requestBody|responseBody|access[_-]?token|session[_-]?token|<html|innerHTML/i.test(serialized);
}
