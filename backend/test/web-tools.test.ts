import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { validateToolArguments } from '@earendil-works/pi-ai';
import type { RuntimeTool, StepScope } from '../src/core/agent/runtime.js';
import { webTools } from '../src/core/harness/web-tools.js';

const key = 'test-web-key-not-a-real-credential';
const scope = (signal = new AbortController().signal) => ({ signal } as StepScope);
const invoke = (tools: RuntimeTool[], name: string, args: Record<string, unknown>, signal?: AbortSignal) => tools.find(tool => tool.definition.name === name)!.execute(args as never, scope(signal), {} as never);
const content = (result: Awaited<ReturnType<typeof invoke>>) => result.content.map(part => part.type === 'text' ? part.text : '').join('');
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const source = { title: 'Agent harness', url: 'https://example.com/harness', summary: 'A source summary.', snippet: 'Short snippet.', date: '2026-10-01T00:00:00Z', site_name: 'Example', rerank_score: 2.4, authority: 3, content: 'Unused full page' };

test('search maps inputs to the fixed DeepSeek API and returns one Markdown text with YAML metadata', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const tools = webTools(key, async (url, init) => { calls.push({ url: String(url), init: init! }); return json({ results: [source] }); });
  const query = 'agent harness site:example.com lang:en after:2026-01-01';
  const result = await invoke(tools, 'web_search', { query, original_question: 'How can agents use a harness?' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, 'https://api.deepseek.com/v1/tools/search');
  assert.equal(calls[0]!.init.method, 'POST');
  assert.equal(calls[0]!.init.redirect, 'error');
  assert.equal(new Headers(calls[0]!.init.headers).get('authorization'), `Bearer ${key}`);
  assert.deepEqual(JSON.parse(calls[0]!.init.body as string), { query, count: 5, need_content: false, ori_question: 'How can agents use a harness?' });
  assert.equal(result.isError, false);
  assert.equal(result.content.length, 1);
  assert.match(content(result), /^## Search results\n\n### 1\. Agent harness\nhttps:\/\/example.com\/harness\n\nShort snippet\./);
  assert.match(content(result), /<metadata>\ntool: "web_search"\nprovider: "deepseek"\nstatus: "success"/);
  assert.match(content(result), /requested_count: 5\nresult_count: 1\nsources:\n  - url: "https:\/\/example.com\/harness"/);
  assert.match(content(result), /published_at: "2026-10-01T00:00:00Z"/);
  assert.match(content(result), /rerank_score: 2.4\n    authority: 3\n    snippet_truncated: false\ntruncated: false\n<\/metadata>$/);
  assert.doesNotMatch(content(result), /Unused full page|A source summary|test-web-key/);
  assert.throws(() => JSON.parse(content(result)), 'not a JSON envelope');
});

test('count boundaries, Unicode queries, zero matches and empty snippets are supported', async () => {
  const requests: Record<string, unknown>[] = [];
  const tools = webTools(key, async (_url, init) => { requests.push(JSON.parse(init!.body as string)); return json({ results: requests.length === 1 ? [] : [{ ...source, snippet: '', date: null, site_name: null }] }); });
  const empty = await invoke(tools, 'web_search', { query: '😀'.repeat(128), count: 1 });
  assert.equal(empty.isError, false);
  assert.match(content(empty), /No results found\./);
  assert.match(content(empty), /result_count: 0\nsources: \[\]/);
  assert.equal(requests[0]!.count, 1);
  const fallback = await invoke(tools, 'web_search', { query: 'test', count: 50 });
  assert.equal(fallback.isError, false);
  assert.equal(requests[1]!.count, 50);
  assert.ok(!Object.hasOwn(requests[1]!, 'ori_question'));
  assert.match(content(fallback), /Agent harness/);
  assert.doesNotMatch(content(fallback), /A source summary|Short snippet/);
  assert.match(content(fallback), /published_at: null/);
});

test('fetch forwards only the requested URL and preserves Markdown with attribution metadata', async () => {
  const url = 'https://example.com/article?language=en';
  const tools = webTools(key, async (endpoint, init) => {
    assert.equal(endpoint, 'https://api.deepseek.com/v1/tools/fetch');
    assert.deepEqual(JSON.parse(init!.body as string), { url });
    return json({ title: 'Article', content: '# Original heading\n\n- Point\n\n```ts\nconst a = 1;\n```' });
  });
  const result = await invoke(tools, 'web_fetch', { url });
  assert.equal(result.isError, false);
  assert.match(content(result), /^## Article\n\n# Original heading\n\n- Point/);
  assert.match(content(result), /```ts\nconst a = 1;\n```/);
  assert.match(content(result), /url: "https:\/\/example.com\/article\?language=en"/);
  assert.match(content(result), /title: "Article"/);
});

test('invalid and unknown inputs are refused before HTTP, including embedded credentials', async () => {
  let calls = 0;
  const tools = webTools(key, async () => { calls++; return json({}); });
  for (const args of [{}, { query: '' }, { query: '   ' }, { query: '😀'.repeat(129) }, { query: 'x', count: 0 }, { query: 'x', count: 51 }, { query: 'x', count: 1.5 }, { query: 'x', count: null }, { query: 'x', original_question: '' }, { query: 'x', original_question: 'x'.repeat(129) }, { query: 'x', original_question: null }, { query: 'x', filters: {} }, { query: 'x', apiKey: key }]) {
    const result = await invoke(tools, 'web_search', args);
    assert.equal(result.isError, true);
    assert.match(content(result), /error_code: "invalid_arguments"/);
  }
  for (const args of [{}, { url: '' }, { url: '/relative' }, { url: 'file:///etc/passwd' }, { url: 'https://user:password@example.com' }, { url: 'https://example.com/' + 'x'.repeat(8192) }, { url: 'https://example.com', prompt: 'instructions' }]) {
    const result = await invoke(tools, 'web_fetch', args);
    assert.equal(result.isError, true);
    assert.match(content(result), /error_code: "invalid_arguments"/);
  }
  assert.equal(calls, 0);
  for (const tool of tools) assert.equal((tool.definition.parameters as { additionalProperties?: boolean }).additionalProperties, false);
  assert.throws(() => validateToolArguments(tools[0]!.definition, { type: 'toolCall', id: '1', name: 'web_search', arguments: { query: 'x', count: 51 } }));
});

test('missing configuration fails without HTTP and provider HTTP errors expose only safe metadata', async () => {
  const missing = webTools(undefined, async () => { throw new Error('must not call HTTP'); });
  const result = await invoke(missing, 'web_search', { query: 'test' });
  assert.equal(result.isError, true);
  assert.match(content(result), /web_not_configured/);
  for (const status of [400, 401, 402, 403, 404, 408, 429, 500, 504]) {
    let calls = 0;
    const tools = webTools(key, async () => { calls++; return new Response(`Provider error containing ${key}`, { status }); });
    const result = await invoke(tools, 'web_fetch', { url: 'https://example.com' });
    assert.equal(result.isError, true);
    assert.equal(calls, 1, 'no automatic retries');
    assert.match(content(result), new RegExp(`http_status: ${status}`));
    assert.match(content(result), new RegExp(`retryable: ${[408, 429].includes(status) || status >= 500}`));
    assert.doesNotMatch(content(result), /Provider error containing|test-web-key/);
  }
  const network = webTools(key, async () => { throw new Error(key); });
  const failure = await invoke(network, 'web_search', { query: 'test' });
  assert.match(content(failure), /web_network_error/);
  assert.doesNotMatch(content(failure), /test-web-key/);
});

test('malformed provider data fails and accidental credential echoes are removed from successful output', async () => {
  for (const data of [{}, { results: null }, { results: [{}] }, { results: [{ ...source, snippet: 123 }] }, { results: [{ ...source, date: 123 }] }]) {
    const tools = webTools(key, async () => json(data));
    const result = await invoke(tools, 'web_search', { query: 'test' });
    assert.equal(result.isError, true);
    assert.match(content(result), /web_invalid_response/);
  }
  for (const data of [{ title: 'Title', content: '' }, { title: 1, content: 'body' }, { title: 'Title' }]) {
    const result = await invoke(webTools(key, async () => json(data)), 'web_fetch', { url: 'https://example.com' });
    assert.equal(result.isError, true);
    assert.match(content(result), /web_invalid_response/);
  }
  const malformedJson = await invoke(webTools(key, async () => new Response('not json')), 'web_search', { query: 'test' });
  assert.match(content(malformedJson), /web_invalid_response/);
  const echo = await invoke(webTools(key, async () => json({ title: key, content: key })), 'web_fetch', { url: 'https://example.com' });
  assert.equal(echo.isError, false);
  assert.doesNotMatch(content(echo), /test-web-key/);
  assert.match(content(echo), /\[redacted\]/);
});

test('oversized provider bodies fail; long Markdown is bounded without broken UTF-8 and marked truncated', async () => {
  for (const response of [new Response('{}', { headers: { 'content-length': String(4 * 1024 * 1024 + 1) } }), new Response('x'.repeat(4 * 1024 * 1024 + 1))]) {
    const result = await invoke(webTools(key, async () => response), 'web_fetch', { url: 'https://example.com' });
    assert.equal(result.isError, true);
    assert.match(content(result), /web_response_too_large/);
  }
  const result = await invoke(webTools(key, async () => json({ title: '', content: '😀'.repeat(30_000) })), 'web_fetch', { url: 'https://example.com' });
  assert.equal(result.isError, false);
  const [core] = content(result).split('\n\n<metadata>');
  assert.ok(Buffer.byteLength(core!) <= 64 * 1024);
  assert.doesNotMatch(core!, /�/);
  assert.match(content(result), /Content truncated at the tool output limit/);
  assert.match(content(result), /truncated: true/);
  assert.match(content(result), /url: "https:\/\/example.com"/);
});

test('search snippets are bounded per result and verbose summaries never enter output', async () => {
  const sources = [
    { ...source, snippet: '😀'.repeat(301), summary: 'VERBOSE_SUMMARY'.repeat(1000) },
    { ...source, title: 'Empty snippet', snippet: '', summary: 'DO_NOT_FALL_BACK' },
    { ...source, title: 'Exact boundary', snippet: '😀'.repeat(300) },
  ];
  const result = await invoke(webTools(key, async () => json({ results: sources })), 'web_search', { query: 'test' });
  assert.equal(result.isError, false);
  const text = content(result);
  const excerpt = text.split('https://example.com/harness\n\n')[1]!.split('\n\n### 2.')[0]!;
  assert.equal([...excerpt].length, 300);
  assert.ok(excerpt.endsWith('…'));
  assert.doesNotMatch(text, /VERBOSE_SUMMARY|DO_NOT_FALL_BACK|�/);
  assert.match(text, /snippet_truncated: true/);
  assert.match(text, /truncated: true\n<\/metadata>$/);
  assert.equal((text.match(/snippet_truncated: false/g) ?? []).length, 2);
  assert.match(text, /### 2\. Empty snippet\nhttps:\/\/example.com\/harness/);
  assert.ok(text.includes('😀'.repeat(300)), 'an exactly 300-character snippet is preserved');
});

test('run cancellation reaches HTTP and stays cancellation; pre-cancelled runs make no request', async () => {
  const controller = new AbortController();
  let seen: AbortSignal | undefined;
  const tools = webTools(key, async (_url, init) => new Promise((_resolve, reject) => {
    seen = init!.signal as AbortSignal;
    seen.addEventListener('abort', () => reject(seen!.reason), { once: true });
  }));
  const result = invoke(tools, 'web_fetch', { url: 'https://example.com' }, controller.signal);
  assert.ok(seen);
  controller.abort(new Error('run stopped'));
  await assert.rejects(result, /run stopped/);
  assert.equal(seen.aborted, true);
  await assert.rejects(invoke(webTools(key, async () => { throw new Error('unexpected HTTP'); }), 'web_search', { query: 'test' }, controller.signal), /run stopped/);
});

test('30-second deadline aborts HTTP and returns a retryable timeout result', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const tools = webTools(key, async (_url, init) => new Promise((_resolve, reject) => {
    const signal = init!.signal!;
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }));
  const pending = invoke(tools, 'web_fetch', { url: 'https://example.com' });
  t.mock.timers.tick(30_000);
  const result = await pending;
  assert.equal(result.isError, true);
  assert.match(content(result), /error_code: "web_timeout"/);
  assert.match(content(result), /retryable: true/);
});

test('cancellation also aborts real HTTP body consumption after response headers arrive', async () => {
  let bodyStarted!: () => void;
  const started = new Promise<void>(resolve => { bodyStarted = resolve; });
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.write('{"title":"Page","content":"');
    bodyStarted(); // Deliberately leave the response body unfinished.
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const controller = new AbortController();
  try {
    const port = (server.address() as { port: number }).port;
    const tools = webTools(key, (_url, init) => fetch(`http://127.0.0.1:${port}`, init));
    const pending = invoke(tools, 'web_fetch', { url: 'https://example.com' }, controller.signal);
    await started;
    controller.abort(new Error('body read cancelled'));
    await assert.rejects(pending, /body read cancelled/);
  } finally {
    controller.abort();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
