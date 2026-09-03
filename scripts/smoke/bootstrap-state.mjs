export const BOOTSTRAP_STATES = Object.freeze({
  FIRST_TIME: 'FIRST_TIME',
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
