# Real Chrome Smoke Harness

## 最简单的使用方式

Windows：直接双击仓库根目录的 `start-smoke.cmd`。

第一次只需要：

1. 在自动打开的 **Session Guard 专用 Google Chrome** 中正常完成 Google → ChatGPT 登录；登录成功后关闭这个专用 Chrome。
2. 随后程序会重新打开专用测试 Chrome；在左侧历史记录中点开一个很长、容易出现问题的旧聊天。

之后全部自动：

```text
构建当前 Debug 扩展
→ 验证 dedicated Chrome Profile
→ localhost CDP
→ 自动加载 dist/ Debug extension
→ 验证 Build ID
→ Ultra Lite / 1 round / Manual only
→ 自动 Scroll Containment Smoke
→ 输出脱敏证据
```

以后再次测试只需再次双击 `start-smoke.cmd`。

终端等价入口：

```bash
npm run smoke:auto
```

## 为什么认证和自动测试分开

Google OAuth 首次认证不能依赖 Playwright Chromium。首次认证阶段使用机器上正常安装的 branded Google Chrome，并使用独立目录：

```text
.csg-smoke/chrome-profile/
```

认证阶段：

- 不启用 Playwright 控制；
- 不启用 CDP；
- 不使用 `--enable-automation`；
- 不读取或复制 daily Chrome Cookie；
- 不自动填写 Google 密码或 2FA；
- 用户只在这个独立 Chrome 中正常完成认证。

登录完成并关闭认证 Chrome 后，Harness 再使用同一个 dedicated profile 进入自动测试阶段。因此 ChatGPT 登录态天然保留，不需要导出 `cookies.json`、`storageState.json`、Token 或 Google Account session。

## Dedicated Chrome Profile

真实认证与 Real Chrome Smoke 使用：

```text
.csg-smoke/
  CHROME_PROFILE_SENTINEL
  chrome-profile/
  config.json
  artifacts/
  latest-run.txt
```

`.csg-smoke/` 整体 gitignored。

Profile Guard 会拒绝：

- 用户日常 Chrome `User Data`；
- `Default`；
- `Profile N`；
- Edge / Chromium 日常 Profile；
- 缺少 `CHROME_PROFILE_SENTINEL` 的目录；
- 不在 `.csg-smoke/` 下的路径。

Harness 不 attach、关闭、重启或修改 daily Chrome。

## Chrome 136+ 与 localhost CDP

自动测试阶段使用 branded Chrome + CDP，但始终配合独立 `--user-data-dir=.csg-smoke/chrome-profile`。

Harness 自己在 `127.0.0.1` 申请一个随机空闲端口，然后显式启动：

```text
--remote-debugging-address=127.0.0.1
--remote-debugging-port=<random-local-port>
--user-data-dir=<dedicated chrome-profile>
```

CDP 地址只允许：

```text
127.0.0.1
localhost
::1
```

`0.0.0.0`、LAN 地址和外部地址会被拒绝。

Harness 只关闭自己启动并持有 PID 的 dedicated Chrome，不使用 `taskkill chrome.exe` 之类的全局操作。

## Debug extension 如何加载

branded Chrome 不再依赖 `--load-extension`。

每次 Real Chrome Smoke：

1. 执行当前源码的 `build:debug`；
2. 连接 dedicated Chrome 的 localhost CDP；
3. 调用 Chrome DevTools Protocol `Extensions.loadUnpacked`，路径严格为仓库当前 `dist/`；
4. 调用 `Extensions.getExtensions` 确认：
   - extension ID 有效；
   - extension enabled；
   - 实际加载路径就是当前 `dist/`；
5. 从实际已加载扩展自身读取 `content.js`，确认其中包含本次预期 Build ID；
6. Build ID 不一致则拒绝继续 Smoke。

因此不需要用户手工 `Load unpacked`，也不会把整个 Chrome Profile 复制到 Playwright Chromium。

## Auth Gate

开发验证命令：

```bash
node scripts/smoke/auth-probe.mjs --launch-auth
node scripts/smoke/auth-probe.mjs --verify
```

只有真实 `--verify` 得到：

```text
CHATGPT_SESSION_ESTABLISHED
loggedIn = true
```

才能记录 Real Google / ChatGPT Login PASS。

Google unsafe-browser 已有独立分类：

```text
GOOGLE_OAUTH_UNSAFE_BROWSER
```

Auth detection 不保存 Google 页面 HTML、账号邮箱、Account chooser、密码字段、2FA 内容或 Google screenshot。

## 长会话绑定

若 `.csg-smoke/config.json` 尚未保存 `longConversationId`，Harness 会打开已登录的 dedicated Chrome 并提示：

```text
请在左侧历史记录中点开一个很长、容易出现问题的旧聊天。
```

用户只需点一次。

Harness 自动识别 `/c/<conversation-id>`，conversation ID 只保存在本机 gitignored 的 `.csg-smoke/config.json` 中，不写 GitHub log、CI、issue 或 support ZIP。

## Smoke coverage

Real Chrome runner 检查：

- branded Chrome / CDP 启动；
- Debug extension 自动加载；
- loaded extension Build ID；
- 中文 popup；
- Ultra Lite；
- Visible history = 1 round；
- Older history = Manual only；
- DOM vs Session Guard Debug metrics；
- placeholder / old-turn visibility contradiction；
- 滚动过程中意外 older-page request；
- 默认 12 次、有硬上限 25 次的 bounded scroll；
- Stability Trace；
- 配置了样本时的 SPA switching。

当前 Ultra Lite scroll leak 是故意保留的真实回归目标。不要为了让 Smoke 变绿修改断言。

关键失败码包括：

```text
VISIBLE_HISTORY_BOUNDARY_EXCEEDED
PLACEHOLDER_VISIBILITY_CONTRADICTION
METRICS_DOM_DIVERGENCE
UNEXPECTED_OLDER_PAGE_NETWORK_REQUEST
```

## Safety stops

立即停止：

```text
ABORTED_RATE_LIMIT
ABORTED_REQUEST_AMPLIFICATION
ABORTED_UNEXPECTED_WRITE
ABORTED_LOGIN_LOST
```

检测到 HTTP 429 / Too many requests 后不会自动重试。

## Evidence and privacy

每次运行写入：

```text
.csg-smoke/artifacts/<run-id>/
```

可能包含：

```text
smoke-report.json
smoke-report.md
stability-trace.json
stability-report.md
sanitized-network.json
dom-summary.json
screenshot-failure-masked.png
```

FAIL / ABORTED 时可生成：

```text
session-guard-smoke-<run-id>.zip
```

ZIP 采用 allowlist，绝不包含：

- `chrome-profile/`；
- Cookies；
- Login Data；
- Local Storage；
- IndexedDB；
- Google Account session；
- Token；
- raw HAR；
- raw HTML；
- conversation text。

网络证据只记录脱敏路径、method、status、query key、classification、per-run conversation hash 和 duration，不记录 headers/body/cookie/authorization。

## CI policy

真实 Google / ChatGPT / Chrome Smoke 仅在本机运行。

GitHub Actions 只应运行：

- typecheck；
- lint；
- unit tests；
- build；
- Debug build；
- sanitizer / Profile Guard / Auth state machine 测试；
- audit。

CI 不接收真实 ChatGPT profile、Cookie、Token、Google session 或 conversation ID。

## 清理 dedicated 环境

关闭 Session Guard 专用 Chrome 后删除：

```text
.csg-smoke/
```

即可从零开始。

删除 `.csg-smoke/` 不会修改用户日常 Chrome Profile。
