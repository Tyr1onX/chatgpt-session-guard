export interface HistoryExpansionState {
  conversationId: string;
  amount: number;
}

interface HistorySessionResponse {
  state?: HistoryExpansionState | null;
  ok?: boolean;
}

export async function loadHistoryExpansion(): Promise<HistoryExpansionState | null> {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'csg:history-session-get' }) as HistorySessionResponse | undefined;
    const state = response?.state;
    if (!state || typeof state.conversationId !== 'string' || !Number.isFinite(state.amount)) return null;
    return { conversationId: state.conversationId, amount: Math.max(0, Math.round(state.amount)) };
  } catch {
    return null;
  }
}

export async function saveHistoryExpansion(state: HistoryExpansionState): Promise<boolean> {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'csg:history-session-set', state }) as HistorySessionResponse | undefined;
    return response?.ok === true;
  } catch {
    return false;
  }
}

export async function clearHistoryExpansion(): Promise<boolean> {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'csg:history-session-clear' }) as HistorySessionResponse | undefined;
    return response?.ok === true;
  } catch {
    return false;
  }
}
