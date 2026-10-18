# Streaming workload measurement

Status: complete
Task start commit: 475542a8ce4048d47f10d77d8e5cdd32ebf48951
Review boundary: resource use of the committed compact in-memory streaming implementation.

## Design outcomes
- [delivered] Measure actual runtime/HTTP/SQL and browser workload with deterministic model output in an isolated workspace/database.
- [delivered] Report CPU, memory, SQL traffic, stream delivery and remaining bottlenecks with explicit workload limits.

## Decisions
- Validation only; no production behavior changes or paid provider calls.
- Fixed-duration normal single-member, parallel-member, visible/folded UI and higher-rate cases. Preserve the real workspace and running app.
- Earlier measurements are observational reference, not a matched before/after benchmark.

## Checkpoints and remaining work
- Measured idle, single-member and four-member runtime/SQL load; normal, folded and fast Markdown in development and production browser builds; diagnostic JavaScript profile and cooldown.
- [Report](report.md) records results, limits and recommended follow-up. Workload commands are recorded in [tests.jsonl](tests.jsonl).
- Removed disposable services/container/browser. Confirmed real app ports 3000/5273 and database remain running.
- Validation only: production code and canonical contracts are unchanged. No remaining work in this measurement task.
