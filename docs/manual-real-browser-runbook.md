# Manual Real-Browser Validation Runbook

Use this only in the real Chrome profile that is already signed in to `https://chatgpt.com`.

## 1. Build and load the debug extension

```sh
npm run build:debug
```

Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select this repository's `dist/` folder.

Open ChatGPT, then DevTools Console. Confirm:

```js
typeof __CSG_DEBUG__
```

Expected in debug build: `"object"`.

Production `npm run build` intentionally removes this helper.

## 2. Prepare five conversations

Assign five real long conversations to A/B/C/D/E. Keep the same five conversations for every mode.

Prefer conversations that collectively cover:

- long Markdown/text
- large code blocks
- Web Search
- Thinking
- Tool UI
- image/file UI
- Writing Block
- GitHub connector
- Google Drive connector / confirmation if available

Do not copy titles or message content into benchmark files. Keep A/B/C/D/E only.

## 3. Chrome Task Manager

Open Chrome Task Manager with `Shift+Esc` and identify the ChatGPT renderer row. At each sample point record its memory footprint in MB.

Do not add extension permissions just to automate renderer-memory collection.

## 4. Extension Off baseline

Disable ChatGPT Session Guard from `chrome://extensions` (not merely the popup switch), close the old ChatGPT tab, then open one fresh ChatGPT tab.

Paste the contents of `docs/off-baseline-console-helper.txt` into DevTools Console.

At switch 0 record:

```js
__CSG_BASELINE__.snapshot()
```

Before a switch whose latency you want to sample, run:

```js
__CSG_BASELINE__.measureNextSwitch().then(console.log)
```

Then immediately click the target conversation.

Run the fixed sequence until 100 conversation navigations are reached. At 10, 20, ... 100 run `snapshot()` and record the matching renderer memory from Task Manager.

## 5. Safe / Balanced / Aggressive

For each mode independently:

1. Enable the unpacked extension.
2. Select the mode in the popup.
3. Close the prior ChatGPT tab and open a fresh one so renderer state is not shared across groups.
4. Open DevTools Console.
5. Run `__CSG_DEBUG__.clearHistory()`.
6. At switch 0 run `__CSG_DEBUG__.snapshot()` and record Task Manager renderer memory.
7. Perform the same 100-navigation sequence.
8. At 10, 20, ... 100 run `__CSG_DEBUG__.snapshot()` and record Task Manager renderer memory.
9. After switch 100 run `__CSG_DEBUG__.history()` and save/copy only the numeric result into the benchmark document.

A debug snapshot contains:

- `conversationId`
- `spaSwitchCount`
- `renderedRounds`
- `totalRounds`
- `conversationDomNodes`
- `activeConversationDomNodes`
- `totalDocumentDomNodes`
- `networkMode`
- `networkModified`
- `networkRequestedTurns`
- `networkEffectiveTurns`
- `cleanupCount`
- `hardSwitchCount`
- `switchLatencyMs`
- `jsHeapMb`

No conversation body is included.

## 6. Network validation

Use DevTools Network while switching into a long conversation. Complete `docs/network-validation.md`.

The key check is the initial GET request for `/backend-api/conversations/{id}`:

- Off: record the page's original numeric `num_turns`.
- On: confirm `networkRequestedTurns` reports that original value and `networkEffectiveTurns` reports the reduced value.
- Cursor requests under `/messages?before=...` must remain unmodified.
- POST, streaming, tools, confirmation and upload requests must remain untouched.

Never copy request/response bodies, authorization headers, cookies or cursor values into the docs.

## 7. Compatibility pass

For each enabled mode, manually verify the compatibility matrix in `docs/real-browser-benchmark.md`.

Pay particular attention to Google Drive confirmation and branch-conversation behavior.

Aggressive must also be checked for:

- old-message corruption
- React reconciliation errors
- broken streaming
- missing tool cards
- broken regenerate/edit/branch behavior

## 8. When to test Hard Switch

Do **not** test Hard Switch merely because it exists.

First establish this real pattern:

```text
conversation/document DOM ≈ stable
renderer memory or JS heap = persistent upward trend with switch count
```

Only then enable the experimental debug control:

```js
__CSG_DEBUG__.setHardSwitchEnabled(true)
```

Disable it again with:

```js
__CSG_DEBUG__.setHardSwitchEnabled(false)
```

Continue switching and record the memory immediately before and after a safe hard reload. A useful Session GC should return memory materially toward the fresh-renderer baseline.

Hard Switch must not fire while generation, file upload, confirmation/permission UI, or another important modal is active.

## 9. Decision

The v0.1 claim is allowed only if real data shows one of these outcomes without core compatibility regressions:

- Session Guard keeps renderer memory / heap materially bounded across 50–100 switches; or
- retained SPA growth still occurs, but controlled Session GC repeatedly returns the renderer close to baseline.

If Balanced only makes switching smoother while memory continues to rise, document exactly:

`Balanced improves rendering cost but does not solve retained-memory growth.`

If the test is not completed, leave the benchmark status as pending and do not merge `main`.
