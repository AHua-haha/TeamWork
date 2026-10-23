# Team

## Purpose, responsibilities and boundaries

Own members and their active/file configuration, group chat/shared context, mention routing, admission/scheduling and member conversation construction. Decide who runs and when; Agent executes each individual run using Harness capabilities and Workspace information. Own durable persistence of agent execution information based on Agent's public in-memory state/messages/lifecycle interface, including restoration and interrupted-run recovery.

## Interface contract

Manage members, inspect/validate/activate committed changes, publish/follow/reset group chat, construct member context and route final responses. Shared history references durable private completed-message records maintained by Team from Agent output. Team maps Agent interface values into its own durable representation without reading private Agent internals. Reserve response slots and admit recipients atomically; preserve whole-publication refusal, idle atomic activation, shared-workspace single-member execution, retained failed history and processed-group boundaries. Own the durable application adapter: member/chat/context-boundary and agent execution/history schemas, mappings, migrations and queries, plus persistence of the public Workspace registry/context change contract. Workspace supplies its own record/change values; Team owns their SQL representation. Provider/application configuration persistence also resides here. Persist required completed records before announcing durable completion. Restore context/execution inputs through Agent's interface and mark abandoned runs interrupted without replaying tool effects. Workspace data is accessed through Workspace interfaces.

## Constraints, specifications and requirements

Preserve existing public HTTP/SSE payloads, stable SQL/JSON formats, ordering, authority and lifecycle behavior. In-memory model ownership and durable persistence ownership are separate responsibilities and may belong to different systems. The persistence owner defines its durable representation, schema, mapping, validation and queries using the model owner's public interface. Technical Storage supplies engine resources only. Share explicit interface values and lifecycle notifications; keep private runtime state and SQL schemas inside their respective owners. Filesystem/tool effects can precede failures and are never automatically replayed.
