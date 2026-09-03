import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { dependencyStatus, assertSupportedNode, chromiumInstalled } from './dependencies.mjs';
import { BOOTSTRAP_STATES, decideBootstrapState } from './bootstrap-state.mjs';
import { smokePaths } from './paths.mjs';

const root = process.cwd();
const paths = smokePaths(root);
await mkdir(paths.smokeRoot, { recursive: true });
const logPath = path.join(paths.smokeRoot, 'bootstrap.log');

async function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(message);
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

function runSmoke() {
  const result = spawnSync(process.execPath, ['scripts/smoke/run.mjs', '--headed', '--auto-ux'], {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true
  });
  if (result.error) throw result.error;
  return typeof result.status === 'number' ? result.status : 1;
}

function runNpm(args) {
  const npmExec = process.env.npm_execpath;
  if (npmExec) return runNode([npmExec, ...args], { inherit: true });
  const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return execFileSync(command, args, { cwd: root, stdio: 'inherit', windowsHide: true });
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
  const { chromium } = await import('playwright');
  if (!chromiumInstalled(chromium.executablePath())) {
    await log('正在安装测试专用 Chromium…');
    try {
      runNode(['node_modules/playwright/cli.js', 'install', 'chromium'], { inherit: true });
    } catch {
      throw new Error('PLAYWRIGHT_CHROMIUM_INSTALL_FAILED');
    }
    if (!chromiumInstalled(chromium.executablePath())) throw new Error('PLAYWRIGHT_CHROMIUM_INSTALL_FAILED');
  }
}

let context;
try {
  await log('Session Guard 一键自动测试启动');
  await ensureDependencies();

  const freshProfile = !existsSync(paths.profileDir) || !existsSync(paths.sentinelPath);
  if (freshProfile) await log('首次使用：正在创建隔离测试 Profile。');

  const [{ initializeDedicatedProfile, assertDedicatedProfile }, browser, chatgpt, configModule] = await Promise.all([
    import('./profile-guard.mjs'),
    import('./browser.mjs'),
    import('./chatgpt.mjs'),
    import('./config.mjs')
  ]);

  await initializeDedicatedProfile(root);
  await assertDedicatedProfile(root);
  await log('正在构建当前代码对应的 Debug 扩展…');
  const identity = browser.buildDebugExtension(root);
  await browser.verifyDebugBuild({ distDir: paths.distDir, expectedBuildId: identity.buildId });

  const configResult = await configModule.tryLoadSmokeConfig(root);
  const launched = await browser.launchSmokeBrowser({ root, headed: true });
  context = launched.context;
  if (process.argv.includes('--dry-run')) {
    await log('Dedicated browser bootstrap dry-run verified: Chromium ' + launched.browserVersion);
    await context.close();
    context = undefined;
    process.exit(0);
  }
  const page = await chatgpt.getOrCreateChatPage(context);
  const extensionPage = await chatgpt.openExtensionPage(context, launched.extensionId);
  await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 30_000 });

  let loggedIn = await chatgpt.isLoggedIn(page);
  let boundAccessible = null;
  const hasBinding = configResult.ok;
  let state = freshProfile
    ? BOOTSTRAP_STATES.FIRST_TIME
    : decideBootstrapState({ hasProfile: true, hasSentinel: true, hasBinding, loggedIn });

  if (!loggedIn) {
    state = BOOTSTRAP_STATES.WAIT_LOGIN;
    await log('正在等待 ChatGPT 登录。请只在打开的独立测试浏览器中完成登录。');
    loggedIn = await chatgpt.waitForLogin(page);
    if (!loggedIn) throw new Error('LOGIN_WAIT_TIMEOUT');
    await log('登录已自动检测成功。');
  }

  let smokeConfig = configResult.ok ? configResult.config : null;
  if (smokeConfig) {
    const probe = await chatgpt.probeBoundConversation(page, smokeConfig.longConversationId);
    if (probe.status === 'login-lost') {
      state = BOOTSTRAP_STATES.WAIT_LOGIN;
      if (!(await chatgpt.waitForLogin(page))) throw new Error('LOGIN_WAIT_TIMEOUT');
      const retry = await chatgpt.probeBoundConversation(page, smokeConfig.longConversationId);
      boundAccessible = retry.status === 'ok';
      if (retry.status === 'ui-changed') throw new Error('HARNESS_INCOMPATIBLE: PRODUCT_UI_CHANGED');
    } else if (probe.status === 'ui-changed') {
      throw new Error('HARNESS_INCOMPATIBLE: PRODUCT_UI_CHANGED');
    } else {
      boundAccessible = probe.status === 'ok';
    }
    state = decideBootstrapState({ hasProfile: true, hasSentinel: true, hasBinding: true, loggedIn: true, boundConversationAccessible: boundAccessible });
  }

  if (!smokeConfig || state === BOOTSTRAP_STATES.REBIND || state === BOOTSTRAP_STATES.WAIT_BIND) {
    if (state === BOOTSTRAP_STATES.REBIND) await log('之前绑定的测试会话已无法访问，请重新点开一个超长会话。');
    else await log('现在只需要在测试浏览器中点开一个超长旧会话。');
    if (!page.url().startsWith('https://chatgpt.com')) {
      await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 30_000 });
    }
    const longConversationId = await chatgpt.waitForConversationSelection(page);
    if (!longConversationId) throw new Error('LONG_CONVERSATION_SELECTION_TIMEOUT');
    smokeConfig = await configModule.saveSmokeConfig({ schemaVersion: 1, longConversationId, switchConversationIds: [] }, root);
    await log('超长会话已自动绑定到本地测试配置。');
  }

  await chatgpt.configureUltraLite(extensionPage);
  await chatgpt.showBootstrapStatus(page, '准备完成', '已自动配置：极简模式、1 轮、旧历史仅手动加载。现在开始自动测试，无需手动滚动。');
  await page.waitForTimeout(900);
  await context.close();
  context = undefined;

  await log('开始自动 Scroll Containment Smoke…');
  const smokeExitCode = runSmoke();
  if (smokeExitCode !== 0) process.exitCode = smokeExitCode;
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'NODE_VERSION_UNSUPPORTED') console.error('缺少可用的 Node.js 22+ 环境。请先安装 Node.js 22 或更高版本。');
  else if (message.includes('DEPENDENCY')) console.error('依赖安装失败。详情已写入本地 bootstrap.log。');
  else console.error(`Session Guard 一键测试停止：${message}`);
  await appendFile(logPath, `[${new Date().toISOString()}] ERROR ${message}\n`, 'utf8').catch(() => undefined);
  process.exitCode = 1;
} finally {
  if (context) await context.close().catch(() => undefined);
}
