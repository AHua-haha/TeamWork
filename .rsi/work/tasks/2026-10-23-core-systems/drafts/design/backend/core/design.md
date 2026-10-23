<!-- Task proposal; promote with implemented and verified source. -->
# Core

## Purpose, responsibilities and boundaries

Compose Agent, Harness, Workspace and Team. Coordinate workflows spanning them, including workspace/lead bootstrap and atomic group publication/run admission. Own common error/serialization/transaction plumbing; do not centralize child business schemas.

## Interface contract

Provide the existing application capabilities through composed services. Cross-system mutations preserve existing atomicity, lock order, conflict behavior and rollback through explicit owner interfaces. In-memory and durable ownership may differ: Agent maintains execution in memory and Team persists the required information from its public interface. Core composes these responsibilities; clients do not query another owner's tables.

## Constraints, specifications and requirements

Preserve existing public HTTP/SSE payloads, stable SQL/JSON formats, ordering, authority and lifecycle behavior. In-memory model ownership and durable persistence ownership are separate responsibilities and may belong to different systems. The persistence owner defines its durable representation, schema, mapping, validation and queries using the model owner's public interface. Technical Storage supplies engine resources only. Share explicit interface values and lifecycle notifications; keep private runtime state and SQL schemas inside their respective owners. Filesystem/tool effects can precede failures and are never automatically replayed.
