import { EventEmitter } from 'node:events';
import { SanitizedNetworkMonitor, classifyConversationRequestSafety } from '../../scripts/smoke/network-monitor.mjs';

class FakeContext extends EventEmitter {
  override on(event: string, listener: (...args: unknown[]) => void): this {
    return super.on(event, listener);
  }

  override off(event: string, listener: (...args: unknown[]) => void): this {
    return super.off(event, listener);
  }
}

function request(method: string, url: string) {
  return {
    method: () => method,
    url: () => url
  };
}

function response(req: ReturnType<typeof request>, status: number) {
  return {
    request: () => req,
    status: () => status
  };
}

describe('smoke network safety monitor', () => {
  it('aborts immediately on HTTP 429 without retry logic', () => {
    const context = new FakeContext();
    const monitor = new SanitizedNetworkMonitor(context, { salt: 'test' }).start();
    const req = request('GET', 'https://chatgpt.com/backend-api/conversation/fake-conversation-0001');
    context.emit('request', req);
    context.emit('response', response(req, 429));
    expect(monitor.abortReason).toBe('ABORTED_RATE_LIMIT');
    expect(monitor.summary().rateLimitedResponses).toBe(1);
    monitor.stop();
  });

  it('aborts on classified history request amplification', () => {
    const context = new FakeContext();
    const monitor = new SanitizedNetworkMonitor(context, { salt: 'test', historyLimit: 2, windowMs: 10_000 }).start();
    for (let index = 0; index < 3; index += 1) {
      const req = request('GET', `https://chatgpt.com/backend-api/conversation/fake-conversation-0001?before=cursor-${index}`);
      context.emit('request', req);
      context.emit('response', response(req, 200));
    }
    expect(monitor.abortReason).toBe('ABORTED_REQUEST_AMPLIFICATION');
    expect(monitor.summary().requestAmplification).toBe(true);
    monitor.stop();
  });

  it('does not count static conversation assets or bootstrap reads as history amplification', () => {
    const context = new FakeContext();
    const monitor = new SanitizedNetworkMonitor(context, { salt: 'test', historyLimit: 2, windowMs: 10_000 }).start();
    const urls = [
      'https://chatgpt.com/cdn/assets/conversation-small-example.js',
      'https://chatgpt.com/cdn/assets/conversation-small-example.css',
      'https://chatgpt.com/backend-api/conversation/init',
      'https://chatgpt.com/backend-api/f/conversation/prepare',
      'https://chatgpt.com/backend-api/f/conversation/prepare'
    ];
    for (const url of urls) {
      const req = request(url.includes('/backend-api/') ? 'POST' : 'GET', url);
      context.emit('request', req);
      context.emit('response', response(req, 200));
    }
    expect(monitor.abortReason).toBeNull();
    expect(monitor.summary().historyRequests).toBe(0);
    expect(monitor.summary().requestAmplification).toBe(false);
    monitor.stop();
  });

  it.each([
    'https://chatgpt.com/backend-api/conversation/init',
    'https://chatgpt.com/backend-api/f/conversation/prepare'
  ])('allows the exact read-only conversation bootstrap POST %s', (url) => {
    expect(classifyConversationRequestSafety('POST', url)).toBe('BOOTSTRAP_READ');
    const context = new FakeContext();
    const monitor = new SanitizedNetworkMonitor(context, { salt: 'test' }).start();
    const req = request('POST', url);
    context.emit('request', req);
    expect(monitor.abortReason).toBeNull();
    monitor.stop();
  });

  it('keeps an unknown conversation POST fail-safe', () => {
    const context = new FakeContext();
    const monitor = new SanitizedNetworkMonitor(context, { salt: 'test' }).start();
    const req = request('POST', 'https://chatgpt.com/backend-api/conversation/something-unknown');
    context.emit('request', req);
    expect(classifyConversationRequestSafety(req.method(), req.url())).toBe('UNKNOWN_MUTATION');
    expect(monitor.abortReason).toBe('ABORTED_UNEXPECTED_WRITE');
    monitor.stop();
  });

  it('aborts on a known ChatGPT conversation POST mutation', () => {
    const context = new FakeContext();
    const monitor = new SanitizedNetworkMonitor(context, { salt: 'test' }).start();
    const req = request('POST', 'https://chatgpt.com/backend-api/conversation');
    context.emit('request', req);
    expect(monitor.abortReason).toBe('ABORTED_UNEXPECTED_WRITE');
    expect(monitor.summary().unexpectedWrite).toBe(true);
    monitor.stop();
  });

  it.each(['PUT', 'PATCH', 'DELETE'])('keeps %s conversation mutations fail-safe', (method) => {
    const context = new FakeContext();
    const monitor = new SanitizedNetworkMonitor(context, { salt: 'test' }).start();
    const req = request(method, 'https://chatgpt.com/backend-api/conversation/fake-conversation-0001');
    context.emit('request', req);
    expect(classifyConversationRequestSafety(req.method(), req.url())).toBe('UNKNOWN_MUTATION');
    expect(monitor.abortReason).toBe('ABORTED_UNEXPECTED_WRITE');
    monitor.stop();
  });
});
