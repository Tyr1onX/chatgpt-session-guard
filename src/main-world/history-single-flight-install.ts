import { normalizeConfig, type GuardConfig } from '../shared/config';
import { EVENTS, parseStringEvent } from '../shared/events';
import { createHistorySingleFlightFetch } from './history-single-flight';

let runtimeConfig: GuardConfig | null = null;

window.addEventListener(EVENTS.config, (event) => {
  const parsed = parseStringEvent<unknown>(event);
  if (parsed !== null) runtimeConfig = normalizeConfig(parsed);
});

const nativeFetch = window.fetch.bind(window);
window.fetch = createHistorySingleFlightFetch(nativeFetch, () => runtimeConfig);
