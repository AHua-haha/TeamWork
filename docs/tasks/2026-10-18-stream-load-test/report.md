# Streaming workload results

Measured commit: `475542a8ce4048d47f10d77d8e5cdd32ebf48951`, 2026-10-18, on the user's Mac. Production code was unchanged during measurement.

## Conclusion

The new backend streaming path is inexpensive at the tested rates. The previous SQL chunk amplification is absent. The largest remaining variable cost is frontend React rendering during growing Markdown output, especially in the development build. Production substantially reduces that cost. Folding the working area currently hides it but still reconstructs its DOM.

## Method

An isolated MySQL 8.4 container, temporary project and real ConfigService/WorkspaceService/TeamSystem/AgentRuntime/HTTP server ran deterministic Pi-format output. Every run used real harness preparation/checkpointing and group publication. No provider calls, API keys, project tools or real workspace changes were used. Normal output: 45 deltas/s, 16 characters/delta, 20 seconds, about 14.4 kB per member. Parallel browser output: four members at 45 deltas/s for 15 seconds each. Large/fast output: 100 deltas/s, 32 characters/delta, 15 seconds, 48 kB for one member. Working content was Markdown; a small separate accepted final answer avoided conflating group publication limits with streaming performance.

The backend measured its own CPU time over the whole phase, sampled RSS/heap every 250 ms, and read isolated MySQL global counters before/after. Durations include admission/finalization and a 300 ms observation tail. Raw HTTP followers checked all delta counts, sequence continuity and completed run states; generation/receipt timestamps measured transport latency. Browser runs used the same procedure at 1440×1050 in a dedicated headless Chrome profile against Vite dev (5278) and the built production bundle (5279). OS cumulative CPU times/RSS were sampled every 500 ms. Percentages below mean 100% = one CPU core; they are phase averages, not laptop-wide CPU percentages. Host sampling boundaries can differ by about 500 ms. All browser telemetry, screenshot and CLI overhead was present in the test runs.

## Backend without browser rendering

| Workload | Runtime CPU | Peak runtime RSS | SQL output/s | SQL statements/s | Delta p95 latency |
| --- | ---: | ---: | ---: | ---: | ---: |
| Idle, 10 s | 0.94% | 247 MiB | 2.9 KiB | 2.5 | — |
| One member, 45 deltas/s | 4.14% | 247 MiB | 15.8 KiB | 11.9 | 2 ms |
| Four members, 180 deltas/s total | 9.10% | 249 MiB | 59.4 KiB | 33.7 | 1 ms |

Every reader received all expected deltas with zero gaps; observed maximum transport latency was 4 ms. Buffer occupancy stayed within 1,024 events per member. Counters include startup/completion and background database bookkeeping, not just progress. The preceding implementation tests separately prove that progress-only wakeups perform no SQL history reads, and the obsolete SQL chunk tables no longer exist.

## Browser workloads

| Workload | Backend CPU, dev / production | Renderer CPU, dev / production | Development long tasks >50 ms | Production long tasks >50 ms |
| --- | ---: | ---: | ---: | ---: |
| One visible member, normal rate | 4.1% / 4.3% | 31.6% / 16.0% | 0 | 0 |
| One folded member, normal rate | 4.2% / 4.8% | 27.0% / 10.1% | 0 | 0 |
| One visible member, large/fast | 4.6% / 5.3% | 81.4% / 28.5% | 18 | 0 |
| Four parallel members | 5.7% / 6.0% | 50.7% / 26.0% | 0 | 0 |

Development large/fast output reached a 379 ms longest JavaScript task and a 383 ms frame gap; p95 frame interval was 33.4 ms. Other development cases and every production case had p95 frame intervals around 16.7–16.8 ms. SQL output with the UI remained about 31–80 KiB/s, reflecting team polling and stable-message reads rather than token-by-token chunk transfer.

A separate Chrome CPU profile of the development large/fast path attributed 78.6% of active sampled JavaScript time to React rendering/reconciliation, 6.2% to Markdown parsing, 5.0% to garbage collection, and 0.23% to stream-client/projection work. These are sampled active-JavaScript shares, not percentages of total CPU or a production profile.

## Memory and idle behavior

The isolated backend's largest sampled RSS across these runs was about 249 MiB; values decreased as GC/reclamation ran. The active test renderer reached about 626–627 MiB during the development stress/parallel sequence; production cases peaked at about 453 MiB. The same browser process was reused, so these RSS peaks are not a clean isolated memory A/B. A subsequent 10-second idle check, retaining the completed production transcript, measured below 0.1% CPU for both runtime and renderer. Renderer RSS was then about 273 MiB; the runtime was about 216 MiB. This supports bounded short-run behavior, not a claim about long-term leak absence.

Docker host/VM CPU stayed relatively steady while output rates changed: roughly 4–5% host and 10–14% VM in the main cases, including both the application's database and the isolated fixture database. This is mostly baseline environment cost at the measured rates. It was far below the earlier streaming observation of 100–300% host and 90–155% VM. The earlier SQL result of about 127 MB/s and Node 41–70% was a different response/session, so those figures are observational reference, not a matched A/B percentage improvement.

## Remaining optimization opportunities

1. Skip Markdown/React subtree construction when work is folded; keep consuming compact events and rebuild the view when expanded. Current `ResponseContent` computes `runActivity` and maps Markdown components inside a hidden element on every update.
2. Coalesce display notifications/rendering to a frame or suitable UI cadence while consuming all ordered events. This matters most at 100+ deltas/s or with parallel members.
3. Reuse already rendered Markdown blocks and update the growing tail. `Markdown` reparses its changed full source and rebuilds all block elements; the memo does not help when the source grows every delta.
4. Use the production bundle for sustained product review when HMR/debugging is unnecessary. It materially lowered CPU and eliminated the measured long-task stalls here.

The backend FIFO still scans at most 1,024 entries for a read; at the tested rates its CPU is modest. Optimizing that lookup is a lower priority than frontend rendering. Tool execution, dependency installation/builds, filesystem-heavy tasks, paid provider latency and long unattended conversations were outside this streaming-only workload.

## Evidence and cleanup

- `raw-results.json`: backend/SQL/transport measurements.
- `browser-results.json`, `browser-production-results.json`: UI metrics, process averages and memory samples.
- `browser-host-samples.jsonl`, `browser-host-production-samples.jsonl`: OS sample evidence.
- `ui-profile.json`: separate Chrome JavaScript profile summary.
- `post-idle.json`: cooldown measurement.
- `environment.json`: production preview origin and built asset confirmation.
- `previous-observation.json`: earlier observational baseline.
- `tests.jsonl`: exact workload/verification commands and starting commit.

Temporary frontend/backend/container/browser processes were closed. The real app on ports 3000/5273 and its workspace data were preserved. No production changes were made by this task.
