# Real Chrome / Chromium Smoke Harness

## 最简单的使用方式

Windows：直接双击仓库根目录的 `start-smoke.cmd`。

第一次只需要做两件事：

1. 在自动打开的独立测试 Chromium 中正常登录 ChatGPT。
2. 登录后，在左侧历史记录中点开一个很长、容易出现问题的旧聊天。

程序会自动检测登录、识别 `/c/<conversation-id>`、保存本地绑定、配置 Ultra Lite / 1 round / Manual only，然后立即开始 Scroll Containment Smoke。无需手动滚动、复制会话 ID 或导日志。

以后再次测试只需要再次双击 `start-smoke.cmd`。也可以从终端使用：

```bash
npm run smoke:auto
```

依赖缺失时 Bootstrap 会自动执行 `npm ci`，并且只安装 Playwright Chromium。测试失败或安全中止时会在最新 artifacts 目录生成一个仅包含脱敏证据的 `session-guard-smoke-<run-id>.zip`，终端会直接提示把该 ZIP 发给 GPT。`.csg-smoke/latest-run.txt` 指向最近一次运行目录。

This harness validates ChatGPT Session Guard against the real `chatgpt.com` UI in a dedicated Playwright Chromium profile. It is intentionally local-only and read-only by default.

## Why the browser profile is isolated

The harness never attaches to an existing daily Chrome session. It uses:

```text
.csg-smoke/
  TEST_PROFILE_SENTINEL
  profile/
  config.json
  artifacts/
```

`.csg-smoke/` is gitignored. The runner refuses to start unless the sentinel exists, the profile resolves to `.csg-smoke/profile`, and the path is not a known Chrome / Edge / Chromium `User Data`, `Default`, or numbered daily profile path.

Cookies, Local Storage, IndexedDB and the ChatGPT login session stay inside `.csg-smoke/profile`. They are never exported to a `storageState.json`, GitHub Actions, or the repository.

## Playwright browser choice

Current Playwright extension-testing guidance requires a persistent Chromium context. Google Chrome and Microsoft Edge no longer support the command-line flags Playwright needs to sideload unpacked extensions, so the harness uses the Chromium bundled with Playwright and discovers the MV3 extension id from its service worker.

Install only the required browser once:

```bash
npx playwright install chromium
```

## First-time setup

Run:

```bash
npm run smoke:setup
```

Setup does the following:

1. Creates the dedicated profile and sentinel.
2. Builds the current Debug extension.
3. Starts an isolated headed Playwright Chromium window.
4. Opens `https://chatgpt.com/`.
5. Lets you log in manually once.
6. Lets you open one existing long conversation and captures its `/c/<id>` locally.
7. Optionally captures up to two existing conversations for SPA switching.
8. Saves only those local ids to `.csg-smoke/config.json`.

You never need to copy a conversation id by hand.

## Daily smoke

Default isolated smoke:

```bash
npm run smoke:chrome
```

Isolated headed smoke for UI / scroll / layout release gating:

```bash
npm run smoke:chrome:headed
```

An extended headed alias is also available:

```bash
npm run smoke:chrome:extended
```

The default runner is read-only with respect to the ChatGPT account. It may change Session Guard settings inside the dedicated extension profile, but it does not send messages, create conversations, rename/archive/delete chats, upload files, vote, change account settings, invoke tools, or start voice.

## Smoke coverage

The runner checks:

- Debug extension loading and MV3 service-worker discovery.
- Debug build id versus the current Git working tree.
- Chinese popup UI and Debug-only controls.
- Ultra Lite with one visible round and Manual-only older history.
- DOM versus Session Guard Debug metrics.
- Placeholder/old-turn visibility contradictions.
- Unexpected older-page requests caused by scrolling.
- A bounded upward-scroll sequence (12 attempts by default, hard limit 25).
- Optional `A -> B -> C -> A` SPA switching when two switch conversations were configured during setup.
- Stability Trace collection through the extension runtime.

The current Ultra Lite scroll-leak regression is deliberately a failing target. Do not weaken its assertions to make the smoke green.

## Safety stops

The runner fails fast on:

- HTTP 429: `ABORTED_RATE_LIMIT`
- Classified conversation-history request amplification: `ABORTED_REQUEST_AMPLIFICATION`
- An unexpected ChatGPT conversation write request: `ABORTED_UNEXPECTED_WRITE`
- Lost login: `ABORTED_LOGIN_LOST`
- Extension/profile/build safety failures

It does not retry a 429 storm and does not run an unbounded scroll or navigation loop.

## Evidence and privacy

Each run gets a unique local directory:

```text
.csg-smoke/artifacts/<run-id>/
```

It can contain:

```text
smoke-report.json
smoke-report.md
stability-trace.json
stability-report.md
sanitized-network.json
dom-summary.json
screenshot-failure-masked.png
```

The network file records only timestamps, method, status, sanitized pathname, query-key names, classification, a per-run conversation hash, and duration. It never records request/response bodies, headers, cookies, authorization data, prompts, answers, file bodies, or image bodies.

DOM evidence is structural only: counts, visibility booleans, placeholder state, CSS class counts and scroll metrics. Raw HTML is not saved.

Failure screenshots mask conversation turns, sidebar conversation links, account/profile UI and avatars. Unmasked screenshots are not written by the harness.

## CI policy

Real ChatGPT smoke is **LOCAL ONLY**. GitHub Actions should continue to run unit tests, typecheck, lint, build, sanitizer/config/profile tests and other synthetic checks, but must not receive a ChatGPT profile, cookies, tokens, or real conversation ids.

## Cleaning the test profile

Close any smoke browser and delete:

```text
.csg-smoke/
```

Then run `npm run smoke:setup` again when you want a fresh isolated login.

Deleting `.csg-smoke/` does not touch the normal Chrome profile.
