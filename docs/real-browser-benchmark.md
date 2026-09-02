# Real Browser Benchmark Status

## Status

**PENDING REAL RUN**

The automatic benchmark harness is implemented, but no logged-in real Chrome benchmark result is committed here yet.

This file must not be treated as performance proof until a generated JSON/Markdown report from the debug build has been reviewed.

## Required run

Use the one-click workflow in [`automatic-real-browser-benchmark.md`](automatic-real-browser-benchmark.md):

```text
npm run build:debug
Load dist/
Open logged-in ChatGPT
Start Benchmark
Download results
```

The default benchmark performs 50 real SPA conversation switches per mode. The extended option performs 100.

Mandatory modes:

1. Control
2. Balanced
3. Aggressive

Hard Switch is OFF for all three.

If Aggressive reports stable conversation DOM but strong heap growth, run the optional Session GC benchmark separately.

## Automatic sample schedule

For 50 switches:

| Switch | Control | Balanced | Aggressive |
|---:|---|---|---|
| 0 | PENDING | PENDING | PENDING |
| 10 | PENDING | PENDING | PENDING |
| 20 | PENDING | PENDING | PENDING |
| 30 | PENDING | PENDING | PENDING |
| 40 | PENDING | PENDING | PENDING |
| 50 | PENDING | PENDING | PENDING |

For 100 switches, samples at 60/70/80/90/100 are added automatically.

Each generated sample includes numeric values for:

- conversation DOM nodes
- total document DOM nodes
- rendered rounds
- cleanup count
- hard-switch count
- Network Guard mode and requested/effective turns
- JS heap when available
- switch latency
- Long Task count/blocking time when supported
- route/conversation ID used for benchmark coordination

No conversation text is included.

## Analysis rules

The generated report performs trend analysis over the full sampled series instead of comparing only switch 0 with the final switch.

Each DOM/heap series is classified as:

```text
stable
moderate growth
strong growth
N/A
```

The report also calculates median and p95 switch latency from all successful switches.

A specific diagnostic is emitted when:

```text
conversation DOM = stable
JS Heap = strong growth
```

as:

```text
DOM stable, heap continues growing; likely retained SPA state/cache.
```

This condition recommends the separate Session GC benchmark.

## Success criteria

A generated benchmark may conclude:

### proven improvement

The Control group reproduces sustained growth and an optimized strategy reaches a stable working set without a severe switch-latency regression, or a separately tested Session GC strategy converts retained heap growth into a stable working set.

### partial improvement

An optimized strategy improves the observed growth class but does not fully stabilize the working set.

### inconclusive

Examples:

- Control does not reproduce the target growth.
- a mode fails navigation/stabilization repeatedly
- JS heap is unavailable and DOM/latency data is insufficient
- optimized groups do not clearly separate from Control

### regression

An optimization mode produces a worse growth class or a severe latency regression relative to a stable Control.

## Renderer process memory

Chrome Task Manager renderer-process memory is intentionally not part of the required automated benchmark because the extension does not request unrelated high-risk permissions or depend on unstable process APIs.

It can be supplied as optional external evidence later, but the first-stage benchmark is intentionally based on JS Heap + DOM + switch latency + Long Tasks.

## Rule for merging v0.1

Do not merge `feat/v0.1-session-guard` into `main` solely because the automated harness exists or completes.

A real logged-in benchmark must first provide evidence that the target workload materially improves without breaking core ChatGPT behavior.
