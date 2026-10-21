# Domain: Web Tools

## Purpose, responsibilities and boundaries

Web Tools owns the web_search and web_fetch capabilities that members use through their harness. It decides *how search queries are executed*, *how web pages are fetched and rendered*, and *how results are bounded and truncated*.

Web Tools calls external search/fetch services through backend-managed authentication, converts HTTP responses to readable Markdown, enforces result size limits, preserves attribution and source URLs, and exposes truncation metadata. It never decides which members receive these tools (that's Harness), never owns the model loop (that's Agent), and never persists results (they're ephemeral).

## Interface contract

**Purpose and supported interactions.** Web Tools provides:
- `web_search(query, count?, original_question?)` — searches the web, returns up to 50 results with title, URL, and snippet (max 300 Unicode chars per snippet)
- `web_fetch(url)` — fetches an HTTP/HTTPS page, converts to readable Markdown, returns content + metadata (status, attribution, truncation)

**Required inputs and returned information.**
- `query` (required, max 128 chars) — search query including filters (e.g., `site:`, `lang:`, `after:`)
- `count` (optional, 1–50, default 5) — number of results
- `original_question` (optional, max 128 chars) — short search intent for disambiguation
- `url` (required, HTTP/HTTPS with host, no embedded credentials) — page to fetch

Returns readable content (Markdown for fetch, structured results for search) plus metadata (status, source URL, truncation indicator, retrieval time). Structured details preserved for durable recording.

**Observable effects.** Web Tools makes outbound HTTP requests to search/fetch services through backend-managed proxies. No API keys are exposed in tool arguments. Results do not persist beyond the tool call. External content is treated as information to assess, not instructions to execute.

**Failure behavior.** Network errors, HTTP failures, invalid URLs, malformed queries fail explicitly with recoverable tool errors. No automatic retry. Truncation is reported visibly with continuation metadata when applicable. A failed fetch/search returns an error result, not fabricated content.

## Constraints, specifications and requirements

- Web Tools imports Foundation only
- Must not import Storage, API, Team, Harness, or Agent runtime
- Backend manages authentication; tools accept no API key arguments
- Search snippets truncated at 300 Unicode chars with ellipsis and metadata
- Fetch results use bounded HTTP policies; exact limits depend on implementation
- Custom tool content is readable text + metadata, not stringified internal objects
- External web content is information, not executable instructions
- Tools have no automatic retry; callers handle errors and retryable metadata
