export const BOOTSTRAP_STATES = Object.freeze({
  FIRST_TIME: 'FIRST_TIME',
  PREPARE_AUTH_PROFILE: 'PREPARE_AUTH_PROFILE',
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  OPEN_REAL_CHROME_AUTH: 'OPEN_REAL_CHROME_AUTH',
  VERIFY_AUTH: 'VERIFY_AUTH',
  PREPARE_TEST_BROWSER: 'PREPARE_TEST_BROWSER',
  WAIT_LOGIN: 'WAIT_LOGIN',
  WAIT_BIND: 'WAIT_BIND',
  RUN_SMOKE: 'RUN_SMOKE',
  REBIND: 'REBIND'
});

/** @param {{ hasProfile: boolean, hasSentinel: boolean, hasBinding: boolean, loggedIn: boolean, boundConversationAccessible?: boolean | null }} input */
export function decideBootstrapState({ hasProfile, hasSentinel, hasBinding, loggedIn, boundConversationAccessible = null }) {
  if (!hasProfile || !hasSentinel) return BOOTSTRAP_STATES.FIRST_TIME;
  if (!loggedIn) return BOOTSTRAP_STATES.WAIT_LOGIN;
  if (!hasBinding) return BOOTSTRAP_STATES.WAIT_BIND;
  if (boundConversationAccessible === false) return BOOTSTRAP_STATES.REBIND;
  return BOOTSTRAP_STATES.RUN_SMOKE;
}

/** @param {{ chromeProfileReady: boolean, chatgptSessionValid: boolean, extensionInstalled: boolean, hasBinding: boolean, boundConversationAccessible?: boolean | null }} input */
export function decideAuthBootstrapState({ chromeProfileReady, chatgptSessionValid, extensionInstalled, hasBinding, boundConversationAccessible = null }) {
  if (!chromeProfileReady) return BOOTSTRAP_STATES.PREPARE_AUTH_PROFILE;
  if (!chatgptSessionValid) return BOOTSTRAP_STATES.AUTH_REQUIRED;
  if (!extensionInstalled) return BOOTSTRAP_STATES.PREPARE_TEST_BROWSER;
  if (!hasBinding) return BOOTSTRAP_STATES.WAIT_BIND;
  if (boundConversationAccessible === false) return BOOTSTRAP_STATES.REBIND;
  return BOOTSTRAP_STATES.RUN_SMOKE;
}
