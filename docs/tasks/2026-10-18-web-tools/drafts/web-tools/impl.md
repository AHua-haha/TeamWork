<!-- Task proposal; current contract is under docs/systems/ -->
# Web tools implementation

## Contract

[Web tools](design.md) owns provider-independent agent inputs and readable Markdown plus metadata output, with backend-only DeepSeek authentication and bounded/cancellable HTTP.

## Responsibilities and decomposition

One reusable web-tools module owns tool definitions, input/provider validation, DeepSeek HTTP requests, safe failures and deterministic output formatting. It uses the existing RuntimeTool interface and has no dependency on member identity or file scope. HarnessService owns selection through the fixed execute base; TeamSystem/main inject the shared tool implementations. Runtime retains its existing execution/history loop.

## Coordination and data flow

Main reads DEEPSEEK_WEB_API_KEY and constructs the tools once. TeamSystem passes them to HarnessService, which filters the tool catalog using purpose-harness capability names. Tool execution validates arguments, calls a fixed provider endpoint with backend credentials and the run abort signal plus a 30-second deadline, bounds body reading, validates the response, and renders a single text block. Failed requests return isError true. Markdown output, including metadata, is persisted by the unchanged runtime as a normal tool result.

## Decisions and constraints

Use built-in Node fetch without an extra provider SDK. Inject fetch for deterministic tests. Do not send model names, conversation history or credentials in the input schema. Search forwards query unchanged, defaults count to 5, maps original_question and sets need_content false. Fetch forwards URL unchanged. Do not follow redirects on provider API requests to another endpoint. No automatic retries, new configuration UI, database schema changes or frontend changes. Metadata uses YAML scalar/list syntax with escaped quoted data; no raw JSON envelope. Keep provider output and errors from disclosing the backend key.

## Code map

- [web-tools.ts](../../../backend/src/web-tools.ts): reusable definitions, provider adapter, validation, Markdown/metadata formatting and limits.
- [main.ts](../../../backend/src/main.ts), [team-system.ts](../../../backend/src/team-system.ts), [harness.ts](../../../backend/src/harness.ts) and [harness-bases.ts](../../../backend/src/harness-bases.ts): deployment injection and fixed capability assembly.
- [execute.md](../../../backend/prompts/harness/execute.md): usage and external-content rules.
- [.env.example](../../../backend/.env.example) and [README.md](../../../backend/README.md): deployment setup and examples.

## Verification

[Web-tool tests](../../../backend/test/web-tools.test.ts) check exact endpoint/auth/body, filters/defaults, Unicode validation, Markdown+metadata, empty results, malformed responses, provider failures, cancellation, deadline and limits. [Harness assembly tests](../../../backend/test/team-context.test.ts) check lead/worker availability without Bash allowance and inspection consistency. [Disposable MySQL runtime integration](../../../backend/test/integration/backend.test.ts) checks persisted tool output and follow history. Live credential/endpoint probes are recorded without secrets in the task tests.jsonl. Run backend typecheck, unit tests, MySQL integration and build before committing the completed contract.
