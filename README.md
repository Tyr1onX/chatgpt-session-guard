# ChatGPT Session Guard

**ChatGPT Session Guard is designed for people who use ChatGPT as a working state rather than a chat-history reader.**

It reduces the browser-side history working set for people who leave ChatGPT Web open all day and repeatedly move among long-running conversations. The full conversation remains on ChatGPT's servers. Session Guard changes only what the browser requests/renders locally.

> Showing less history is not deleting history.

## Current evidence

Ultra Lite demonstrated a **proven improvement in a real logged-in Chrome benchmark for the tested multi-conversation switching workload**.

The Standard Validation used five real conversations and 100 switches per mode:

| Mode | JS Heap | Median switch | p95 switch | Result |
|---|---:|---:|---:|---|
| Control | 260.3 → 597.4 MB (+129.5%) | 1206.5 ms | 1531.4 ms | strong growth |
| Balanced | 705.0 → 496.7 MB | 1197.0 ms | 1584.3 ms | stable |
| Ultra Lite · 1 round | 618.8 → 327.9 MB | 1011.3 ms | 1281.1 ms | stable / proven improvement |

For Ultra Lite, the current ChatGPT initial history request was observed at `num_turns=10` and Session Guard reduced it to `4`. Its active conversation DOM working set was also substantially smaller than Balanced in the tested workload.

A real Long Conversation Stress run on one existing conversation recorded:

| History target | Active DOM |
|---|---:|
| 8 rounds | 393 |
| 4 rounds | 319 |
| 2 rounds | 319 |
| 1 round | 70 |
| 1 message | 40 |

These measurements support **Ultra Lite · 1 round** as the recommended maximum-performance configuration for this tested workload. **Balanced remains the more conservative default.** `1 message` remains an Extreme, user-selected option rather than the default.

These results do **not** mean Session Guard fixes every ChatGPT memory leak or guarantees lower total RAM usage. JS heap is browser-side evidence, not total renderer-process memory, and ChatGPT's internal APIs/DOM can change.

## Compatibility smoke

Ultra Lite · 1 round was also exercised in a real logged-in Chrome + ChatGPT session with no known blocker in the tested core workflows:

- ordinary messages and streaming
- Thinking UI and final response
- Web Search with citations/source UI
- long code block rendering
- PDF/file upload and reading
- image upload and vision response
- Load Previous 10 with conversation-local expansion
- Temporary Full History and Restore Lightweight Mode
- switching among multiple conversations without expansion leakage

Confirmation / Permission and Branch Conversation were not reliably reproduced in the final manual smoke. They are therefore **not claimed as manually verified**, although automatic safety tests cover protected interaction and branch-preservation logic where applicable.

## History rendering

History can be configured by visible **messages** or **rounds**:

- 1 message
- 1 round
- 2 rounds
- 4 rounds
- 8 rounds
- 16 rounds
- Custom: 1–50 messages or rounds

A **message** is a visible top-level user or assistant message bubble. Tool/thinking/internal descendants are not counted as separate user-visible messages.

A **round** begins with a user turn and includes its following assistant response set. Tool/thinking/internal nodes do not create artificial rounds.

The configured count is a presentation target, not a promise that the entire page contains only that many DOM nodes. The safety window can temporarily retain extra active nodes for streaming, tool UI, confirmation dialogs, focused controls, or other live interactions. The DOM budget may also reduce an expensive configured window, but it never splits the final required history unit just to hit a node target.

## Ultra Lite

Ultra Lite is not a new deletion algorithm. It is the existing Balanced engine with a much smaller browser history working set.

Recommended for maximum performance:

```text
Mode:                   Ultra Lite
Visible history:        1 round
Older history:          Manual only
History batch:          10
Network Guard:          ON
MIN_SAFE_NETWORK_TURNS: 4
DOM engine:             Balanced
Aggressive removal:     OFF
Hard Switch:            OFF
```

**Ultra Lite can keep only the latest message or latest round visible while the full conversation remains on ChatGPT's servers.** Select Ultra Lite, then change Visible history to `1 message` only if the Extreme working style is desired.

## Network Guard

For the current paginated endpoint:

```text
GET /backend-api/conversations/{conversationId}?num_turns=N
```

Session Guard lowers an already-present valid `num_turns`; it never increases ChatGPT's request and never intentionally modifies POST/stream/tool/upload/confirmation traffic.

Because low `num_turns` semantics are private/unsupported ChatGPT implementation details, v0.1 keeps a conservative floor:

```text
MIN_SAFE_NETWORK_TURNS = 4
```

Examples when ChatGPT requests 10:

```text
Balanced 8 rounds  → 10 → 8
Ultra Lite 1 round → 10 → 4
1 visible message  → 10 → 4
```

