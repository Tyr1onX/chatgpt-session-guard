# Network Guard Validation

## Current supported conversation loading paths

ChatGPT Session Guard recognizes only narrowly scoped conversation-history GET requests.

### Current paginated path

```text
GET /backend-api/conversations/{conversationId}
GET /backend-api/conversations/{conversationId}/messages?before={cursor}
```

The initial paginated request may include:

```text
num_turns=N
```

When the schema and query are recognized, Session Guard may reduce the initial `num_turns` value to the configured recent-round limit. It never increases the requested history amount.

Cursor/history-page requests are recognized for metrics but are not rewritten.

### Legacy compatibility path

```text
GET /backend-api/conversation/{conversationId}
GET /backend-api/shared_conversation/{conversationId}
```

Legacy JSON is modified only when strict mapping/current-node validation succeeds. Unknown or malformed structures fail open.

## Explicit non-targets

The request classifier does not intentionally modify:

```text
POST conversation
streaming / SSE
stream_status
textdocs
tool requests
plugin requests
confirmation requests
permission flows
OAuth
authentication
file uploads
models
settings
account endpoints
```

There is no broad `/backend-api/*` interception rule.

## Automatic benchmark evidence

The debug-only Automatic Real Browser Benchmark records these fields at every 10-switch sample:

```text
networkMode
networkRequestedTurns
networkEffectiveTurns
```

Expected Control behavior:

```text
Network Guard disabled
networkMode = disabled (after a conversation-history request is observed)
no num_turns rewrite
```

Expected Balanced/Aggressive behavior on the current paginated API:

```text
networkMode = paginated
networkRequestedTurns = ChatGPT's original num_turns
networkEffectiveTurns <= networkRequestedTurns
```

If the current ChatGPT schema is no longer recognized, the expected result is:

```text
networkMode = unknown
modified = false
```

Network metrics are reset on every conversation route. If ChatGPT serves a conversation from its own SPA cache and no history request is observed for that route, the sample remains `unknown` instead of inheriting a previous conversation's request data.

That is a compatibility degradation, not a reason to rewrite unknown responses.

## Validation status

**PENDING REAL LOGGED-IN RUN**

The automatic harness is implemented and request-classifier/schema tests pass, but this document intentionally does not claim that a current logged-in ChatGPT session has been observed until a generated real-browser benchmark report is reviewed.

Manual DevTools Network inspection may still be useful for debugging a future ChatGPT API change, but it is not required for the normal benchmark workflow.

## Privacy

Network validation stores only endpoint mode and numeric request limits in benchmark results. It does not serialize response bodies or conversation text.
