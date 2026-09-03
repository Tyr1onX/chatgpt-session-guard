const GOOGLE_UNSAFE_MARKERS = [
  '此浏览器或应用可能不安全',
  'this browser or app may not be secure',
  'couldn’t sign you in',
  "couldn't sign you in"
];

export function classifyAuthPage({ url = '', visibleText = '' } = {}) {
  const normalized = String(visibleText).toLowerCase();
  const googleOrigin = /(^|\.)accounts\.google\.com$/i.test(safeHostname(url));
  if (googleOrigin && GOOGLE_UNSAFE_MARKERS.some((marker) => normalized.includes(marker.toLowerCase()))) {
    return 'GOOGLE_OAUTH_UNSAFE_BROWSER';
  }
  if (/chatgpt\.com/i.test(url) && /log in|sign in|登录/i.test(visibleText)) return 'AUTH_REQUIRED';
  return 'UNKNOWN';
}

function safeHostname(raw) {
  try {
    return new URL(raw).hostname;
  } catch {
    return '';
  }
}

export function authDiagnosticRecord({ code, browser, browserVersion, launchMode, automationState, chatgptSession }) {
  return {
    schemaVersion: 1,
    code,
    browser,
    browserVersion,
    launchMode,
    automationState,
    chatgptSession,
    containsAccountIdentity: false,
    containsCookieValues: false,
    containsPageHtml: false
  };
}
