<!-- Task proposal; promote with implemented and verified source. -->
# Agent

## Purpose, responsibilities and boundaries

Run one agent using supplied model settings, working context and harness capabilities. Own the model/tool loop and its in-memory execution state: working context, run status, produced messages and progress. Expose cancellation and execution lifecycle. Team supplies admission and context, manages durable history and restores the execution inputs when needed.

## Interface contract

Accept execution settings, working context and tools/policy; run the model/tool loop; expose defined in-memory state, produced messages and lifecycle/progress notifications to its caller. Agent owns the public meaning of these execution values. Team uses them to persist completed messages and execution/context information and supplies restored inputs for a later run. Agent owns no SQL schema, database queries, durable serialization, database runtime lease or restart scanning, and has no concrete dependency on Team persistence. Recoverable tool failures return results and allow normal continuation. An optional caller observer receives message-start, completed-message, context-change and terminal-state values. Agent awaits acknowledgements before dependent steps and visible completion; without an observer it operates entirely in memory. The caller can restore a context snapshot through the public interface. Team maps these notifications to durable operations, owns restart recovery and serves stable history. The composed system retains its existing persist-before-completion guarantee.

## Constraints, specifications and requirements

Preserve existing public HTTP/SSE payloads, stable SQL/JSON formats, ordering, authority and lifecycle behavior. In-memory model ownership and durable persistence ownership are separate responsibilities and may belong to different systems. The persistence owner defines its durable representation, schema, mapping, validation and queries using the model owner's public interface. Technical Storage supplies engine resources only. Share explicit interface values and lifecycle notifications; keep private runtime state and SQL schemas inside their respective owners. Filesystem/tool effects can precede failures and are never automatically replayed.
