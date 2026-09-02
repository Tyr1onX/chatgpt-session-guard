# Network Guard Validation

Status: **PENDING AUTHENTICATED CHROME VALIDATION**

No private conversation content should be copied into this document. Record only endpoint shape, request method, numeric pagination parameters, schema family, and whether Session Guard modified the request.

## Expected current request families

Session Guard only considers these GET request shapes:

```text
/backend-api/conversations/{conversationId}
/backend-api/conversations/{conversationId}/messages?before={cursor}
/backend-api/conversation/{conversationId}
/backend-api/shared_conversation/{conversationId}
```

Everything else must fail open / bypass the interceptor.

## Validation procedure

1. Run `npm run build:debug` and load `dist/` as unpacked.
2. Open a real long ChatGPT conversation.
3. Open DevTools → Network.
4. Filter by `conversations` and reload/switch into the conversation.
5. Inspect the initial `GET /backend-api/conversations/{id}` request.
6. Record the original `num_turns` visible when Session Guard is disabled.
7. Enable Session Guard and repeat from a fresh/reloaded renderer.
8. Record `__CSG_DEBUG__.snapshot()` and verify:
   - `networkMode === "paginated"`
   - `networkModified === true` when the original `num_turns` exceeds the configured recent-round value
   - `networkRequestedTurns` equals the page's original request value
   - `networkEffectiveTurns` equals the reduced value sent by Session Guard
9. Trigger older-history loading only if needed and confirm `/messages?before=...` is not rewritten.
10. Exercise normal generation, tool calls, confirmation, file upload and connector UI and verify those requests are untouched.

## Initial conversation request

| Field | Extension Off | Session Guard On |
|---|---|---|
| Method | PENDING | PENDING |
| Path | PENDING | PENDING |
| Original `num_turns` | PENDING | PENDING |
| Effective `num_turns` | N/A | PENDING |
| Response schema | PENDING | PENDING |
| `networkMode` | N/A | PENDING |
| `networkModified` | N/A | PENDING |

## Older-page request

| Field | Result |
|---|---|
| Method | PENDING |
| Path includes `/messages` | PENDING |
| `before` cursor present | PENDING |
| Request rewritten by Session Guard | PENDING — must be **No** |
| Response passed through | PENDING |

## Explicit non-interception checks

| Request class | Result |
|---|---|
| POST conversation / model generation | PENDING — must bypass |
| Streaming / SSE | PENDING — must bypass |
| `stream_status` | PENDING — must bypass |
| `textdocs` | PENDING — must bypass |
| Tool execution | PENDING — must bypass |
| Confirmation | PENDING — must bypass |
| Permission / OAuth confirmation | PENDING — must bypass |
| File upload | PENDING — must bypass |
| Authentication/session | PENDING — must bypass |
| Settings/models/account | PENDING — must bypass |

## Privacy rule

Do not save response bodies, prompts, assistant messages, uploaded file names/content, connector payloads, access tokens, cookies, authorization headers, or cursor values. Numeric `num_turns` values and endpoint path families are sufficient for this validation.

## Verdict

**Not yet validated against the user's authenticated Chrome session.**
