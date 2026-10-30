# Workspace

## Purpose, responsibilities and boundaries

Own workspace registration/creation, project directory/configuration, workspace model choices, design tree and design/implementation context documents, file indexing/history and project file access. Team owns member/chat/configuration records; Agent owns execution/context/history persistence. Workspace aggregates its core in-memory schema, durable model and related data operations in its own data-model part.

## Interface contract

Create/adopt/list/read workspaces; manage workspace-owned settings, design/context files, accepted mappings and file review. Core coordinates initial lead creation atomically with registration through Team. Preserve paths, revisions, accepted recursive working scopes and context history. Own workspace/context/models/baseline public records, file state, validation and management interfaces. Workspace’s own data-model part implements registry/context/model/baseline persistence. Core supplies public Team callbacks for atomic lead/bootstrap and default initialization; Workspace does not interpret or write Team/Agent SQL records. Reusable context/file services may accept Workspace’s own persistence port.

### Initialization with existing context (legacy workspaces)

Creating/adopting a workspace preserves existing `.rsi/context/` content byte for byte. Add only missing root metadata, design and implementation context; honor the single-file and directory forms. Existing context is the initial context/history and accepted design baseline. A fresh lead is assigned the root design. Existing database registrations/overlaps remain conflicts.

Expose read-only inspection returning the canonical directory, nonempty non-context `.rsi` paths and a cleanup revision. Empty non-context directories are allowed. Nonempty metadata requires the user to review/confirm cleanup; creating without that revision or with a changed revision fails before modifying files. Confirmation authorizes removal only outside `.rsi/context/`. Refuse symbolic managed/context roots and case collisions. On preparation/registration failure, preserve existing context and restore staged metadata, removing only this attempt's additions. Successful cleanup creates fresh filesystem/SQL runtime/member state; it does not recover prior conversations or member configuration. Filesystem staging is not a crash recovery journal.

### Settled context organization: target structure

New workspaces use this structure. Existing legacy `.rsi/context/` workspaces retain the preservation/bootstrap contract above until explicitly migrated. Initialization of a new-format workspace preserves its project-named context byte for byte and adds only a missing root `_ctx/DESIGN.md`; it does not invent a usage contract or initialize an internal-context format. The fresh lead is assigned `_ctx/DESIGN.md`. Cleanup excludes the selected context root and requires revision-bound user consent for other nonempty RSI state. Rollback restores staged state and removes only this attempt's additions. Discover an existing project-named root across checkout renames; refuse ambiguous, linked or conflicting roots rather than choosing one silently. Use the project directory name for a new context root, independently of the workspace display name.

Aggregate project context under `.rsi/<project-name>/`, with the project name as the root directory rather than `context`. Inside that root, mirror the actual project directory and file paths. Keep context separate from source files; do not place context directories alongside project source. Other RSI-managed information remains separate under `.rsi/`.

Organize context by project node first, with the different kinds of context together at each design part. Do not maintain separate top-level design and implementation trees.

- A project directory that represents a design part owns an `_ctx/` directory at its mirrored path. The whole project's context is in the project root's `_ctx/` directory.
- A project file that represents a design part owns a `<file-name>.ctx/` directory at its mirrored parent path. Retain the full original filename, including its extension.
- A context entry is always a directory, even when its content is small. `_ctx` is a reserved context entry name.
- Create context entries only for meaningful design parts. Do not require one for every source file or directory. Intermediate mirrored directories may exist only to preserve project paths.
- Context about files and directories that do not represent their own design part belongs inside the nearest enclosing design part's context directory. A parent describes its relationship with independently documented child design parts and references them; the child owns its detailed context.
- Splitting documents inside one context entry does not create additional design parts. Project child nodes and documents explaining the same design part are different concepts.

For this project, an illustrative structure is:

```text
.rsi/
  rsi-agent/
    _ctx/                         # Whole project design part
      DESIGN.md
      README.md
    backend/
      _ctx/                       # backend/ design part
        DESIGN.md
        README.md
      src/
        core/
          agent/
            _ctx/                 # agent/ directory design part
              DESIGN.md
              README.md
            agent.ts.ctx/         # Only if agent.ts is itself a design part
              DESIGN.md
              README.md
```

The example illustrates naming and location; it does not assign new design boundaries or require an independent context entry for `agent.ts`.

### Responsibilities within a design part's context

Each design part has three conceptual kinds of context:

1. **Design — `DESIGN.md`.** Maintain the user's design intent, requests, purpose, responsibilities, boundaries, requirements, constraints and architectural mental model. This is conceptual design guidance, not a requirement to specify a complete concrete protocol. It may leave implementation choices open. Agents implement based on this design; a change to the user's intent or constraints is a design change that must be visible to the user.
2. **Usage contract — optional `README.md`.** The agent maintains a clear, concrete description of the implemented design part from its consumer's perspective. Describe what it provides and how to use it: supported interactions/interfaces, required inputs, returned information, observable effects, failure behavior, relevant lifecycle rules and guarantees, and usage examples. A consumer may be a person or another component. The contract must describe the actual implementation consistently with the user's design and enable use without requiring knowledge of internal implementation details. README is the entry document for this purpose, not a miscellaneous collection of internal development notes. A design part may have no README for now; do not synthesize one from incomplete or mixed notes merely to fill the structure.
3. **Internal context.** The agent maintains information for reuse and consistency across long-term development, including implementation understanding and quick lookup of relevant files. Its detailed contents, filenames, structure and maintenance mechanisms remain deferred. Do not prescribe a new internal-context schema as part of this agreement.

These responsibilities apply equally to directory and file design parts. Documentation for non-design children is maintained by their enclosing owner within these context parts rather than by creating independent `.ctx/` entries.

## Constraints, specifications and requirements

Preserve existing public HTTP/SSE payloads, stable SQL/JSON formats, ordering, authority and lifecycle behavior. Workspace owns both its core in-memory model and durable representation, schema, mapping, validation, queries and related operations. Technical Storage supplies engine resources only. Share explicit interface values and lifecycle notifications; keep private runtime state and SQL schemas inside their respective owners. Filesystem/tool effects can precede failures and are never automatically replayed.
