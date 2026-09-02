# Network Guard Validation

## Verified current path

The current ChatGPT Web paginated history shape observed in the real benchmark is:

```text
GET /backend-api/conversations/{conversationId}?include_has_versions=true&num_turns=10
GET /backend-api/conversations/{conversationId}/messages?before={cursor}&...
```

The first real benchmark verified that the previous Balanced configuration changed the initial request from `10` to `8` without breaking the benchmark workload.

## History-target mapping

The v2 History rendering configuration now drives Network Guard.

Session Guard only lowers an already-present valid `num_turns` and never increases ChatGPT's request.

Current conservative floor:

```text
MIN_SAFE_NETWORK_TURNS = 4
```

When ChatGPT requests `num_turns=10`:

| History target | Network target |
|---|---:|
| Balanced · 8 rounds | 8 |
| 4 rounds | 4 |
| 2 rounds | 4 |
| 1 round | 4 |
| 1 message | 4 |

The `4` floor is an engineering safety boundary, not a claim that ChatGPT officially documents `num_turns=4` as universally safe. `num_turns=1/2/4` have not all been verified in a logged-in Tool/Thinking/Branch compatibility matrix.

## Automatic older-history suppression

When:

```text
autoLoadHistory = false
```

Session Guard still allows the browser to make its normal cursor GET request, because the extension intentionally avoids broad request cancellation or new webRequest permissions.

After the response arrives:

1. it must pass the strict paginated schema validator;
2. if it is a cursor older-page response and no manual expansion/full-history state is active, the browser-facing replacement contains:

```text
messages: []
page_info.has_previous_page: false
```

This prevents a validated older page from automatically repopulating the React/DOM history working set.

If the response schema is unknown or malformed, Session Guard returns the original response unchanged. This is fail-open behavior.

If the user explicitly chooses **Load previous N**, a matching current-conversation expansion is stored in `chrome.storage.session`, the page reloads, and older history is allowed for that user-initiated session. The raw ChatGPT pagination page may contain a different number of internal nodes than the visible batch target; Session Guard does not destructively slice unknown Tool/Thinking dependencies just to force an exact raw-node count.

Temporary Full History bypasses both initial history limiting and older-page suppression.

## Legacy fallback

Legacy endpoints remain narrowly recognized:

```text
GET /backend-api/conversation/{conversationId}
GET /backend-api/shared_conversation/{conversationId}
```

Legacy response trimming continues to preserve the complete mapping object, branches, hidden/tool nodes and current node, while reconnecting the visible suffix through a shadow-tree boundary. In `message` mode the legacy network fallback still keeps a round-level safety boundary rather than disconnecting the assistant from its user/tool dependency chain; the DOM layer is responsible for the precise visible-message target.

## Explicit non-targets

The classifier does not intentionally modify:

```text
POST conversation
streaming / SSE
stream_status
textdocs
tool/plugin calls
confirmation / permission flows
OAuth/authentication
file uploads
models/settings/account endpoints
```

There is no broad `/backend-api/*` interception rule.

## Validation status

Automated request/schema tests cover:

- Balanced `10 → 8`
- Ultra Lite / 1-message target `10 → 4`
- never increasing a smaller request
- manual expansion isolation by conversation ID
- cursor URL not rewritten by the initial-request adapter
- automatic validated older-page suppression
- manual older-page allowance
- Request headers/credentials preservation
- malformed/unknown schema fail-open

A new logged-in real run is still required to confirm `10 → 4` with current Tool/Thinking/confirmation/branch behavior. Until then, the new lower network target is **implemented but not proven compatible in every real workflow**.

No benchmark/network validation result contains conversation text.
