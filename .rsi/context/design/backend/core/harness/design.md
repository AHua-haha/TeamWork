# Harness

## Purpose, responsibilities and boundaries

Define what an agent can do and rules it follows. Own reusable tool integration, available capabilities, scope/permission policy, persistent Bash environment, explicit Git approval and maintenance prompts. Aggregate Harness configuration/resource/scope/tool-input/approval state and related operations under its data-model part. Current approvals/process resources remain session-local; no new durable Harness schema is introduced. Workspace supplies design/file information; Team supplies member authority/configuration.

## Interface contract

Resolve configured harnesses into tools and prompts; check permitted effects at invocation; expose approval requests/decisions and environment cleanup. Preserve native Pi tool formats, scoped write/edit, broad sandbox Bash, lifecycle/timeouts, user approval of explicit protected commits and operator permission bypass. Tools are reusable across agents. Harness does not schedule team members or own group/private message history. Maintain the compaction instruction as a release-owned prompt file, supplied to Agent through Runtime configuration. It explains the replacement boundary and preservation of all new messages, tool availability, original Team-owned group history, and Next steps when work remains. Agent owns estimation, trigger timing and cutover.

### Workspace deletion resources

Confirmed deletion of an idle workspace stops member persistent shells and their background jobs. This resource cleanup preserves all project and .rsi files. Existing commit/tool permission behavior remains unchanged.

### Design-edit responsibility prompts

All members receive the same design-edit responsibility rules independently of the permission switch: maintain assigned working designs and their accepted descendants, keep dependency designs read-only, report changes to the user and preserve user acceptance as a separate decision. The lead retains project-wide design responsibility and member configuration management. Changes outside assignment and unresolved design decisions require coordination. These instructions define responsibility, not new tool authorization: this change leaves the existing controlled write/edit gate (lead-only design writes), broad Bash and commit approval unchanged; tool refusals must be reported rather than bypassed.

## Constraints, specifications and requirements

Preserve existing public HTTP/SSE payloads, stable SQL/JSON formats, ordering, authority and lifecycle behavior. Each business owns its core in-memory model and any durable representation, mapping, validation, queries and related operations together. Harness uses other owners’ public interfaces, not their private persistence. Technical Storage supplies engine resources only. Share explicit interface values and lifecycle notifications; keep private runtime state and SQL schemas inside their respective owners. Filesystem/tool effects can precede failures and are never automatically replayed.
