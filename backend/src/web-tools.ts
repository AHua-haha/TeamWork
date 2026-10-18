import { Type } from '@earendil-works/pi-ai';
import type { RuntimeTool } from './runtime.js';
import { toolText, type ToolOutput } from './tool-result.js';

const endpoint = 'https://api.deepseek.com/v1/tools/';
const responseLimit = 4 * 1024 * 1024;
const contentLimit = 64 * 1024;
const snippetLimit = 300;
const deadlineMs = 30_000;
type Metadata = Record<string, unknown>;
type SearchInput = { query: string; count: number; original_question?: string };
type Source = { title: string; url: string; snippet: string; metadata: Metadata };

class WebFailure extends Error {
  constructor(readonly code: string, message: string, readonly retryable = false, readonly httpStatus?: number) { super(message); }
}
const invalid = (message: string): never => { throw new WebFailure('invalid_arguments', message); };
const malformed = (): never => { throw new WebFailure('web_invalid_response', 'DeepSeek returned an invalid response.'); };
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return malformed();
  return value as Record<string, unknown>;
};
const text = (value: unknown): string => typeof value === 'string' ? value : malformed();
const optionalText = (value: unknown): string | null => value == null ? null : text(value);
const optionalNumber = (value: unknown): number | null => value == null ? null : typeof value === 'number' && Number.isFinite(value) ? value : malformed();

function fields(args: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(args).some(key => !allowed.includes(key))) invalid('Unknown tool argument.');
}
function queryText(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim() || [...value].length > 128) invalid(`${name} must contain 1–128 Unicode characters and cannot be whitespace-only.`);
  return value as string;
}
function searchInput(args: Record<string, unknown>): SearchInput {
  fields(args, ['query', 'count', 'original_question']);
  const query = queryText(args.query, 'query'), count = args.count === undefined ? 5 : args.count;
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > 50) invalid('count must be an integer between 1 and 50.');
  return { query, count: count as number, ...(args.original_question === undefined ? {} : { original_question: queryText(args.original_question, 'original_question') }) };
}
function fetchInput(args: Record<string, unknown>): string {
  fields(args, ['url']);
  if (typeof args.url !== 'string' || !args.url || [...args.url].length > 8192) return invalid('url must contain 1–8192 characters.');
  let url: URL;
  try { url = new URL(args.url); } catch { return invalid('url must be an HTTP or HTTPS URL with a host.'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) invalid('url must use HTTP/HTTPS, contain a host and have no embedded credentials.');
  return args.url;
}

function searchSources(value: unknown): Source[] {
  const data = object(value);
  if (!Array.isArray(data.results) || data.results.length > 50) return malformed();
  return data.results.map(value => {
    const row = object(value), title = text(row.title), url = text(row.url);
    const characters = [...text(row.snippet)], snippetTruncated = characters.length > snippetLimit;
    const snippet = snippetTruncated ? characters.slice(0, snippetLimit - 1).join('') + '…' : characters.join('');
    return { title, url, snippet, metadata: {
      url, published_at: optionalText(row.date), site_name: optionalText(row.site_name),
      rerank_score: optionalNumber(row.rerank_score), authority: optionalNumber(row.authority),
      snippet_truncated: snippetTruncated,
    } };
  });
}

/** YAML scalar/list metadata inside one model-readable text result, never an outer JSON string. */
function metadataText(metadata: Metadata): string {
  const scalar = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
  return Object.entries(metadata).map(([name, value]) => Array.isArray(value)
    ? value.length ? `${name}:\n${value.map(item => Object.entries(item as Metadata).map(([key, data], index) => `  ${index ? '  ' : '- '}${key}: ${scalar(data)}`).join('\n')).join('\n')}` : `${name}: []`
    : `${name}: ${scalar(value)}`).join('\n');
}
function output(core: string, metadata: Metadata, isError: boolean, key?: string): ToolOutput {
  const redact = (value: string) => key ? value.split(key).join('[redacted]') : value;
  core = redact(core);
  const bytes = Buffer.from(core), coreTruncated = bytes.length > contentLimit;
  const truncated = coreTruncated || metadata.truncated === true;
  if (coreTruncated) {
    const notice = '\n\n[Content truncated at the tool output limit.]';
    core = new TextDecoder().decode(bytes.subarray(0, contentLimit - Buffer.byteLength(notice)), { stream: true }) + notice;
  }
  return { ...toolText(`${core}\n\n<metadata>\n${redact(metadataText({ ...metadata, truncated }))}\n</metadata>`), isError };
}

async function responseJson(response: Response): Promise<unknown> {
  if (Number(response.headers.get('content-length')) > responseLimit) {
    await response.body?.cancel();
    throw new WebFailure('web_response_too_large', 'DeepSeek response exceeds the 4 MiB limit.');
  }
  if (!response.body) return malformed();
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > responseLimit) throw new WebFailure('web_response_too_large', 'DeepSeek response exceeds the 4 MiB limit.');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { return malformed(); }
}

