import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { dependencyStatus, assertSupportedNode, chromiumInstalled } from './dependencies.mjs';
import { smokePaths, createRunId } from './paths.mjs';
import { initializeChromeProfile, assertChromeProfile } from './chrome-profile-guard.mjs';
import { authDiagnosticRecord, classifyAuthPage } from './auth-diagnostics.mjs';
import {
  closeOwnedChrome,
  detectChromeVersion,
  discoverChromeExecutable,
  launchAuthChrome,
  launchChromeWithCdp,
  waitForChromeExit
} from './real-chrome.mjs';
import { buildDebugExtension, verifyDebugBuild } from './browser.mjs';
import {
  getOrCreateChatPage,
  isLoggedIn,
  probeBoundConversation,
  showBootstrapStatus,
  waitForConversationSelection
} from './chatgpt.mjs';
import { saveSmokeConfig, tryLoadSmokeConfig } from './config.mjs';
import { createSupportZip, openArtifactDirectory, writeLatestRun } from './support-bundle.mjs';

const root = process.cwd();
const paths = smokePaths(root);
await mkdir(paths.smokeRoot, { recursive: true });
const logPath = path.join(paths.smokeRoot, 'bootstrap.log');
const currentLogLines = [];

async function log(message) {
  console.log(message);
  const line = `[${new Date().toISOString()}] ${message}`;
  currentLogLines.push(line);
  await appendFile(logPath, `${line}\n`, 'utf8');
}

function runNode(args, options = {}) {
  return execFileSync(process.execPath, args, {
    cwd: root,
    stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    encoding: options.inherit ? undefined : 'utf8'
  });
}

function runNpm(args) {
  const npmExec = process.env.npm_execpath;
  if (npmExec) return runNode([npmExec, ...args], { inherit: true });
  const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return execFileSync(command, args, { cwd: root, stdio: 'inherit', windowsHide: true });
}

function runSmoke() {
  const result = spawnSync(process.execPath, ['scripts/smoke/run.mjs', '--real-chrome', '--headed', '--auto-ux'], {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true
  });
  if (result.error) throw result.error;
  return typeof result.status === 'number' ? result.status : 1;
}

async function ensureDependencies() {
  assertSupportedNode();
  let status = dependencyStatus(root);
  if (!status.nodeModules || !status.playwrightPackage || !status.supportZipPackage) {
    await log('正在准备项目依赖…');
    try {
      runNpm(['ci']);
    } catch {
      throw new Error('DEPENDENCY_INSTALL_FAILED');
    }
    status = dependencyStatus(root);
    if (!status.playwrightPackage || !status.supportZipPackage) throw new Error('DEPENDENCY_INSTALL_FAILED');
  }
  const { chromium: bundledChromium } = await import('playwright');
  if (!chromiumInstalled(bundledChromium.executablePath())) {
    await log('正在安装测试依赖 Chromium…');
    try {
      runNode(['node_modules/playwright/cli.js', 'install', 'chromium'], { inherit: true });
    } catch {
      throw new Error('PLAYWRIGHT_CHROMIUM_INSTALL_FAILED');
    }
  }
}

async function closeCdpSession(browser, child) {
  await browser?.close().catch(() => undefined);
  await closeOwnedChrome(child);
}

async function scanKnownGoogleFailure(context) {
  for (const candidate of context.pages()) {
    if (!candidate.url().includes('accounts.google.com')) continue;
    try {
      const text = await candidate.locator('body').innerText({ timeout: 1500 });
      const code = classifyAuthPage({ url: candidate.url(), visibleText: text.slice(0, 4000) });
      if (code === 'GOOGLE_OAUTH_UNSAFE_BROWSER') return code;
    } catch {
      // Never persist or log Google page content; inability to inspect is non-fatal.
    }
  }
  return null;
}

