## Result summary

Inspected accepted Web Tools design and current implementation. `webTools` returns search/fetch runtime tools backed by an authenticated external service, with argument validation, bounded results and tool error metadata. No source modifications or tests.

## File lookup

| Path | Description |
|---|---|
| `backend/src/domain/web-tools/web-tools.ts` | Search/fetch tool definitions, validation, HTTP and bounded output. |
| `.rsi/context/design/backend/domain/web-tools/design.md` | Accepted subsystem design. |

## Implemented contract

`webTools(apiKey?, request=fetch)` returns RuntimeTool definitions. Search accepts query (required, max 128 chars), optional count from 1 to 50 (default 5), and optional original_question (max 128 chars); fetch accepts an HTTP(S) URL with host and without embedded credentials. Calls return readable content and structured metadata; search snippets are capped at 300 characters. HTTP responses are limited to 4 MiB, rendered content to 64 KiB and requests have a 30-second deadline. Errors are returned as tool errors for invalid arguments, malformed provider response, HTTP failure or network failure; no automatic retry or persistence. Example: register `webTools(key)` among Agent tools and dispatch `{query:"recent topic",count:5}`.

## Implementation notes

Provider endpoint is fixed to DeepSeek tools API; `request` injection allows an alternate fetch implementation for tests/callers. Credentials are supplied by composition and not in tool arguments. External content is data, not executable instructions.

## Verification and continuation

Inspected source declarations/constants only; no tests/build run. Open: confirm exact output metadata fields and retryable status handling by reading full tool implementation/tests.

## Automatic retrieval

```json
{"commands":[]}
```
