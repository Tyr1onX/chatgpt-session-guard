# ChatGPT Session Guard

**ChatGPT Session Guard is designed for people who use ChatGPT as a working state rather than a chat-history reader.**

It reduces the browser-side history working set for people who leave ChatGPT Web open all day and repeatedly move among long-running conversations. The full conversation remains on ChatGPT's servers. Session Guard changes only what the browser requests/renders locally.

> Showing less history is not deleting history.

## Current evidence

The first real logged-in Chrome benchmark established an important baseline:

| Mode | 50-switch JS Heap | Result |
|---|---:|---|
| Control | 186.8 → 437.1 MB (+134%) | strong growth |
| Balanced | 331.7 → 315.3 MB | stable |
| Aggressive | 400.3 → 805.5 MB (+101%) | regression |

Therefore **Balanced remains the default**. Aggressive remains Experimental and is not part of the normal recommendation path.

The same real run confirmed the current paginated ChatGPT request uses `num_turns=10`, and the previous Balanced configuration reduced it to `8`.

**Ultra Lite has not yet been proven by a new real logged-in benchmark.** The debug benchmark now exists specifically to compare it against the known Balanced baseline.

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

The configured count is a presentation target, not a promise that the entire page contains only that many DOM nodes. The safety window can temporarily retain extra active nodes for streaming, tool UI, confirmation dialogs, focused controls, or other live interactions. The DOM budget may also reduce an expensive configured window.

## Ultra Lite

Ultra Lite is not a new deletion algorithm. It is the existing Balanced engine with a much smaller browser history working set.

Default Ultra Lite preset:

```text
Visible history:       1 round
Older history:         Manual only
History batch:         10
Network Guard:         ON
DOM engine:            Balanced
Aggressive removal:    OFF
Hard Switch:           OFF
DOM budget:            7000 (unchanged until real data justifies lowering it)
```

**Ultra Lite can keep only the latest message or latest round visible while the full conversation remains on ChatGPT's servers.** Select Ultra Lite, then change Visible history to `1 message` if that is the desired working style.

## Network Guard

For the current paginated endpoint:

```text
GET /backend-api/conversations/{conversationId}?num_turns=N
```

Session Guard lowers an already-present valid `num_turns`; it never increases ChatGPT's request and never modifies POST/stream/tool/upload/confirmation traffic.

Because low `num_turns` semantics are not publicly documented for Tool/Thinking/Branch conversations, v0.1 currently uses:

```text
MIN_SAFE_NETWORK_TURNS = 4
```

Examples when ChatGPT requests 10:

```text
Balanced 8 rounds  → 10 → 8
Ultra Lite 1 round → 10 → 4
1 visible message  → 10 → 4
```

`num_turns=1/2/4` have **not** all been validated in a real logged-in compatibility matrix. The floor of 4 is deliberately conservative until that validation exists.

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
- **Balanced** — current recommended default; hides old settled turn roots without deleting descendants.
- **Ultra Lite** — Balanced engine + very small history target + manual older history.
- **Aggressive · Experimental** — removes old settled descendants. Real benchmark currently shows a regression, so it is not recommended as default.

Hard Switch / Session GC remains off by default.

## Automatic real-browser validation

The debug build now has benchmark profiles:

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

See [`docs/automatic-real-browser-benchmark.md`](docs/automatic-real-browser-benchmark.md).

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

The previous real benchmark proves that the original Balanced 8-round configuration can avoid the Control heap growth observed in that workload. It does **not** yet prove that Ultra Lite, 1 round, or 1 message is lighter or more stable.

The feature branch must not be merged to `main` until a new logged-in real-browser Standard Validation and Long Conversation Stress run confirm that Ultra Lite provides a measurable benefit without breaking Tool/Thinking/confirmation/streaming behavior.
