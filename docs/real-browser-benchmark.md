# Real Chrome Benchmark — v0.1

Status: **PENDING USER-SESSION RUN**

The automated workspace browser cannot access the user's authenticated ChatGPT session and currently stops at the Cloudflare waiting page. The user's already-running Chrome also does not expose a CDP remote-debugging endpoint. No real-browser values below have been fabricated.

## Build used for measurement

Run:

```sh
npm run build:debug
```

Then load `dist/` as an unpacked extension in the real Chrome profile that is already signed in to ChatGPT.

The debug build exposes `window.__CSG_DEBUG__` in the ChatGPT page MAIN world. Production `npm run build` does not expose this helper.

## Workload

Choose five real long conversations A/B/C/D/E, preferably containing a mix of code blocks, Web Search, tool UI, files/images, and long assistant replies.

One loop is:

```text
A → B → C → D → E → A → C → B → D
```

Use enough repetitions to reach 100 conversation navigations. Start each mode from a freshly opened/reloaded ChatGPT renderer.

Test groups:

1. Extension Off
2. Safe
3. Balanced
4. Aggressive

Do not enable Hard Switch until the Soft SPA tests show retained-memory growth with stable DOM.

## Collection cadence

At switch 0, 10, 20, ... 100 record:

- ChatGPT renderer memory from Chrome Task Manager (`Shift+Esc`)
- JS heap from debug helper when available
- conversation DOM nodes
- total document DOM nodes
- rendered rounds
- SPA switch count
- cleanup count
- network mode
- switch latency
- Hard Switch count

For Safe/Balanced/Aggressive run in DevTools Console:

```js
__CSG_DEBUG__.snapshot()
```

After the run:

```js
__CSG_DEBUG__.history()
```

The helper never includes conversation body text.

## Renderer Memory (MB)

| Switch | Off | Safe | Balanced | Aggressive |
|---:|---:|---:|---:|---:|
| 0 | PENDING | PENDING | PENDING | PENDING |
| 10 | PENDING | PENDING | PENDING | PENDING |
| 20 | PENDING | PENDING | PENDING | PENDING |
| 30 | PENDING | PENDING | PENDING | PENDING |
| 40 | PENDING | PENDING | PENDING | PENDING |
| 50 | PENDING | PENDING | PENDING | PENDING |
| 60 | PENDING | PENDING | PENDING | PENDING |
| 70 | PENDING | PENDING | PENDING | PENDING |
| 80 | PENDING | PENDING | PENDING | PENDING |
| 90 | PENDING | PENDING | PENDING | PENDING |
| 100 | PENDING | PENDING | PENDING | PENDING |

## JS Heap (MB)

| Switch | Off | Safe | Balanced | Aggressive |
|---:|---:|---:|---:|---:|
| 0 | PENDING | PENDING | PENDING | PENDING |
| 10 | PENDING | PENDING | PENDING | PENDING |
| 20 | PENDING | PENDING | PENDING | PENDING |
| 30 | PENDING | PENDING | PENDING | PENDING |
| 40 | PENDING | PENDING | PENDING | PENDING |
| 50 | PENDING | PENDING | PENDING | PENDING |
| 60 | PENDING | PENDING | PENDING | PENDING |
| 70 | PENDING | PENDING | PENDING | PENDING |
| 80 | PENDING | PENDING | PENDING | PENDING |
| 90 | PENDING | PENDING | PENDING | PENDING |
| 100 | PENDING | PENDING | PENDING | PENDING |

## Conversation DOM Nodes

| Switch | Off | Safe | Balanced | Aggressive |
|---:|---:|---:|---:|---:|
| 0 | PENDING | PENDING | PENDING | PENDING |
| 10 | PENDING | PENDING | PENDING | PENDING |
| 20 | PENDING | PENDING | PENDING | PENDING |
| 30 | PENDING | PENDING | PENDING | PENDING |
| 40 | PENDING | PENDING | PENDING | PENDING |
| 50 | PENDING | PENDING | PENDING | PENDING |
| 60 | PENDING | PENDING | PENDING | PENDING |
| 70 | PENDING | PENDING | PENDING | PENDING |
| 80 | PENDING | PENDING | PENDING | PENDING |
| 90 | PENDING | PENDING | PENDING | PENDING |
| 100 | PENDING | PENDING | PENDING | PENDING |

