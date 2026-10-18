import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { readSse } from '../../../frontend/src/client/sse.js';
const base = 'http://127.0.0.1:4283';
const info = await (await fetch(base + '/workspaces/load/info')).json() as { pid: number; workspaceId: string };
const pids = [74245, 74305, 6168];
function cpuSeconds(text: string) { return text.split(':').reverse().reduce((sum, n, i) => sum + Number(n) * 60 ** i, 0); }
function host() {
  return Object.fromEntries(execFileSync('ps', ['-p', pids.join(','), '-o', 'pid=,time=,rss='], { encoding: 'utf8' }).trim().split('\n').map(line => { const [pid, cpu, rss] = line.trim().split(/\s+/); return [pid!, { cpu: cpuSeconds(cpu!), rssKiB: Number(rss) }]; }));
}
function percentile(values: number[], p: number) { const sorted = values.toSorted((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]; }
const results: unknown[] = [];
for (const spec of [
  { label: 'idle', duration: 10, rate: 45, chunkSize: 16, workers: 0 },
  { label: 'single-member', duration: 20, rate: 45, chunkSize: 16, workers: 1 },
  { label: 'four-parallel-members', duration: 20, rate: 45, chunkSize: 16, workers: 4 },
]) {
  const before = host(), start = performance.now();
  const ack = await (await fetch(base + '/workspaces/load/start', { method: 'POST', body: JSON.stringify(spec) })).json() as { runs: { runId: string; agentId: string }[] };
  assert.equal(ack.runs.length, spec.workers);
  const roster = await (await fetch(base + `/workspaces/${info.workspaceId}/team`)).json() as { members: { memberId: string; name: string }[] };
  const readers = ack.runs.map(async run => {
    const response = await fetch(base + `/agents/${run.agentId}/follow?runId=${run.runId}&after=0`);
    assert.ok(response.ok); let bytes = 0, gaps = 0, deltaCount = 0, status; const arrivals: number[] = [];
    for await (const frame of readSse(response.body!)) {
      bytes += Buffer.byteLength(frame.data); const event = JSON.parse(frame.data);
      if (event.type === 'gap') gaps++;
      if (event.type === 'chunk' && event.event.type === 'text_delta' && event.event.contentIndex === 0) { arrivals.push(Date.now()); deltaCount++; }
      if (event.type === 'end') status = event.run?.status;
    }
    assert.equal(status, 'completed'); assert.equal(gaps, 0); assert.equal(deltaCount, spec.duration * spec.rate);
    return { agentId: run.agentId, name: roster.members.find(m => m.memberId === run.agentId)!.name, bytes, gaps, deltaCount, arrivals };
  });
  const measured = await (await fetch(base + '/workspaces/load/result')).json();
  const clients = await Promise.all(readers), elapsed = (performance.now() - start) / 1000, after = host();
  const latency: number[] = [];
  for (const client of clients) {
    const ticks = Object.entries(measured.ticks).find(([key]) => key.startsWith(client.name + ',') || key.startsWith(client.name + ':'))?.[1] as number[] | undefined;
    assert.ok(ticks, `ticks for ${client.name}`);
    client.arrivals.forEach((at, i) => latency.push(at - ticks[i]!));
  }
  delete measured.ticks;
  const row = { ...measured, clients: clients.map(({ arrivals, ...rest }) => rest), latencyMs: { p50: percentile(latency, .5), p95: percentile(latency, .95), max: latency.length ? Math.max(...latency) : null }, hostCpuPercent: Object.fromEntries(pids.map(pid => [pid, (after[pid]!.cpu - before[pid]!.cpu) / elapsed * 100])) };
  results.push(row); writeFileSync(new URL('./raw-results.json', import.meta.url), JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify({ label: spec.label, cpu: row.backendCpuPercent, rssPeakMiB: row.rssPeakMiB, sqlBytesPerSecond: row.sqlDelta.Bytes_sent / row.seconds, sqlQuestionsPerSecond: row.sqlDelta.Questions / row.seconds, latency: row.latencyMs, hostCpu: row.hostCpuPercent }));
}
