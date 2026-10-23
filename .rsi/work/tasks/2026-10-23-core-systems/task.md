# Core systems

Status: complete
Task start commit: 59dcf1ea2f2c9d32ad2027f15a7055316d62773f
Review boundary: Core and its Agent, Harness, Workspace and Team systems.

## Delivered design

Persisted the four-system design before source migration, then refined it with the user's ownership clarification: a business system can maintain only in-memory data, and its caller can persist public values. Persistence is optional and explicitly assigned, not an obligation of business ownership.

- Agent owns the in-memory model/tool loop, context, status, produced messages and progress. It is usable without a persistence provider.
- Harness owns capabilities, operating rules/prompts, permission enforcement, tools and execution resources.
- Workspace owns project registration/configuration, files, design/context information and its public persistence contract.
- Team owns membership/cooperation, group context, scheduling and the current durable application adapter. It persists Agent outputs and implements Workspace's injected registry/context persistence port. Team defines durable mappings/schema/queries and recovery.
- Parent Core composes workflows/common helpers, including workspace/initial-lead bootstrap and administrative reset.

Canonical contracts and matching implementation contexts are under .rsi/context at backend/core and the four child paths. Supporting behavior references moved with their owner. The tree contains twelve design nodes in total. See decisions.md for the chosen callback/data-flow contract.

## Implementation

Source now follows backend/src/core/{agent,harness,workspace,team}. AgentExecution uses optional acknowledged AgentObserver callbacks, with no Team, SQL, storage or durable codec dependency. TeamRuntime hosts it for existing solo/member APIs and TeamData supplies persistence. The former AgentRuntime/CoreData names moved to TeamRuntime/TeamData; no duplicate old loop or forwarding implementation remains.

Team restores context once after first-step preparation. Later calls use Agent memory; explicit host replacement and feedback update the live execution through its public interface. Completed records are persisted before visible completion. Terminal memory state remains available even when caller acknowledgement fails. Durable history/cursors, failed private ranges, single-member workspace execution, idle atomic activation, harness bypass and interrupted recovery preserve their existing behavior. SQL record/schema formats are unchanged.

## Verification

Every check, including the initial failed type check, final whitespace check and their fixes, is recorded in tests.jsonl with the full increment starting SHA.

Passed: 194 backend tests; 66 integration tests against disposable MySQL; backend type check/build; eight focused Agent/codec/boundary tests after common-helper extraction; twelve-node context/document/source-mapping/link checks; source and compiled startup/prompt assets.

New tests prove execution without persistence, caller acknowledgement ordering and failures, detached snapshots, and terminal in-memory state despite failed durable acknowledgement. The real Pi/SQL compaction integration proves one initial context restore followed by in-memory context maintenance while durable completed history remains immutable. Structural checks forbid Agent dependencies on SQL or concrete Team/Harness/Workspace systems. Existing integration covers restart recovery, partial/gap streaming, approvals, activation, reset, pictures and failure history.

## Safeguards and handoff

Worked on codex/lead-harness. No live database/workspace data, private settings, deployment or member activation was changed. No paid provider calls or frontend behavior changes were required. The pre-existing .gitignore Finder/.claude cleanup remains preserved outside this task commit. This is one consistent checkpoint, identified by Task-ID in Git; resulting commit SHA is supplied by Git history.

The agreed migration is complete. Further internal design can proceed from these four boundaries. No merge, push or deployment is included.
