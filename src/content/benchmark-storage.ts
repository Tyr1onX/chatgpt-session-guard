import type { BenchmarkState } from '../shared/benchmark';

interface GetResponse {
  state?: BenchmarkState | null;
}

interface OkResponse {
  ok?: boolean;
}

export async function loadBenchmarkState(): Promise<BenchmarkState | null> {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'csg:benchmark-storage-get' }) as GetResponse | undefined;
    return response?.state ?? null;
  } catch {
    return null;
  }
}

export async function saveBenchmarkState(state: BenchmarkState): Promise<boolean> {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'csg:benchmark-storage-set', state }) as OkResponse | undefined;
    return response?.ok === true;
  } catch {
    return false;
  }
}

export async function clearBenchmarkState(): Promise<boolean> {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'csg:benchmark-storage-clear' }) as OkResponse | undefined;
    return response?.ok === true;
  } catch {
    return false;
  }
}
