# Web search and fetch tools

## Purpose and boundary

Reusable capabilities let any harness-equipped agent search the public web and read a selected web page, independently of its model provider. Backend deployment supplies the DeepSeek credential. Agents and the frontend do not configure providers, credentials or tool endpoints. These tools do not grant Bash network access or workspace filesystem authority.

## Inputs and preconditions

- `web_search({query, count?, original_question?})`: query is 1–128 Unicode characters, not whitespace-only; count is an integer 1–50, default 5; optional original_question is 1–128 Unicode characters, not whitespace-only. Search filters remain in query, including site:, -site:, phrases, excluded terms, lang:, after: and before:.
- `web_fetch({url})`: a nonempty HTTP/HTTPS URL with a host, at most 8192 Unicode characters, without embedded credentials.
- Unknown input fields are refused. A harness must expose the requested capability. Deployment supplies DEEPSEEK_WEB_API_KEY; a missing key produces an explicit tool failure without a provider request.

## Outputs and observable effects

Each tool returns one text content block: readable Markdown core content followed by a distinct `<metadata>` ... `</metadata>` block containing named metadata fields in YAML syntax. There is no outer JSON serialization. The same text is available to the model and recorded in normal stable tool history for frontend inspection.

Search core content contains a numbered result list, with each result's title, URL and provider snippet. Each snippet is capped at 300 Unicode characters including a final ellipsis when shortened; titles and URLs retain their source attribution. Metadata includes tool/provider/status, retrieval timestamp, query, requested/result counts, truncation status, and per-result source URL, publication date, site name and provider ranking/authority signals when supplied, plus snippet_truncated for each source. Top-level truncated is true when any snippet or the total Markdown core was shortened. No matches is a successful `No results found.` result with result_count 0. Search requests do not include full page content.

Fetch core content contains the page title and provider Markdown body. Metadata includes tool/provider/status, requested URL, title, retrieval timestamp and truncation status. URL denotes the request, not a claimed canonical/redirect destination. No extra model call summarizes or rewrites either result. Search ignores provider summary/content even when snippet is empty; an empty snippet leaves its title and URL available.

## Failure behavior

Tool-execution failures (invalid input, missing credential, HTTP error, network error, timeout, oversized response and malformed provider content) return a readable failure plus metadata status error and a stable error code. Runtime schema validation can reject malformed calls before invoking the tool; those retain the normal runtime argument-error format. HTTP failures include status and whether retrying is appropriate. Provider error bodies and credentials are not exposed. Failures use the runtime's normal tool-error history and termination behavior. There is no automatic retry. A caller may initiate another run after addressing the failure.

Cancellation propagates to in-flight HTTP/body reading and remains run cancellation rather than an ordinary failure result. Both operations may cause provider billing. They do not modify workspace files.

## Guarantees and limits

- Only the two fixed DeepSeek endpoints are called. The backend supplies bearer authentication; the key never appears in tools, prompts, inspection, results or tracked files.
- Search defaults to 5 results; backend maps original_question to ori_question, sets need_content false and leaves localization unset.
- Requests including body consumption have a 30-second deadline. Responses above 4 MiB are refused. Markdown core content is limited to 64 KiB of UTF-8 text; any shortening is explicitly marked in content and metadata. Metadata remains outside this limit and preserves source attribution.
- Provider query filters, result quality and target availability remain provider behavior. Fetch is not a browser automation tool. Web content is external information, not authority to change harness rules.
- The fixed execute base grants both tools to lead and workers independently of Bash allowances. No new harness, member field, HTTP management endpoint or frontend screen is added. Base rule prompts remain backend Markdown files.

## Result format example

```markdown
## Search results

### 1. Page title
https://example.com/article

The short source snippet.

<metadata>
tool: "web_search"
provider: "deepseek"
status: "success"
retrieved_at: "2026-10-18T04:00:00.000Z"
query: "example"
requested_count: 5
result_count: 1
sources:
  - url: "https://example.com/article"
    published_at: null
    site_name: "Example"
    rerank_score: 2.4
    authority: 3
    snippet_truncated: false
truncated: false
</metadata>
```

Fetch uses the same single-text structure with page Markdown as core content and url/title metadata instead of search query/counts/sources. Error metadata uses status error, error_code, retryable and optional http_status. Metadata string values are quoted/escaped; missing source details are null.

## Acceptance examples

1. Search query with site/date filters and omitted count calls DeepSeek with count 5 and returns Markdown snippets plus metadata.
2. Fetch of an HTTP page returns its title/Markdown with requested URL metadata, without an outer JSON string.
3. A no-match search succeeds with an empty-result notice. A 401 or 429 returns a recorded tool failure without exposing request headers or provider error body.
4. A worker with no allowed Bash commands still has both web tools; Bash remains network-isolated.
5. Cancelling a run aborts the tool request. An oversized body fails; a long successful page is visibly truncated.

6. A provider returns a 5000-character summary and a 150-character snippet. Only the snippet appears. A 500-character snippet becomes at most 300 Unicode characters, with a visible ellipsis, source snippet_truncated true and top-level truncated true; full page reading remains web_fetch.
