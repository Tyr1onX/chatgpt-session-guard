# ChatGPT Session Guard

ChatGPT Session Guard is a Chrome Manifest V3 extension for people who keep ChatGPT Web open for long periods and repeatedly switch between multiple long-running conversations.

Its only goal is to reduce browser-side rendering and session-state pressure. It does **not** delete server-side conversation history, modify prompts sent to the model, abort generation, or store chat text.

## What it does

The extension uses four deliberately separate layers:

1. **Network Guard** — limits initial history loading only for recognized conversation GET requests. Unknown schemas fail open.
2. **Rolling DOM Window** — keeps the newest conversation UI active while older settled turns use Safe, Balanced, or Aggressive handling.
3. **Session Switch Guard** — tears down per-conversation observers/timers/references on SPA navigation.
4. **Experimental Session GC** — reserved for cases where DOM is stable but the ChatGPT SPA still retains heap/state across many switches.

ChatGPT is a private web application that changes frequently. Internal endpoints and DOM structure may change, so compatibility is maintained on a best-effort basis rather than guaranteed permanently.

## Privacy

ChatGPT Session Guard is local-only.

- No analytics or telemetry.
- No remote server.
- No external API.
- No conversation text is stored or exported.
- No conversation content is sent through the MAIN ↔ ISOLATED bridge.
- Automatic benchmarks store only conversation IDs/routes and numeric performance counters in `chrome.storage.session`.

> ChatGPT Session Guard never sends or stores conversation content.

## Permissions

```text
permissions:
  storage

host_permissions:
  https://chatgpt.com/*
```

The extension does not request `history`, `cookies`, `downloads`, `webRequest`, `clipboard`, `tabs`, or `activeTab`.

## Development

Requirements:

- Node.js 24+
- Chrome / Chromium with Manifest V3 support

Install dependencies:

```text
npm install
```

Run checks:

```text
npm test
npm run lint
npm run typecheck
npm run build
npm audit
```

Production build:

```text
npm run build
```

Debug build:

```text
npm run build:debug
```

Both write the unpacked extension to `dist/`. The Automatic Real Browser Benchmark exists only in the debug build and is removed from production bundles.

## Load the unpacked extension

1. Build with `npm run build` or `npm run build:debug`.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked**.
5. Select this repository's `dist/` directory.

## One-click real-browser benchmark

The debug build turns the previous manual 50/100-switch protocol into an automatic benchmark.

1. Run `npm run build:debug` and load `dist/`.
2. Open a logged-in `https://chatgpt.com/` tab whose sidebar exposes at least five normal `/c/{conversationId}` conversations.
3. Open the extension popup.
4. Choose 50 or 100 switches per mode.
5. Click **Start Benchmark**.
6. Leave ChatGPT alone until the benchmark completes.
7. Download JSON and Markdown results from the popup or the small in-page benchmark panel.

The runner automatically performs fresh-renderer groups for:

- Control — Network Guard OFF, DOM Window OFF, Hard Switch OFF.
- Balanced — normal Balanced optimization, Hard Switch OFF.
- Aggressive — Aggressive DOM reclamation, Hard Switch OFF.

Every 10 switches it records DOM counts, rendered rounds, cleanup count, network mode/turn limits, JS heap when Chrome exposes it, switch latency, route, and Long Task counters when supported.

If Aggressive keeps conversation DOM stable while heap still shows strong growth, the result is explicitly diagnosed as likely retained SPA state/cache and the UI offers **Run Session GC Benchmark**. That optional second phase performs controlled full renderer recreation at spaced intervals; it is never mixed into the first three groups.

See [`docs/automatic-real-browser-benchmark.md`](docs/automatic-real-browser-benchmark.md) for details.

## Benchmark conclusions

The report can return only one of:

- `proven improvement`
- `partial improvement`
- `inconclusive`
- `regression`

A completed run is not automatically considered successful. If the Control run does not reproduce sustained growth, the report remains `inconclusive`. If optimized modes grow more strongly than Control, the report can explicitly mark a regression.

Chrome renderer-process memory is intentionally not collected automatically because doing so would require unrelated or unstable browser capabilities. JS heap + DOM + latency + Long Tasks are the first-stage automatic metrics; renderer memory remains optional supplementary evidence.

## Current v0.1 status

The core implementation, automatic benchmark runner, debug-only instrumentation, unit tests, and production build are implemented. A real logged-in Chrome benchmark still has to be run before v0.1 can truthfully claim that it materially improves the target workload and before `main` should be treated as validated.