`10 → 4` was exercised successfully in the real Ultra Lite performance run and core compatibility smoke, including ordinary streaming, Thinking, Web Search, file upload, and image upload. This is evidence for the tested workflows, not an official guarantee that `num_turns=4` is universally safe for every future ChatGPT feature. Session Guard does not lower the floor to 1 or 2.

When **Older history = Manual only**, validated cursor-page responses are prevented from automatically feeding old message payloads back into the browser working set. Unknown response schemas fail open unchanged.

## Older history

By default, older history is Manual only.

The lightweight boundary offers:

```text
Load previous 10
Temporary Full History
```

`Load previous N` temporarily expands only the current conversation. The expansion is stored in `chrome.storage.session`, not as the user's permanent default, and a safe reload lets ChatGPT reconstruct the conversation itself. Switching conversations clears that temporary expansion.

ChatGPT controls the raw pagination shape, so the batch is a browser history target rather than a guarantee that an internal API page contains exactly N raw nodes. Tool/thinking dependencies are never sliced from an unknown raw page shape.

**Temporary Full History** temporarily disables both Network Guard history limiting and DOM history limiting, then reloads the current conversation. **Restore Lightweight Mode** clears temporary expansion, restores the saved configuration, and reloads again. If ChatGPT is streaming or a protected interaction is active, Session Guard refuses to reload.

## Modes

- **Safe** — keeps old DOM attached with `content-visibility`.
- **Balanced** — conservative default; hides old settled turn roots without deleting descendants.
- **Ultra Lite** — Balanced engine + very small history target + manual older history; recommended for maximum performance in the tested workload.
- **Aggressive · Experimental** — removes old settled descendants. The real benchmark showed a regression, so it is not recommended as default.

Hard Switch / Session GC remains off by default.

## Automatic real-browser validation

The debug build has benchmark profiles:

### Standard Validation

```text
Control → Balanced → Ultra Lite
```

Default: **100 switches per mode**. It records DOM working set, JS heap when available, median/p95 switch latency, Long Tasks, cleanup count, Network Guard turn limits, and history-window metrics.

### Experimental

```text
Aggressive
```

Aggressive and Session GC are kept out of Standard Validation so they do not contaminate the normal comparison.

### Long Conversation Stress

Run this on one existing long conversation. It automatically reloads and samples:

```text
8 rounds → 4 rounds → 2 rounds → 1 round → 1 message
```

It records visible messages/rounds, active/conversation/document DOM, JS heap, Long Tasks, a lightweight scroll-work proxy, input-latency proxy, DOM-budget limiting, and Network Guard turns. It does not create new messages or read/store chat text.

See [`docs/automatic-real-browser-benchmark.md`](docs/automatic-real-browser-benchmark.md) and [`docs/real-browser-benchmark.md`](docs/real-browser-benchmark.md).

## Privacy and permissions

ChatGPT Session Guard is local-only:

- no analytics or telemetry
- no remote server
- no external API
- no conversation text stored/exported
- benchmark/session state contains IDs/routes and numeric counters only

> ChatGPT Session Guard never sends or stores conversation content.

Permissions remain intentionally small:

```text
permissions:
  storage

host_permissions:
  https://chatgpt.com/*
```

The background service worker exists only to hold temporary `chrome.storage.session` state such as manual history expansion and debug benchmark progress. The extension does not request `history`, `cookies`, `downloads`, `webRequest`, `clipboard`, `tabs`, or `activeTab`.

## Build

```text
npm install
npm test
npm run lint
npm run typecheck
npm run build
npm audit
```

Debug build:

```text
npm run build:debug
```

Both write the unpacked extension to `dist/`. The benchmark UI is debug-only; history configuration and temporary session storage are part of the normal build.

## v0.1 validation status

v0.1.0 has passed the tested release gates:

- real logged-in Chrome Standard Validation: **proven improvement**
- real Long Conversation Stress: 1 round and 1 message both reduced the active DOM working set
- Ultra Lite · 1 round core Compatibility Smoke: **PASS**
- automatic unit/regression tests, TypeScript strict, ESLint, production/debug builds, npm audit, and production-bundle audit: **PASS**

Known limitations remain:

- renderer-process memory was not directly collected; JS heap is the primary browser-side memory proxy used by the automatic benchmark;
- Confirmation / Permission and Branch Conversation were not reliably reproduced in the final manual smoke;
- ChatGPT internal endpoints and DOM are private implementation details and may change;
- unknown or malformed recognized history schemas fail open rather than being force-modified;
- results apply to the tested workload and are not a guarantee of future ChatGPT behavior, lower total RAM usage, or elimination of crashes.
