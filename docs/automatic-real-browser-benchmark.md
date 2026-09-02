# Automatic Real Browser Benchmark

The debug build provides one-click real Chrome validation. It does not require manual 50/100-switch navigation or copying Console measurements.

## Standard Validation

Default profile:

```text
Control → Balanced → Ultra Lite
```

Default run length:

```text
100 real conversation switches per mode
```

50 switches remains available as a quicker regression run.

The runner discovers five unique normal `/c/{conversationId}` links from the current ChatGPT sidebar and performs the established A/B/C/D/E sequence automatically. It never reads conversation text.

Each mode receives a fresh page runtime before sample 0. Progress survives reload through `chrome.storage.session`.

### Control

- Network Guard OFF
- DOM Window OFF
- Hard Switch OFF
- benchmark instrumentation ON

### Balanced

The canonical regression baseline is forced to:

```text
mode: balanced
historyUnit: round
historyCount: 8
historyBatchSize: 10
autoLoadHistory: false
Hard Switch: OFF
```

This prevents a user's current popup settings from silently changing the meaning of the Balanced comparison.

### Ultra Lite

```text
mode: ultra-lite
historyUnit: round
historyCount: 1
historyBatchSize: 10
autoLoadHistory: false
DOM engine: Balanced
Hard Switch: OFF
```

Ultra Lite is compared directly against the known Balanced baseline.

## Experimental profile

The Experimental profile runs:

```text
Aggressive
```

Aggressive is deliberately excluded from Standard Validation because the existing real 50-switch benchmark showed a heap regression.

Session GC remains a second-stage diagnostic. It is offered only after a completed Experimental Aggressive result shows stable conversation DOM with strong heap growth.

## Safety

Before and during automatic navigation the runner checks for protected state including:

- streaming / visible Stop button
- confirmation dialog
- permission dialog
- OAuth/authorization flow
- selected upload
- other visible protected modal state

Busy-state pauses automatically. Trusted user pointer/keyboard/wheel activity pauses the switch benchmark rather than competing with the user.

Each route switch waits for:

1. the expected conversation route;
2. a non-busy ChatGPT state;
3. actual conversation rounds;
4. a stable conversation metrics signature for roughly 700 ms.

The runner retries a failed route/stability step within a bounded retry budget. It never uses one long fixed sleep as proof of loading completion.

## Sampling

Samples occur at switch 0 and every 10 switches through 50 or 100.

Each sample includes:

- timestamp
- mode
- switch count
- conversation ID / route
- rendered rounds
- rendered messages
- configured history count/unit
- DOM-budget limiting flag
- conversation DOM
- active conversation DOM
- document DOM
- cleanup count
- hard-switch count
- Network Guard mode
- requested/effective `num_turns`
- JS heap when available
- switch latency
- Long Task count/blocking time when supported

No conversation text is recorded.

## Trend analysis

DOM and heap use a deliberately coarse trend classifier based on the full sample sequence:

- first/last relative growth
- least-squares slope per switch
- fraction of meaningful positive steps

Output:

```text
stable
moderate growth
strong growth
N/A
```

Switch latency uses all successful switches and reports median/p95.

Standard Validation can conclude only:

```text
proven improvement
partial improvement
inconclusive
regression
```

The completed test is not automatically called successful. In particular:

- Control must reproduce sustained growth before retained-memory improvement can be proven.
- JS heap unavailable prevents a strong retained-memory claim.
- Ultra Lite p95 latency materially worse than Balanced can be classified as a regression.
- Balanced and Ultra Lite stable against a growing Control can support `proven improvement`.

## Long Conversation Stress

A separate debug test targets one existing long conversation. It does not create new messages.

The runner stays on the current conversation and automatically tests, with a reload between settings:

```text
8 rounds
4 rounds
2 rounds
1 round
1 message
```

For each setting it records:

- visible messages
- visible rounds
- active conversation DOM
- conversation DOM
- document DOM
- JS heap when available
- Long Tasks/blocking time
- lightweight scroll-work proxy
- lightweight input/event-loop latency proxy
- requested/effective network turns
- DOM-budget limiting

The input/scroll values are proxies, not laboratory Interaction to Next Paint measurements. They are intended only for within-run comparison.

The user's original configuration is restored after completion/failure/stop.

## Network semantics caution

The real baseline verified current ChatGPT `num_turns=10` and Balanced `10 → 8`.

Ultra Lite currently maps 1 round / 1 message to a conservative minimum of 4 network turns. A new real benchmark is still required to prove that this lower target remains compatible with Tool/Thinking/branch/confirmation workflows.

## Renderer memory

Chrome renderer process memory is still optional external evidence. The extension does not request unrelated high-risk permissions or unstable process APIs to collect it automatically.

First-stage automated evidence remains:

```text
JS Heap + DOM + latency + Long Tasks + Network Guard metrics
```

## Current status

The automatic Standard/Experimental profiles and Long Conversation Stress are implemented. A new logged-in run with the Ultra Lite build is still required before Ultra Lite can be described as measurably lighter or more stable than the existing Balanced baseline.
