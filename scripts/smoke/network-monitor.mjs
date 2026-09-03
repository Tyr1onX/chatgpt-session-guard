import { performance } from 'node:perf_hooks';
import { sanitizeNetworkObservation } from './sanitizer.mjs';

const DEFAULT_WINDOW_MS = 10_000;
const DEFAULT_HISTORY_LIMIT = 8;
const AMPLIFICATION_CLASSES = new Set(['conversation-history', 'older-page', 'history-like']);

export class SanitizedNetworkMonitor {
  constructor(context, { salt = '', historyLimit = DEFAULT_HISTORY_LIMIT, windowMs = DEFAULT_WINDOW_MS } = {}) {
    this.context = context;
    this.salt = salt;
    this.historyLimit = historyLimit;
    this.windowMs = windowMs;
    this.records = [];
    this.starts = new WeakMap();
    this.historyTimes = [];
    this.abortReason = null;
    this.onRequest = this.onRequest.bind(this);
    this.onResponse = this.onResponse.bind(this);
  }

  start() {
    this.context.on('request', this.onRequest);
    this.context.on('response', this.onResponse);
    return this;
  }

  stop() {
    this.context.off('request', this.onRequest);
    this.context.off('response', this.onResponse);
  }

  onRequest(request) {
    this.starts.set(request, performance.now());
    if (this.abortReason) return;
    const method = request.method().toUpperCase();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return;
    try {
      const url = new URL(request.url());
      if (url.hostname === 'chatgpt.com' && /\/conversation(?:\/|$)/i.test(url.pathname)) {
        this.abortReason = 'ABORTED_UNEXPECTED_WRITE';
      }
    } catch {
      // Invalid URLs are ignored; evidence remains sanitized in the response path.
    }
  }

  onResponse(response) {
    const request = response.request();
    const started = this.starts.get(request);
    const record = sanitizeNetworkObservation({
      timestamp: new Date().toISOString(),
      method: request.method(),
      status: response.status(),
      url: request.url(),
      durationMs: started === undefined ? null : performance.now() - started
    }, this.salt);
    this.records.push(record);

    if (AMPLIFICATION_CLASSES.has(record.requestClassification)) {
      const now = Date.now();
      this.historyTimes.push(now);
      this.historyTimes = this.historyTimes.filter((time) => now - time <= this.windowMs);
      if (!this.abortReason && this.historyTimes.length > this.historyLimit) {
        this.abortReason = 'ABORTED_REQUEST_AMPLIFICATION';
      }
    }

    if (!this.abortReason && response.status() === 429) {
      this.abortReason = 'ABORTED_RATE_LIMIT';
    }
  }

  summary() {
    const history = this.records.filter((record) => AMPLIFICATION_CLASSES.has(record.requestClassification));
    const older = history.filter((record) => record.requestClassification === 'older-page');
    return {
      totalObserved: this.records.length,
      historyRequests: history.length,
      olderPageRequests: older.length,
      rateLimitedResponses: this.records.filter((record) => record.status === 429).length,
      requestAmplification: this.abortReason === 'ABORTED_REQUEST_AMPLIFICATION',
      unexpectedWrite: this.abortReason === 'ABORTED_UNEXPECTED_WRITE'
    };
  }
}
