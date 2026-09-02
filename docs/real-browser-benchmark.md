# Real Browser Benchmark Status

## Final v0.1.0 Standard Validation

A real logged-in Chrome Standard Validation completed on five real ChatGPT conversations with 100 switches per mode.

| Mode | JS Heap | Median switch | p95 switch | Classification |
|---|---:|---:|---:|---|
| Control | 260.3 → 597.4 MB (+129.5%) | 1206.5 ms | 1531.4 ms | strong growth |
| Balanced | 705.0 → 496.7 MB | 1197.0 ms | 1584.3 ms | stable |
| Ultra Lite · 1 round | 618.8 → 327.9 MB | 1011.3 ms | 1281.1 ms | stable |

Ultra Lite also ran with the current ChatGPT initial history request reduced from `num_turns=10` to `4`.

The automatic benchmark conclusion was:

```text
proven improvement
```

Interpretation for the tested multi-conversation switching workload:

- Control reproduced sustained retained JS-heap growth.
- Balanced remained stable.
- Ultra Lite · 1 round remained stable.
- Ultra Lite used a smaller active conversation DOM working set than Balanced.
- Ultra Lite improved median and p95 switch latency in this run.
- Long-task pressure was lower in the observed Ultra Lite run.

These results are browser-side evidence for this workload. They are not a guarantee of lower total renderer-process RAM, elimination of crashes, or future compatibility with ChatGPT internals.

## Long Conversation Stress

A real Long Conversation Stress run on one existing long conversation produced:

| History target | Active DOM | Network target when ChatGPT requested 10 |
|---|---:|---:|
| 8 rounds | 393 | 8 |
| 4 rounds | 319 | 4 |
| 2 rounds | 319 | 4 |
| 1 round | 70 | 4 |
| 1 message | 40 | 4 |

This confirms that `1 round` substantially reduces the active DOM working set in the tested long conversation. `1 message` reduced it further, but remains an Extreme user-selected setting rather than the recommended default.

Recommended maximum-performance setting remains:

```text
Mode: Ultra Lite
Visible history: 1 round
Older history: Manual only
Batch: 10
Network Guard: ON
MIN_SAFE_NETWORK_TURNS: 4
DOM strategy: Balanced
Aggressive: OFF
Hard Switch: OFF
```

Balanced remains the more conservative default.

## Real Compatibility Smoke

Ultra Lite · 1 round passed a real logged-in Chrome compatibility smoke for the core workflows required for v0.1.0:

- ordinary message submission and assistant streaming
- Thinking UI during generation and complete final response
- Web Search with citations/source UI
- long code block rendering
- PDF/file upload and reading
- image upload and vision response
- Load Previous 10 with current-conversation-only expansion
- Temporary Full History and Restore Lightweight Mode
- switching across multiple conversations without expansion leakage

No blocker was observed in those workflows.

The following were not reliably reproduced in the final manual smoke and therefore are not claimed as PASS:

- Confirmation / Permission UI — **NOT REPRODUCED**
- Branch Conversation — **NOT REPRODUCED**

Automatic safety tests cover protected interaction and branch-preservation logic where applicable, but those tests do not replace a manual PASS claim.

## 1-message status

The `1 message` history target is implemented with a stronger internal safety window than its visible count suggests:

- settled chat can show only the latest visible message;
- active streaming retains the latest complete active round;
- Tool/Thinking descendants of the active assistant remain intact;
- confirmation/focus/upload/modal states can temporarily widen the retained window.

The real Long Conversation Stress demonstrated the smaller active DOM working set, but v0.1.0 still treats `1 message` as Extreme / user-selected rather than the default recommendation.

## Network status

The release keeps:

```text
MIN_SAFE_NETWORK_TURNS = 4
```

The real Ultra Lite benchmark and core smoke exercised `10 → 4` successfully across ordinary streaming, Thinking, Web Search, file upload, and image upload. This is evidence for the tested workflows, not an official statement about ChatGPT's private API semantics.

Session Guard intentionally does not lower the floor to 1 or 2.

## Release interpretation

The appropriate v0.1.0 claim is:

> Ultra Lite demonstrated a proven improvement in a real logged-in Chrome benchmark for the tested multi-conversation switching workload.

Do not generalize this into claims that Session Guard fixes all ChatGPT memory leaks, guarantees lower total RAM usage, eliminates crashes, or guarantees compatibility with future ChatGPT versions.

Known boundaries:

- renderer-process memory was not directly collected;
- JS heap is a browser-side memory proxy;
- ChatGPT internal endpoints and DOM are private implementation details and can change;
- recognized but unknown/malformed history response schemas fail open;
- Confirmation / Permission and Branch Conversation were not reliably reproduced in the final manual compatibility smoke.