## Document DOM Nodes

| Switch | Off | Safe | Balanced | Aggressive |
|---:|---:|---:|---:|---:|
| 0 | PENDING | PENDING | PENDING | PENDING |
| 10 | PENDING | PENDING | PENDING | PENDING |
| 20 | PENDING | PENDING | PENDING | PENDING |
| 30 | PENDING | PENDING | PENDING | PENDING |
| 40 | PENDING | PENDING | PENDING | PENDING |
| 50 | PENDING | PENDING | PENDING | PENDING |
| 60 | PENDING | PENDING | PENDING | PENDING |
| 70 | PENDING | PENDING | PENDING | PENDING |
| 80 | PENDING | PENDING | PENDING | PENDING |
| 90 | PENDING | PENDING | PENDING | PENDING |
| 100 | PENDING | PENDING | PENDING | PENDING |

## Switch Latency (ms)

| Switch | Off | Safe | Balanced | Aggressive |
|---:|---:|---:|---:|---:|
| 0 | N/A | N/A | N/A | N/A |
| 10 | PENDING | PENDING | PENDING | PENDING |
| 20 | PENDING | PENDING | PENDING | PENDING |
| 30 | PENDING | PENDING | PENDING | PENDING |
| 40 | PENDING | PENDING | PENDING | PENDING |
| 50 | PENDING | PENDING | PENDING | PENDING |
| 60 | PENDING | PENDING | PENDING | PENDING |
| 70 | PENDING | PENDING | PENDING | PENDING |
| 80 | PENDING | PENDING | PENDING | PENDING |
| 90 | PENDING | PENDING | PENDING | PENDING |
| 100 | PENDING | PENDING | PENDING | PENDING |

## Interpretation rules

- Balanced may reduce layout/paint cost while retaining DOM/React state. If memory still rises, record: `Balanced improves rendering cost but does not solve retained-memory growth.`
- If Aggressive stabilizes DOM and renderer memory without breaking ChatGPT UI, evaluate a conservative Balanced+ reclamation policy rather than making current Aggressive unconditional default.
- If DOM remains stable while renderer memory/heap rises monotonically, classify the dominant issue as SPA retained state/cache rather than DOM growth.
- Only test Hard Switch after that pattern is demonstrated.
- Hard Switch is considered effective only if a safe reload returns renderer memory close to a fresh baseline and does not interrupt confirmation/upload/generation state.

## Compatibility matrix

| Feature | Off | Safe | Balanced | Aggressive | Notes |
|---|---|---|---|---|---|
| Normal chat | PENDING | PENDING | PENDING | PENDING | |
| Code block | PENDING | PENDING | PENDING | PENDING | |
| Web Search | PENDING | PENDING | PENDING | PENDING | |
| Thinking | PENDING | PENDING | PENDING | PENDING | |
| Image | PENDING | PENDING | PENDING | PENDING | |
| File | PENDING | PENDING | PENDING | PENDING | |
| Writing Block | PENDING | PENDING | PENDING | PENDING | |
| GitHub connector | PENDING | PENDING | PENDING | PENDING | |
| Google Drive connector | PENDING | PENDING | PENDING | PENDING | High priority |
| Confirmation dialog | PENDING | PENDING | PENDING | PENDING | High priority |
| Regenerate | PENDING | PENDING | PENDING | PENDING | |
| Edit message | PENDING | PENDING | PENDING | PENDING | |
| Branch conversation | PENDING | PENDING | PENDING | PENDING | High priority |
| Switch while generating | PENDING | PENDING | PENDING | PENDING | |
| Return to generating chat | PENDING | PENDING | PENDING | PENDING | |

## Final verdict

**Not yet proven.** Do not merge to `main` until the real authenticated Chrome run provides evidence that memory growth is materially bounded, or that controlled Session GC reliably restores the renderer near baseline without breaking core ChatGPT behavior.
