import { BOOTSTRAP_STATES, decideBootstrapState } from '../../scripts/smoke/bootstrap-state.mjs';

describe('bootstrap state machine', () => {
  it('fresh install enters FIRST_TIME', () => {
    expect(decideBootstrapState({ hasProfile: false, hasSentinel: false, hasBinding: false, loggedIn: false })).toBe(BOOTSTRAP_STATES.FIRST_TIME);
  });

  it('logged profile without binding enters WAIT_BIND', () => {
    expect(decideBootstrapState({ hasProfile: true, hasSentinel: true, hasBinding: false, loggedIn: true })).toBe(BOOTSTRAP_STATES.WAIT_BIND);
  });

  it('bound and logged profile enters RUN_SMOKE', () => {
    expect(decideBootstrapState({ hasProfile: true, hasSentinel: true, hasBinding: true, loggedIn: true, boundConversationAccessible: true })).toBe(BOOTSTRAP_STATES.RUN_SMOKE);
  });

  it('expired login enters WAIT_LOGIN', () => {
    expect(decideBootstrapState({ hasProfile: true, hasSentinel: true, hasBinding: true, loggedIn: false })).toBe(BOOTSTRAP_STATES.WAIT_LOGIN);
  });

  it('missing bound conversation enters REBIND', () => {
    expect(decideBootstrapState({ hasProfile: true, hasSentinel: true, hasBinding: true, loggedIn: true, boundConversationAccessible: false })).toBe(BOOTSTRAP_STATES.REBIND);
  });
});