async function probeSession(config) {
  const chromePath = discoverChromeExecutable();
  const launched = await launchChromeWithCdp({ chromePath, profileDir: paths.chromeProfileDir, url: 'about:blank' });
  let browser;
  try {
    browser = await chromium.connectOverCDP(launched.endpoint);
    const context = browser.contexts()[0];
    if (!context) throw new Error('CDP_DEFAULT_CONTEXT_MISSING');
    const authFailure = await scanKnownGoogleFailure(context);
    const page = await getOrCreateChatPage(context);
    await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(1200);
    const loggedIn = await isLoggedIn(page);
    let boundStatus = null;
    if (loggedIn && config?.longConversationId) {
      const result = await probeBoundConversation(page, config.longConversationId);
      boundStatus = result.status;
    }
    return { loggedIn, boundStatus, authFailure, endpoint: launched.endpoint };
  } finally {
    await closeCdpSession(browser, launched.child);
  }
}

async function writeAuthFailure(code, browserVersion, launchMode, chatgptSession) {
  const record = authDiagnosticRecord({
    code,
    browser: 'Google Chrome',
    browserVersion,
    launchMode,
    automationState: launchMode === 'normal-auth' ? 'none' : 'cdp-after-auth',
    chatgptSession
  });
  await writeFile(paths.authDiagnosticPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');

  const runDir = path.join(paths.artifactsDir, `auth-${createRunId()}`);
  await mkdir(runDir, { recursive: true });
  await writeFile(path.join(runDir, 'auth-diagnostic.json'), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  await writeFile(path.join(runDir, 'bootstrap.log'), `${currentLogLines.join('\n')}\n`, 'utf8');
  await writeLatestRun(runDir, root);
  const zipPath = await createSupportZip(runDir);
  await openArtifactDirectory(runDir);
  console.error(`Auth diagnostic: ${code}`);
  if (zipPath) console.error(`如果需要把认证诊断发给 GPT，请发送：${zipPath}`);
}

async function ensureAuthenticated(config, browserVersion) {
  let probe = await probeSession(config);
  if (probe.loggedIn) return probe;

  await log('需要首次认证：将打开 Session Guard 专用的正常 Google Chrome。');
  await log('请在该独立 Chrome 中正常登录 ChatGPT；Google/2FA 由你本人完成。登录成功后直接关闭这个专用 Chrome。');
  const chromePath = discoverChromeExecutable();
  const authChrome = launchAuthChrome({ chromePath, profileDir: paths.chromeProfileDir });
  await waitForChromeExit(authChrome);

  await log('专用登录 Chrome 已关闭，正在验证 ChatGPT 会话…');
  probe = await probeSession(config);
  if (probe.authFailure === 'GOOGLE_OAUTH_UNSAFE_BROWSER') {
    await writeAuthFailure('GOOGLE_OAUTH_UNSAFE_BROWSER', browserVersion, 'normal-auth', 'missing');
    throw new Error('GOOGLE_OAUTH_UNSAFE_BROWSER');
  }
  if (!probe.loggedIn) {
    await writeAuthFailure('CHATGPT_SESSION_NOT_ESTABLISHED', browserVersion, 'normal-auth', 'missing');
    throw new Error('CHATGPT_SESSION_NOT_ESTABLISHED');
  }
  await log('Google / ChatGPT 登录态验证成功。');
  return probe;
}

async function bindConversationIfNeeded(configResult, probe) {
  if (configResult.ok && probe.boundStatus === 'ok') return configResult.config;
  if (configResult.ok && probe.boundStatus === 'ui-changed') throw new Error('HARNESS_INCOMPATIBLE: PRODUCT_UI_CHANGED');
  if (configResult.ok && probe.boundStatus !== 'ok') await log('之前绑定的测试会话已无法访问，请重新点开一个超长会话。');
  else await log('现在只需要在专用测试 Chrome 中点开一个超长旧会话。');

  const chromePath = discoverChromeExecutable();
  const launched = await launchChromeWithCdp({ chromePath, profileDir: paths.chromeProfileDir, url: 'https://chatgpt.com/' });
  let browser;
  try {
    browser = await chromium.connectOverCDP(launched.endpoint);
    const context = browser.contexts()[0];
    if (!context) throw new Error('CDP_DEFAULT_CONTEXT_MISSING');
    const page = await getOrCreateChatPage(context);
    await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await showBootstrapStatus(page, 'Session Guard 自动测试', '请在左侧历史记录中点开那个很长、容易出现问题的旧聊天。程序会自动识别并继续。');
    const longConversationId = await waitForConversationSelection(page);
    if (!longConversationId) throw new Error('LONG_CONVERSATION_SELECTION_TIMEOUT');
    const config = await saveSmokeConfig({ schemaVersion: 1, longConversationId, switchConversationIds: [] }, root);
    await log('超长会话已自动绑定到本地配置。');
    return config;
  } finally {
    await closeCdpSession(browser, launched.child);
  }
}

try {
  await log('Session Guard 一键自动测试启动');
  await ensureDependencies();

  const freshChromeProfile = !existsSync(paths.chromeProfileDir) || !existsSync(paths.chromeSentinelPath);
  if (freshChromeProfile) await log('首次使用：正在创建完全隔离的 Session Guard Chrome Profile。');
  await initializeChromeProfile(root);
  await assertChromeProfile(root);

  await log('正在构建当前代码对应的 Debug 扩展…');
  const identity = buildDebugExtension(root);
  await verifyDebugBuild({ distDir: paths.distDir, expectedBuildId: identity.buildId });

  const chromePath = discoverChromeExecutable();
  const browserVersion = await detectChromeVersion(chromePath);
  await log(`检测到 Google Chrome ${browserVersion}。`);

  if (process.argv.includes('--dry-run')) {
    const launched = await launchChromeWithCdp({ chromePath, profileDir: paths.chromeProfileDir, url: 'about:blank' });
    let browser;
    try {
      browser = await chromium.connectOverCDP(launched.endpoint);
      if (!browser.contexts()[0]) throw new Error('CDP_DEFAULT_CONTEXT_MISSING');
      await log(`Dedicated normal Chrome CDP dry-run verified: ${browserVersion}, localhost only.`);
    } finally {
      await closeCdpSession(browser, launched.child);
    }
    process.exit(0);
  }

  const configResult = await tryLoadSmokeConfig(root);
  let probe = await ensureAuthenticated(configResult.ok ? configResult.config : null, browserVersion);
  // The real smoke phase loads the current Debug extension into this dedicated Chrome through localhost CDP.
  probe = await probeSession(configResult.ok ? configResult.config : null);
  if (!probe.loggedIn) throw new Error('CHATGPT_SESSION_NOT_ESTABLISHED');
  await bindConversationIfNeeded(configResult, probe);

  await log('认证和长会话绑定已准备完成；测试阶段将自动加载当前 Debug 扩展并开始真实 Scroll Containment Smoke…');
  const smokeExitCode = runSmoke();
  if (smokeExitCode !== 0) process.exitCode = smokeExitCode;
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'NODE_VERSION_UNSUPPORTED') console.error('缺少可用的 Node.js 22+ 环境。请先安装 Node.js 22 或更高版本。');
  else if (message.includes('DEPENDENCY')) console.error('依赖安装失败。详情已写入本地 bootstrap.log。');
  else if (message === 'GOOGLE_OAUTH_UNSAFE_BROWSER') console.error('认证失败：GOOGLE_OAUTH_UNSAFE_BROWSER。正常 Chrome 认证仍被 Google 拒绝，已停止，不会尝试 Cookie workaround。');
  else console.error(`Session Guard 一键测试停止：${message}`);
  await appendFile(logPath, `[${new Date().toISOString()}] ERROR ${message}\n`, 'utf8').catch(() => undefined);
  process.exitCode = 1;
}
