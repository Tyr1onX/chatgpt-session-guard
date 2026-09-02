export type Locale = 'zh-CN' | 'en';
export type LanguagePreference = 'auto' | Locale;

declare const __CSG_DEBUG_BUILD__: boolean;
const DEBUG_BUILD = typeof __CSG_DEBUG_BUILD__ !== 'undefined' && __CSG_DEBUG_BUILD__;

const coreEn = {
  appName: 'ChatGPT Session Guard',
  status: 'Status',
  enabled: 'Enabled',
  disabled: 'Disabled',
  enable: 'Enable',
  disable: 'Disable',
  mode: 'Mode',
  modeSafe: 'Safe',
  modeSafeDescription: 'Compatibility first, conservative optimization.',
  modeBalanced: 'Balanced',
  modeBalancedDescription: 'A balance between performance and compatibility.',
  modeUltraLite: 'Ultra Lite',
  modeUltraLiteDescription: 'Keeps only a small recent history window for maximum performance.',
  modeUltraLiteBadge: 'Performance',
  modeUltraLiteUsage: 'Recommended for long conversations when you rarely need older messages.',
  modeAggressive: 'Aggressive · Experimental',
  modeAggressiveDescription: 'Experimental DOM cleanup strategy. Not recommended for everyday use.',
  experimental: 'Experimental',
  history: 'History',
  visibleHistory: 'Visible history',
  historyOneMessage: '1 message · Extreme',
  historyOneRound: '1 round',
  historyRounds2: '2 rounds',
  historyRounds4: '4 rounds',
  historyRounds8: '8 rounds',
  historyRounds16: '16 rounds',
  custom: 'Custom',
  messages: 'Messages',
  rounds: 'Rounds',
  messageExplanation: 'Message = one visible user or ChatGPT message.',
  roundExplanation: '1 round = your message + the corresponding ChatGPT reply.',
  olderHistory: 'Older history',
  manualOnly: 'Manual only',
  automatic: 'Automatic',
  loadPrevious: 'Load previous {count}',
  loadBatch: 'History batch size',
  temporaryFullHistory: 'Temporary Full History',
  restoreLightweightMode: 'Restore Lightweight Mode',
  fullHistoryHint: 'Reloads the current chat so ChatGPT can load the requested history safely.',
  preparingOlderHistory: 'Preparing older history…',
  reloadingCurrentChat: 'Reloading the current chat…',
  unableLoadOlderHistory: 'Unable to load older history.',
  unableReloadHistoryMode: 'Unable to reload the current history mode.',
  ultraLiteNotice: 'Ultra Lite does not delete your ChatGPT history. It only reduces what the browser loads and displays.',
  session: 'Session',
  sessionClean: 'Normal',
  sessionPressure: 'Under pressure',
  sessionNoChat: 'No active chat',
  sessionUnavailable: 'Not connected',
  sessionUnavailableHelp: 'The extension is not connected to this ChatGPT page. Reload the page and try again.',
  reloadPage: 'Reload page',
  activeHistory: 'Active history',
  domBudget: 'DOM budget',
  domBudgetAuto: 'Auto · {value}k',
  budgetLimited: 'budget-limited',
  advancedSettings: 'Advanced settings',
  networkGuard: 'Network history limiting',
  networkGuardOn: 'On',
  networkGuardTemporaryOff: 'Temporarily off',
  networkGuardUnavailable: 'Unavailable',
  domStrategy: 'DOM strategy',
  domStrategySafe: 'Safe',
  domStrategyBalanced: 'Balanced',
  domStrategyAggressive: 'Aggressive · Experimental',
  hardSwitch: 'Hard Switch',
  on: 'On',
  off: 'Off',
  technicalMetrics: 'Technical metrics',
  language: 'Language',
  languageAuto: 'Auto',
  languageChinese: '简体中文',
  languageEnglish: 'English',
  noValue: '—',
  metricConversationId: 'Conversation ID',
  metricSpaSwitches: 'SPA switches',
  metricRenderedRounds: 'Rendered rounds',
  metricRenderedMessages: 'Rendered messages',
  metricHistoryTarget: 'History target',
  metricConversationDom: 'Conversation DOM',
  metricActiveDom: 'Active DOM',
  metricDocumentDom: 'Document DOM',
  metricNetworkGuard: 'Network Guard',
  metricNetworkTurns: 'Network turns',
  metricCleanupCount: 'Cleanup count',
  metricHardSwitches: 'Hard switches',
  metricSwitchLatency: 'Switch latency',
  metricJsHeap: 'JS heap',
  nA: 'n/a'
} as const;

