<!-- Task proposal; promote with implemented and verified source. -->
# Harness

## Purpose, responsibilities and boundaries

Define what an agent can do and rules it follows. Own reusable tool integration, available capabilities, scope/permission policy, persistent Bash environment, explicit Git approval and maintenance prompts. Workspace supplies design/file information; Team supplies member authority/configuration.

## Interface contract

Resolve configured harnesses into tools and prompts; check permitted effects at invocation; expose approval requests/decisions and environment cleanup. Preserve native Pi tool formats, scoped write/edit, broad sandbox Bash, lifecycle/timeouts, user approval of explicit protected commits and operator permission bypass. Tools are reusable across agents. Harness does not schedule team members or own group/private message history.

## Constraints, specifications and requirements

Preserve existing public HTTP/SSE payloads, stable SQL/JSON formats, ordering, authority and lifecycle behavior. In-memory model ownership and durable persistence ownership are separate responsibilities and may belong to different systems. The persistence owner defines its durable representation, schema, mapping, validation and queries using the model owner's public interface. Technical Storage supplies engine resources only. Share explicit interface values and lifecycle notifications; keep private runtime state and SQL schemas inside their respective owners. Filesystem/tool effects can precede failures and are never automatically replayed.
