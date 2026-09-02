import { Window } from 'happy-dom';
import { DEFAULT_CONFIG, type GuardMode } from '../src/shared/config';
import { DomRollingWindow } from '../src/content/dom-window';

type GlobalWithGc = typeof globalThis & { gc?: () => void };
type BenchmarkMode = 'off' | GuardMode;

interface FixtureProfile {
  rounds: number;
  nodesPerTurn: number;
  heavyEvery: number;
  heavyMultiplier: number;
}

interface ModeResult {
  mode: BenchmarkMode;
  beforeNodes: number;
  afterNodes: number;
  activeNodes: number;
  totalRounds: number;
  activeRounds: number;
  applyMs: number;
  heapDeltaMb: number;
}

interface SwitchSample {
  switch: number;
  documentNodes: number;
  heapMb: number;
}

const windowInstance = new Window({ url: 'https://chatgpt.com/c/benchmark' });
const runtime = globalThis as unknown as Record<string, unknown>;
for (const [key, value] of Object.entries({
  window: windowInstance,
  document: windowInstance.document,
  location: windowInstance.location,
  history: windowInstance.history,
  MutationObserver: windowInstance.MutationObserver,
  CustomEvent: windowInstance.CustomEvent,
  Event: windowInstance.Event,
  HTMLElement: windowInstance.HTMLElement,
  Element: windowInstance.Element,
  Node: windowInstance.Node,
  getComputedStyle: windowInstance.getComputedStyle.bind(windowInstance)
})) {
  runtime[key] = value;
}

runtime.chrome = {
  storage: {
    local: {
      get: async () => ({}),
      set: async () => undefined
    }
  }
};

function forceGc(): void {
  (globalThis as GlobalWithGc).gc?.();
}

function heapMb(): number {
  return Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 10) / 10;
}

function documentNodes(): number {
  return 1 + document.documentElement.querySelectorAll('*').length;
}

function createContent(turn: HTMLElement, count: number, prefix: string): void {
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < count; index += 1) {
    const node = document.createElement(index % 7 === 0 ? 'pre' : 'span');
    node.textContent = `${prefix}-${index} synthetic benchmark content ${'x'.repeat(index % 31)}`;
    if (index % 11 === 0) {
      const inner = document.createElement('code');
      inner.textContent = `const value${index} = ${index};`;
      node.appendChild(inner);
    }
    fragment.appendChild(node);
  }
  turn.appendChild(fragment);
}

function populateFixture(profile: FixtureProfile): void {
  document.body.replaceChildren();
  const main = document.createElement('main');
  const thread = document.createElement('section');
  thread.id = 'thread';
  main.appendChild(thread);
  document.body.appendChild(main);

  for (let round = 0; round < profile.rounds; round += 1) {
    const multiplier = profile.heavyEvery > 0 && round % profile.heavyEvery === 0
      ? profile.heavyMultiplier
      : 1;
    for (const role of ['user', 'assistant'] as const) {
      const turn = document.createElement('article');
      turn.setAttribute('data-testid', `conversation-turn-${round * 2 + (role === 'assistant' ? 1 : 0)}`);
      const message = document.createElement('div');
      message.setAttribute('data-message-author-role', role);
      turn.appendChild(message);
      createContent(message, profile.nodesPerTurn * multiplier, `${round}-${role}`);
      thread.appendChild(turn);
    }
  }
}

function runMode(mode: BenchmarkMode, profile: FixtureProfile): ModeResult {
  populateFixture(profile);
  forceGc();
  const heapBefore = heapMb();
  const beforeNodes = documentNodes();
  const started = performance.now();

  if (mode === 'off') {
    return {
      mode,
      beforeNodes,
      afterNodes: beforeNodes,
      activeNodes: beforeNodes,
      totalRounds: profile.rounds,
      activeRounds: profile.rounds,
      applyMs: Math.round((performance.now() - started) * 100) / 100,
      heapDeltaMb: 0
    };
  }

  const domWindow = new DomRollingWindow();
  const stats = domWindow.apply({ ...DEFAULT_CONFIG, mode });
  const elapsed = performance.now() - started;
  forceGc();
  return {
    mode,
    beforeNodes,
    afterNodes: documentNodes(),
    activeNodes: stats.activeConversationDomNodes,
    totalRounds: stats.totalRounds,
    activeRounds: stats.renderedRounds,
    applyMs: Math.round(elapsed * 100) / 100,
    heapDeltaMb: Math.round((heapMb() - heapBefore) * 10) / 10
  };
}

function runSwitchBenchmark(mode: 'off' | 'balanced'): {
  mode: 'off' | 'balanced';
  samples: SwitchSample[];
  growthMb: number;
  maxNodes: number;
  minNodes: number;
} {
  const profiles: FixtureProfile[] = [
    { rounds: 34, nodesPerTurn: 7, heavyEvery: 9, heavyMultiplier: 3 },
    { rounds: 42, nodesPerTurn: 6, heavyEvery: 13, heavyMultiplier: 4 },
    { rounds: 30, nodesPerTurn: 9, heavyEvery: 7, heavyMultiplier: 3 },
    { rounds: 48, nodesPerTurn: 6, heavyEvery: 11, heavyMultiplier: 4 },
    { rounds: 38, nodesPerTurn: 8, heavyEvery: 8, heavyMultiplier: 3 }
  ];
  const order = [0, 1, 2, 3, 4, 4, 0, 2, 1, 3];
  const samples: SwitchSample[] = [];
  const domWindow = new DomRollingWindow();

  forceGc();
  const initialHeap = heapMb();
  for (let switchIndex = 1; switchIndex <= 100; switchIndex += 1) {
    domWindow.cleanup();
    const profile = profiles[order[(switchIndex - 1) % order.length] ?? 0];
    if (!profile) throw new Error('Missing fixture profile');
    populateFixture(profile);
    if (mode === 'balanced') domWindow.apply({ ...DEFAULT_CONFIG, mode: 'balanced' });

    if (switchIndex % 10 === 0) {
      forceGc();
      samples.push({ switch: switchIndex, documentNodes: documentNodes(), heapMb: heapMb() });
    }
  }

  domWindow.cleanup();
  document.body.replaceChildren();
  forceGc();
  const nodeValues = samples.map((sample) => sample.documentNodes);
  return {
    mode,
    samples,
    growthMb: Math.round((heapMb() - initialHeap) * 10) / 10,
    maxNodes: Math.max(...nodeValues),
    minNodes: Math.min(...nodeValues)
  };
}

const scenario = process.argv[2] ?? 'single';
if (scenario === 'single') {
  const profile: FixtureProfile = { rounds: 120, nodesPerTurn: 10, heavyEvery: 10, heavyMultiplier: 4 };
  console.log(JSON.stringify({
    environment: {
      kind: 'synthetic-happy-dom',
      node: process.version,
      note: 'Measures extension algorithms only, not Chrome renderer/React memory.'
    },
    singleLongConversation: [
      runMode('off', profile),
      runMode('safe', profile),
      runMode('balanced', profile),
      runMode('aggressive', profile)
    ]
  }));
} else if (scenario === 'switch-off' || scenario === 'switch-balanced') {
  console.log(JSON.stringify({
    hundredSwitches: runSwitchBenchmark(scenario === 'switch-off' ? 'off' : 'balanced')
  }));
} else {
  throw new Error(`Unknown scenario: ${scenario}`);
}