const debugEn = {
  debugTools: 'Developer tools',
  debug: 'Debug',
  benchmark: 'Benchmark',
  benchmarkProfile: 'Profile',
  benchmarkStandard: 'Standard · Control / Balanced / Ultra Lite',
  benchmarkExperimental: 'Experimental · Aggressive',
  conversations: 'Conversations',
  benchmarkMode: 'Mode',
  progress: 'Progress',
  dom: 'DOM',
  heap: 'Heap',
  latency: 'Latency',
  runLength: 'Run length',
  switches100: '100 switches / mode',
  switches50: '50 switches / mode',
  benchmarkStandardMessage: 'Standard Validation compares Control, Balanced and Ultra Lite. Hard Switch stays off.',
  benchmarkExperimentalMessage: 'Experimental profile runs Aggressive only. Session GC stays separate.',
  benchmarkRunningMessage: 'Benchmark is running automatically. Avoid interacting with ChatGPT until it finishes.',
  benchmarkStopped: 'Benchmark stopped.',
  benchmarkComplete: 'Benchmark complete · {result}',
  startBenchmark: 'Start Benchmark',
  startNewBenchmark: 'Start New Benchmark',
  resumeBenchmark: 'Resume Benchmark',
  stopBenchmark: 'Stop Benchmark',
  startingBenchmark: 'Starting benchmark…',
  openLoggedInChat: 'Open a logged-in chatgpt.com tab and try again.',
  downloadJson: 'Download JSON',
  downloadReport: 'Download Report',
  sessionGcBenchmark: 'Run Session GC Benchmark',
  unableSessionGc: 'Unable to start Session GC benchmark.',
  longStress: 'Long Conversation Stress',
  longStressDescription: 'Tests the current long conversation at 8r / 4r / 2r / 1r / 1 message.',
  longStressComplete: 'Long Conversation Stress complete.',
  longStressStep: 'Long Stress: step {step} / 5 · {status}',
  runLongStress: 'Run Long Stress',
  stop: 'Stop',
  startingLongStress: 'Starting Long Conversation Stress…',
  unableLongStress: 'Unable to start Long Conversation Stress.',
  stressJson: 'Stress JSON',
  stressReport: 'Stress Report',
  control: 'Control',
  idle: 'Idle'
} as const;

export type CoreMessageKey = keyof typeof coreEn;
export type DebugMessageKey = keyof typeof debugEn;
export type MessageKey = CoreMessageKey | DebugMessageKey;

const coreZh: Record<CoreMessageKey, string> = {
  appName: 'ChatGPT Session Guard',
  status: '状态',
  enabled: '已启用',
  disabled: '已关闭',
  enable: '启用',
  disable: '关闭',
  mode: '模式',
  modeSafe: '安全模式',
  modeSafeDescription: '兼容性优先，优化较保守。',
  modeBalanced: '均衡模式',
  modeBalancedDescription: '兼顾性能与兼容性。',
  modeUltraLite: '极简模式',
  modeUltraLiteDescription: '只保留少量最近历史，适合超长会话和重度使用。',
  modeUltraLiteBadge: '性能优先',
  modeUltraLiteUsage: '适合几乎不查看历史记录的长会话用户。',
  modeAggressive: '激进模式 · 实验性',
  modeAggressiveDescription: '实验性 DOM 清理策略，当前不建议日常使用。',
  experimental: '实验性',
  history: '历史记录',
  visibleHistory: '显示历史',
  historyOneMessage: '1 条消息 · 极限',
  historyOneRound: '1 轮对话',
  historyRounds2: '2 轮对话',
  historyRounds4: '4 轮对话',
  historyRounds8: '8 轮对话',
  historyRounds16: '16 轮对话',
  custom: '自定义',
  messages: '消息',
  rounds: '轮对话',
  messageExplanation: '消息 = 单条用户或 ChatGPT 消息。',
  roundExplanation: '1 轮 = 你的消息 + ChatGPT 的对应回复。',
  olderHistory: '更早历史',
  manualOnly: '仅手动加载',
  automatic: '自动加载',
  loadPrevious: '加载前 {count} 条',
  loadBatch: '单次加载数量',
  temporaryFullHistory: '临时查看完整历史',
  restoreLightweightMode: '恢复轻量模式',
  fullHistoryHint: '会重新加载当前会话，让 ChatGPT 安全获取所需历史。',
  preparingOlderHistory: '正在准备更早历史…',
  reloadingCurrentChat: '正在重新加载当前会话…',
  unableLoadOlderHistory: '无法加载更早历史。',
  unableReloadHistoryMode: '无法重新加载当前历史模式。',
  ultraLiteNotice: '极简模式不会删除 ChatGPT 中的历史记录，只会减少浏览器当前加载和显示的内容。',
  session: '会话状态',
  sessionClean: '正常',
  sessionPressure: '压力较高',
  sessionNoChat: '没有活动会话',
  sessionUnavailable: '未连接',
  sessionUnavailableHelp: '扩展尚未连接当前 ChatGPT 页面。请刷新当前页面后重试。',
  reloadPage: '刷新页面',
  activeHistory: '当前历史',
  domBudget: 'DOM 预算',
  domBudgetAuto: '自动 · {value}k',
  budgetLimited: '受 DOM 预算限制',
  advancedSettings: '高级设置',
  networkGuard: '网络历史限制',
  networkGuardOn: '已开启',
  networkGuardTemporaryOff: '临时关闭',
  networkGuardUnavailable: '不可用',
  domStrategy: 'DOM 策略',
  domStrategySafe: '安全模式',
  domStrategyBalanced: '均衡模式',
  domStrategyAggressive: '激进模式 · 实验性',
  hardSwitch: '强制会话重载',
  on: '开启',
  off: '关闭',
  technicalMetrics: '技术指标',
  language: '语言',
  languageAuto: '自动',
  languageChinese: '简体中文',
  languageEnglish: 'English',
  noValue: '—',
  metricConversationId: '会话 ID',
  metricSpaSwitches: 'SPA 切换次数',
  metricRenderedRounds: '已显示轮数',
  metricRenderedMessages: '已显示消息数',
  metricHistoryTarget: '历史目标',
  metricConversationDom: '会话 DOM',
  metricActiveDom: '活动 DOM',
  metricDocumentDom: '页面 DOM',
  metricNetworkGuard: '网络历史限制',
  metricNetworkTurns: '网络 turns',
  metricCleanupCount: '清理次数',
  metricHardSwitches: '强制重载次数',
  metricSwitchLatency: '切换延迟',
  metricJsHeap: 'JS 堆内存',
  nA: '不可用'
};

