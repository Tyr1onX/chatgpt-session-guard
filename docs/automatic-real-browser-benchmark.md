# Automatic Real Browser Benchmark

This document describes the debug-only real Chrome benchmark built into ChatGPT Session Guard.

It replaces the earlier manual process that required a user to switch conversations 50/100 times, run Console commands, and copy measurements by hand.

## User flow

1. Run `npm run build:debug`.
2. Load `dist/` as an unpacked Chrome extension.
3. Open a logged-in `https://chatgpt.com/` tab.
4. Ensure the visible sidebar exposes at least five normal `/c/{conversationId}` conversations.
5. Open the extension popup.
6. Choose **50 switches / mode** or **100 switches / mode**.
7. Click **Start Benchmark**.
8. Do not interact with ChatGPT while the benchmark runs.
9. Download JSON and Markdown when complete.

No conversation ID needs to be copied manually.

## Conversation selection

The runner scans existing `<a href>` elements and accepts only routes matching:

```text
/c/{conversationId}
```

It keeps the first five unique conversation IDs exposed by the current ChatGPT sidebar. It never reads message text while selecting conversations.

If fewer than five are available, Start Benchmark returns an explicit error instead of inventing IDs or using unrelated links.

## Navigation sequence

The selected conversations are labeled A, B, C, D, E.

The requested traversal is represented as real route changes:

```text
A → B → C → D → E
E → A → C → B → D
```

A direct E → E step would not change the route, so the implementation uses E as the loop-boundary destination instead of counting a no-op. One internal 10-switch cycle is:

```text
A → B → C → D → E → A → C → B → D → E
```

Before every mode, the runner establishes E as an uncounted baseline route and recreates the page runtime. Therefore the first counted E → A transition is always a real conversation change.

Five cycles produce 50 real switches. Ten cycles produce 100.

## Mode isolation

The mandatory first-stage groups are:

### Control

- Network Guard disabled.
- DOM Rolling Window disabled.
- Hard Switch disabled.
- Benchmark instrumentation remains active.

### Balanced

- Network Guard enabled.
- Balanced DOM Rolling Window enabled.
- Hard Switch disabled.

### Aggressive

- Network Guard enabled.
- Aggressive DOM reclamation enabled.
- Hard Switch disabled.

Each group updates only the extension's local configuration, then establishes the same baseline conversation and performs a full page reload before sample 0.

The user's original configuration is stored in the benchmark session and restored when the benchmark completes, fails, or is stopped.

## Reload recovery

Benchmark progress is stored in `chrome.storage.session` through the extension service worker.

Only temporary benchmark data is stored:

- selected conversation IDs
- current mode and switch index
- numeric performance samples
- errors / status
- original extension configuration needed for restoration

No message content is stored.

If a mode reloads, the next content-script instance reads the benchmark session, validates the expected route, waits for stabilization, and continues automatically.

## Stabilization detection

A switch is not counted immediately after clicking a conversation.

The runner waits for:

1. `location.pathname` to resolve to the expected `/c/{conversationId}`.
2. ChatGPT to be free of protected busy states.
3. At least one conversation round to exist.
4. Conversation metrics (`conversationId`, rounds, conversation DOM and active DOM) to remain unchanged for roughly 700 ms.

This avoids treating unrelated sidebar/header animations as conversation instability while still requiring the actual conversation subtree to reach a stable working set.

The route wait and stabilization wait have explicit timeouts. A failed switch is automatically retried up to two times. After the retry budget is exhausted, that mode ends with the failure recorded in the report.

There is no single long fixed sleep pretending that all conversations load at the same speed.

## Safety pause

The benchmark will not intentionally interrupt ChatGPT work.

It pauses when it detects visible states such as:

- active streaming / Stop button
- confirmation dialog
- permission dialog
- OAuth/authorization flow
- selected file upload
- visible modal interaction

Busy-state pauses automatically resume when ChatGPT becomes safe again.

Trusted user pointer/keyboard activity outside the benchmark panel pauses the benchmark as user intervention. Resume restarts the current mode from a fresh renderer so mixed manual/automatic navigation is not treated as valid benchmark data.

## Automatic samples

Samples are recorded at:

```text
0, 10, 20, 30, 40, 50
```

and for the 100-switch option:

```text
60, 70, 80, 90, 100
```

Each sample contains:

- timestamp
- benchmark mode
- completed switch count
- conversation ID
- current route
- rendered rounds
- conversation DOM nodes
- document DOM nodes
- cleanup count
- hard-switch count
- Network Guard mode
- original/effective `num_turns` when available
- JS heap MB when Chrome exposes `performance.memory`
- last switch stabilization latency
- Long Task count when supported
- accumulated blocking time (`sum(max(0, duration - 50 ms))`) when supported

Chrome renderer-process memory is not collected automatically.

## Growth analysis

The benchmark uses a deliberately coarse classification rather than presenting false statistical precision.

For DOM and heap samples it calculates:

- first/last relative growth
- least-squares slope per switch
- fraction of sampled steps showing a meaningful increase

The output is one of:

```text
stable
moderate growth
strong growth
N/A
```

The thresholds are intentionally conservative and implemented in `src/shared/benchmark.ts`.

Switch latency includes all successful switches, not only the 10-switch snapshots. The report includes median and p95 latency.

## Retained SPA-state diagnostic

If conversation DOM remains `stable` while JS heap is `strong growth`, the benchmark adds:

```text
DOM stable, heap continues growing; likely retained SPA state/cache.
```

This is a diagnostic, not proof of a specific internal React/Query cache implementation.

## Optional Session GC benchmark

The first three modes never enable Hard Switch.

Only when Aggressive produces the retained-SPA diagnostic does the completed UI expose:

```text
Run Session GC Benchmark
```

That second-stage run uses Aggressive DOM handling and performs a controlled full renderer navigation at switch 30, then again at 60 and 90 for a 100-switch run.

The benchmark state survives the reload and continues automatically. Long Task counters are carried across these controlled reload boundaries.

This deliberately tests renderer recreation as a separate variable rather than hiding it inside the primary Aggressive result.

## Export

The completed debug UI provides:

```text
Download JSON
Download Report
```

Files are named:

```text
benchmark-results-YYYYMMDD-HHmm.json
benchmark-report-YYYYMMDD-HHmm.md
```

The Markdown report includes Environment, Control, Balanced, Aggressive, optional Session GC, Comparison, and Preliminary Conclusion sections.

Possible conclusions are limited to:

- `proven improvement`
- `partial improvement`
- `inconclusive`
- `regression`

Finishing the benchmark is never itself evidence of success.
