# Real Browser Benchmark Status

## Known completed baseline

The completed logged-in 50-switch benchmark before Ultra Lite produced:

| Mode | JS Heap | Classification |
|---|---:|---|
| Control | 186.8 → 437.1 MB (+134%) | strong growth |
| Balanced | 331.7 → 315.3 MB | stable |
| Aggressive | 400.3 → 805.5 MB (+101%) | regression |

Interpretation:

- Balanced is the current reliable default direction.
- Aggressive must remain Experimental.
- This result does not justify enabling Session GC / Hard Switch by default.
- The current ChatGPT initial paginated request was observed with `num_turns=10`; Balanced reduced it to 8.

## New validation required

The Ultra Lite/history-rendering change has **not yet been validated in a logged-in real Chrome run**.

The new Standard Validation must run:

```text
Control
Balanced · 8 rounds
Ultra Lite · 1 round
```

Preferred confirmation run:

```text
100 switches / mode
```

A shorter 50-switch regression run remains available.

Success requires at minimum:

1. Control still reproduces the target growth or otherwise provides a usable comparison.
2. Balanced does not regress from the known stable baseline.
3. Ultra Lite is at least as stable as Balanced.
4. Ultra Lite provides a measurable improvement in active DOM, heap, Long Tasks, p95/median switch latency, or another relevant browser-side working-set metric.
5. Tool/Thinking/confirmation/streaming behavior is not broken.

If Ultra Lite is only conceptually smaller but produces no measurable real-browser benefit, it must not be described as “recommended for maximum performance.”

## 1-message validation

`1 message` is the most aggressive user-visible history target and requires a separate real run/Long Conversation Stress sample.

The safety rule is intentionally stronger than the display number:

- settled chat: latest visible message can be the only rendered user/assistant bubble;
- active streaming: the latest whole round is retained;
- tool/thinking descendants within the current assistant are retained;
- confirmation/focus/upload/modal state can expand the window.

Therefore “1 message” means a user-visible history target, not “the entire page must contain one DOM node.”

## Long Conversation Stress

The debug build now runs the current existing long conversation through:

```text
8 rounds → 4 rounds → 2 rounds → 1 round → 1 message
```

It records working-set and responsiveness proxies without generating new conversation content.

This is necessary because the earlier switch benchmark often rendered only a few rounds and therefore could not answer how much a genuinely long current conversation benefits from a 1-round/1-message window.

## Network validation still pending

The new code uses `MIN_SAFE_NETWORK_TURNS=4` for history targets below four.

The previous real run proved `10 → 8`; it did **not** prove `10 → 4`, and it did not validate direct `num_turns=1/2` behavior. The implementation deliberately avoids 1/2 until a compatibility matrix justifies lowering the floor.

## Merge rule

Do not merge `feat/v0.1-session-guard` to `main` until the new Standard Validation + Long Conversation Stress + live compatibility checks are reviewed.

At the moment the correct statement is:

> Balanced is proven stable in the previous real workload. Ultra Lite / 1 round / 1 message are implemented and automatically testable, but their real performance advantage is not yet proven.