const debugZh: Record<DebugMessageKey, string> = {
  debugTools: '开发工具',
  debug: 'Debug',
  benchmark: '性能测试',
  benchmarkProfile: '测试配置',
  benchmarkStandard: '标准 · 对照组 / 均衡 / 极简',
  benchmarkExperimental: '实验性 · 激进模式',
  conversations: '会话数量',
  benchmarkMode: '模式',
  progress: '进度',
  dom: 'DOM',
  heap: '堆内存',
  latency: '延迟',
  runLength: '测试长度',
  switches100: '每种模式 100 次切换',
  switches50: '每种模式 50 次切换',
  benchmarkStandardMessage: '标准测试比较对照组、均衡模式与极简模式；强制会话重载保持关闭。',
  benchmarkExperimentalMessage: '实验性测试仅运行激进模式；Session GC 单独测试。',
  benchmarkRunningMessage: '性能测试正在自动运行，请暂时不要操作 ChatGPT。',
  benchmarkStopped: '性能测试已停止。',
  benchmarkComplete: '性能测试完成 · {result}',
  startBenchmark: '开始测试',
  startNewBenchmark: '开始新测试',
  resumeBenchmark: '继续测试',
  stopBenchmark: '停止测试',
  startingBenchmark: '正在开始测试…',
  openLoggedInChat: '请打开已登录的 chatgpt.com 页面后重试。',
  downloadJson: '下载 JSON',
  downloadReport: '下载报告',
  sessionGcBenchmark: '运行 Session GC 测试',
  unableSessionGc: '无法启动 Session GC 测试。',
  longStress: '长会话压力测试',
  longStressDescription: '依次测试当前长会话的 8 / 4 / 2 / 1 轮与 1 条消息。',
  longStressComplete: '长会话压力测试已完成。',
  longStressStep: '长会话测试：第 {step} / 5 步 · {status}',
  runLongStress: '开始长会话测试',
  stop: '停止',
  startingLongStress: '正在开始长会话压力测试…',
  unableLongStress: '无法启动长会话压力测试。',
  stressJson: '压力测试 JSON',
  stressReport: '压力测试报告',
  control: '对照组',
  idle: '空闲'
};

const coreCatalog: Record<Locale, Readonly<Record<CoreMessageKey, string>>> = {
  en: coreEn,
  'zh-CN': coreZh
};

const debugCatalog: Record<Locale, Readonly<Record<DebugMessageKey, string>>> | null = DEBUG_BUILD
  ? { en: debugEn, 'zh-CN': debugZh }
  : null;

export function isChineseLanguage(language: string | null | undefined): boolean {
  if (!language) return false;
  return /^zh(?:-|$)/i.test(language.trim());
}

export function resolveLocale(
  preference: LanguagePreference,
  languages: readonly string[] = typeof navigator === 'undefined'
    ? []
    : (navigator.languages?.length ? navigator.languages : [navigator.language])
): Locale {
  if (preference === 'zh-CN' || preference === 'en') return preference;
  const preferred = languages.find((language) => language.trim().length > 0);
  return isChineseLanguage(preferred) ? 'zh-CN' : 'en';
}

export function translate(locale: Locale, key: MessageKey, variables: Record<string, string | number> = {}): string {
  const coreLocalized = (coreCatalog[locale] as Partial<Record<MessageKey, string>>)[key];
  const debugLocalized = debugCatalog
    ? (debugCatalog[locale] as Partial<Record<MessageKey, string>>)[key]
    : undefined;
  const coreFallback = (coreEn as Partial<Record<MessageKey, string>>)[key];
  const debugFallback = DEBUG_BUILD
    ? (debugEn as Partial<Record<MessageKey, string>>)[key]
    : undefined;
  const template = coreLocalized ?? debugLocalized ?? coreFallback ?? debugFallback ?? String(key);
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, variable: string) => {
    const value = variables[variable];
    return value === undefined ? match : String(value);
  });
}

export function translationKeyCount(): number {
  return Object.keys(coreEn).length + (DEBUG_BUILD ? Object.keys(debugEn).length : 0);
}