function httpFailure(status: number): WebFailure {
  const messages: Record<number, [string, string]> = {
    401: ['web_authentication_failed', 'DeepSeek rejected the backend web API credential.'],
    402: ['web_balance_exhausted', 'The DeepSeek account has insufficient balance.'],
    403: ['web_access_denied', 'DeepSeek refused access to the requested resource.'],
    404: ['web_content_unavailable', 'DeepSeek could not retrieve usable page content.'],
    429: ['web_rate_limited', 'DeepSeek rate limit exceeded; wait before retrying.'],
  };
  const [code, message] = messages[status] ?? (status >= 500
    ? ['web_provider_unavailable', 'The DeepSeek web service is unavailable.']
    : ['web_request_rejected', 'DeepSeek rejected the web request.']);
  return new WebFailure(code!, message!, [408, 429].includes(status) || status >= 500, status);
}

/** Reusable tools: only the deployment supplies credentials; harnesses decide availability. */
export function webTools(apiKey?: string, request: typeof fetch = fetch): RuntimeTool[] {
  const key = apiKey?.trim() || undefined;
  const run = async (tool: 'web_search' | 'web_fetch', args: Record<string, unknown>, signal: AbortSignal): Promise<ToolOutput> => {
    signal.throwIfAborted();
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), deadlineMs);
    timer.unref();
    const combined = AbortSignal.any([signal, timeout.signal]);
    try {
      const input = tool === 'web_search' ? searchInput(args) : fetchInput(args);
      if (!key) throw new WebFailure('web_not_configured', 'Set DEEPSEEK_WEB_API_KEY in the backend deployment environment.');
      const search = typeof input === 'object' ? input : undefined;
      const payload = search ? { query: search.query, count: search.count, need_content: false, ...(search.original_question === undefined ? {} : { ori_question: search.original_question }) } : { url: input };
      const response = await request(endpoint + (search ? 'search' : 'fetch'), {
        method: 'POST', redirect: 'error', signal: combined,
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      if (!response.ok) { await response.body?.cancel(); throw httpFailure(response.status); }
      const data = await responseJson(response);
      combined.throwIfAborted();
      const metadata = { tool, provider: 'deepseek', status: 'success', retrieved_at: new Date().toISOString() };
      if (search) {
        const sources = searchSources(data);
        const core = '## Search results\n\n' + (sources.length ? sources.map((row, index) => `### ${index + 1}. ${row.title}\n${row.url}${row.snippet ? `\n\n${row.snippet}` : ''}`).join('\n\n') : 'No results found.');
        return output(core, { ...metadata, query: search.query, requested_count: search.count, result_count: sources.length, sources: sources.map(row => row.metadata), truncated: sources.some(row => row.metadata.snippet_truncated === true) }, false, key);
      }
      const page = object(data), title = text(page.title), content = text(page.content);
      if (!content.trim()) return malformed();
      return output(`## ${title || 'Web page'}\n\n${content}`, { ...metadata, url: input, title }, false, key);
    } catch (error) {
      signal.throwIfAborted();
      const failure = timeout.signal.aborted ? new WebFailure('web_timeout', 'The web request exceeded its 30-second deadline.', true)
        : error instanceof WebFailure ? error : new WebFailure('web_network_error', 'Could not reach the DeepSeek web service.', true);
      return output(`## ${tool === 'web_search' ? 'Web search' : 'Web fetch'} failed\n\n${failure.message}`, {
        tool, provider: 'deepseek', status: 'error', retrieved_at: new Date().toISOString(), error_code: failure.code,
        retryable: failure.retryable, ...(failure.httpStatus === undefined ? {} : { http_status: failure.httpStatus }),
      }, true, key);
    } finally { clearTimeout(timer); }
  };
  return [
    {
      definition: { name: 'web_search', description: 'Search the web for current information. Put site:, -site:, quoted phrases, lang:, after: and before: filters directly in query. Returns Markdown titles, URLs and snippets of at most 300 characters each, followed by metadata. Use web_fetch to read a selected page.', parameters: Type.Object({
        query: Type.String({ minLength: 1, maxLength: 128, description: 'Search query including any filters; at most 128 Unicode characters.' }),
        count: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, default: 5 })),
        original_question: Type.Optional(Type.String({ minLength: 1, maxLength: 128, description: 'Short original question to clarify search intent.' })),
      }, { additionalProperties: false }) },
      execute: (args, scope) => run('web_search', args, scope.signal),
    },
    {
      definition: { name: 'web_fetch', description: 'Read one HTTP/HTTPS page. Returns its Markdown content followed by metadata containing the requested URL and title. This is page retrieval, not browser interaction.', parameters: Type.Object({
        url: Type.String({ minLength: 1, maxLength: 8192, description: 'HTTP/HTTPS URL with a host and no embedded credentials.' }),
      }, { additionalProperties: false }) },
      execute: (args, scope) => run('web_fetch', args, scope.signal),
    },
  ];
}
