# Workspace

## Purpose, responsibilities and boundaries

Own workspace registration/creation, project directory/configuration, workspace model choices, design tree and design/implementation context documents, filesystem context discovery and project file access. Team owns member/chat/configuration records; Agent owns execution/context/history persistence. Workspace aggregates its core in-memory schema, durable model and related data operations in its own data-model part.

## Interface contract

Create/adopt/list/read workspaces; manage workspace-owned settings, design/context files, design bindings and file review. Core coordinates initial lead creation atomically with registration through Team. Preserve project paths, explicit recursive working scopes and public context metadata revisions. Own workspace/context/models/baseline public records, file state, validation and management interfaces. Workspace’s own data-model part persists registration and model settings; context documents remain on disk and their metadata index is disposable. Core supplies public Team callbacks for atomic lead/bootstrap and default initialization; Workspace does not interpret or write Team/Agent SQL records.

### Initialization and retirement of the old context base

Project context exists only in the project-named `.rsi/<project-name>/` tree. Preserve existing context files byte for byte; add only a missing root `_ctx/DESIGN.md`. Do not generate a README contract or impose an internal-context format. A fresh lead is assigned `_ctx/DESIGN.md`. Workspace creation/inspection returns registration information without a context-history overview and does not open a watcher, scan document contents into SQL or import an initial file-history sequence.

Nonempty non-context RSI state requires explicit revision-bound cleanup consent. Inspection is read-only. Initialization excludes the selected project context root from cleanup, creates the exact lead bundle, and registers the workspace/models/lead/member activation atomically. On failure, restore staged metadata and remove only this attempt's additions. Preserve source, Git and context files. Existing registry overlaps remain conflicts. Root discovery survives checkout-directory renames and rejects ambiguous, linked or conflicting roots. A new context root uses the project directory name independently of the display name.

The old ContextBase, SQL file-history APIs, watcher, document revision store, write-through-SQL operations and old design-content baselines are removed completely. An old `.rsi/context/` layout is unsupported and produces an explicit error without migrating or deleting its files. Historical member assignment names may still resolve through an explicit project reference map; this is not support for the old context base or old folder layout.

On schema initialization, retire the old context-history tables, `workspace_git_baselines`, `workspace_member_baselines` and the workspace context sequence column. There is no fallback file snapshot or managed Git data. Preserve workspace registration/models, active member configuration snapshots/activation, Agent context/message/history and Team group context/chat/history. Do not modify project Git or context files. Member activation belongs to Team and reads current files, independently of Git.

### Settled context organization

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
2. **Consumer context — optional `README.md` plus included source files.** The agent maintains README as the entry document describing the implemented design system, what it does and what it provides, with a clear usage contract and interaction protocol. A consumer may be a person or another component. Include relevant source files or directories to supplement the explanation; these may contain actual implementation, not only public types or entry points. The choice of supporting source is flexible, while the consumer-facing contract must be clear. README is not a miscellaneous collection of internal development notes. A design part may have no README for now; do not synthesize one from incomplete or mixed notes merely to fill the structure. Detailed content and metadata rules are defined below.
3. **Internal context.** The agent maintains information for reuse and consistency across long-term development, including implementation understanding and quick lookup of relevant files. Its detailed contents, filenames, structure and maintenance mechanisms remain deferred. Do not prescribe a new internal-context schema as part of this agreement.

These responsibilities apply equally to directory and file design parts. Documentation for non-design children is maintained by their enclosing owner within these context parts rather than by creating independent `.ctx/` entries.

### Context base manager: authority and lifecycle

Context-base management uses the filesystem-only manager. The previous SQL file-history subsystem is retired, not retained as a compatibility layer. Adopting README metadata in existing documents remains separate; do not migrate files or reset workspace, member, Agent or Team data as part of this cleanup.

The filesystem is the sole source of truth for current project context. The manager constructs a lightweight, derived in-memory model from it. Memory is disposable and reconstructed after restart; SQL snapshots, accepted Git baselines and cached document bodies must not become alternate authorities for the current context model. Historical records, if retained, are distinct from current filesystem truth. This context base is project information, not Agent working-message context or Team group-message context.

Agent file tools continue editing files directly. Editing does not require a special context-management tool, manager-owned filesystem operation layer or write-through database API.

Use explicit refresh, with no filesystem monitor and no background watcher-driven or periodic synchronization. A consumer asks the manager to refresh when it needs a current index, for example at the start of an agent activation. Do not refresh before every model call. Consumers may reuse one published model between refreshes, and an explicit refresh can be requested again when necessary. The index represents filesystem state observed during the last refresh; it does not promise live updates or an atomic filesystem snapshot across arbitrary external multi-file edits.

A refresh enumerates the relevant project source tree and context tree, discovers design systems, reads/parses the required metadata, constructs bindings and publishes the completed in-memory model. Retain paths, relationships, document existence, parsed metadata and diagnostics, not README bodies, DESIGN prose or included source contents. Parsing document metadata necessarily reads its header, but does not require retaining the document body or reading included source files during refresh. Source bodies are read only when a consumer requests their content. Exact source-tree filtering, size limits, caching, refresh concurrency and error/revision API mechanics remain implementation details to settle; avoid expanding a metadata refresh into eager content assembly.

### Project tree and explicit design-system bindings

The primary tree represents actual project directories and files. A design system is a separate entity bound to the project node represented by its design context directory:

- A directory node can bind to its mirrored `_ctx/` entry.
- A file node can bind to its mirrored `<full-file-name>.ctx/` entry.
- `DESIGN.md` is the required design document; README is optional. An incomplete context entry can be diagnosed rather than treated as a complete valid design system.
- Nodes without their own design system remain structural source nodes. Do not store or display an inherited binding to their enclosing design system.
- Context ownership by the nearest enclosing design system still applies to non-design files and directories, but it is not a binding on every source node.
- Internal context documents and supporting README inclusions do not create additional design systems.

For example:

```text
Project                         -> Project design
└── backend/                    -> Backend design
    └── src/
        └── agent/              -> Agent design
            ├── agent.ts        -> Agent-file design, if separately defined
            └── helpers.ts
```

Keep each design system's parsed metadata and document references once in the model; source tree nodes reference their bound design system rather than copying it. Structural identity, represented project path, parent/child relationships, context location and document existence are derived from filesystem structure, not overridden by agent-maintained metadata. Directory/file bindings refer to actual source nodes; inconsistent context entries should be inspectable through diagnostics rather than silently inventing source nodes.

### README content and metadata format

README is the consumer-context entry document. Its Markdown body describes the design system and its actual usable behavior. For each relevant endpoint, function, class, tool or other interaction, clearly explain:

- Purpose: what it does, what it provides, and when to use it.
- Input: parameters/data, formats and preconditions.
- Output: returned information and its meaning.
- Effects: observable changes to files, durable storage, runtime state or external systems.
- Guarantees: what consumers may rely on, including relevant ordering, consistency and lifecycle behavior.
- Expectations: responsibilities, assumptions and obligations placed on the consumer.
- Failures: errors, partial effects, and recovery or retry behavior.
- Usage examples: concrete ways to use the implemented behavior.

These are content responsibilities, not a requirement for a mechanically enforced heading template. The explanation can use prose and actual source to convey details. Included implementation files are allowed; do not enforce a public-interface-only restriction. Document actual behavior consistently with DESIGN rather than presenting planned behavior as implemented. Normal source README files and migrated internal implementation READMEs do not automatically become consumer-context documents.

Place agent-maintained metadata in a YAML front-matter header at the beginning of the context README, delimited by standalone `---` lines, followed by the Markdown body. The settled fields are:

| Field | Meaning |
| --- | --- |
| `summary` | A concise textual description of the design system for discovery, listing and display without loading its body. |
| `include` | A list of project-root-relative file or directory paths supplementing README as consumer context. |

For example:

```markdown
---
summary: Runs an agent's model and tool loop and maintains its execution context.
include:
  - backend/src/core/agent/
  - backend/prompts/agent/context-compaction.md
---

# Agent

Describe what the system does, the capabilities it provides, and its usage contract.
```

All include paths are relative to the project root, not the README directory, `_ctx/`, `.rsi/` or the project context root. A file includes that file. A directory recursively includes its files. Overlapping directory/file references are deduplicated. A trailing slash is a readability convention, not the authority for whether a referenced entry is a directory; inspect the filesystem. Detailed directory filtering, missing-path behavior and content-size handling remain deferred. Do not add an executable retrieval-command mechanism or a restriction to particular kinds of source files as part of this agreement.

The manager retains the parsed summary and include references as metadata. When consumer context is requested, load the README content and the included source contents from the filesystem. Referenced paths are not eagerly opened for content during metadata refresh. The consumer context is the README and its inclusions together; DESIGN expresses user intent, and internal context supports continued development. Neither is silently folded into consumer context merely because it shares the same context directory.

The metadata format and fields above are the current agreement. Exact parser library, validation limits, additional fields, DESIGN metadata schema, and metadata composition across documents remain deferred. Existing optional READMEs are not rewritten or claimed compliant merely by recording these rules.

## Constraints, specifications and requirements

Preserve existing public HTTP/SSE payloads, stable SQL/JSON formats, ordering, authority and lifecycle behavior. Workspace owns both its core in-memory model and durable representation, schema, mapping, validation, queries and related operations. Technical Storage supplies engine resources only. Share explicit interface values and lifecycle notifications; keep private runtime state and SQL schemas inside their respective owners. Filesystem/tool effects can precede failures and are never automatically replayed.

Fixed context-organization and maintenance prompt text is owned and packaged by File React Harness, not Workspace. Workspace provides document discovery and loading only; the initial project DESIGN template remains Workspace-owned.

### Context metadata for dependency refresh

The settled File React Harness refresh consumes the project design-system hierarchy and existing summary metadata for orientation. Only explicitly design-bound nodes receive summary text; structural nodes remain plain and the receiving member's recursive working designs are marked. Workspace remains the filesystem discovery/document-loading owner. The refresh loads a dependency README alone as agent-facing usage README context, without expanding include paths; missing documents are reported as `No README available.`. This narrower refresh use does not remove the general README include metadata or change other explicit consumer-loading APIs. The refresh runs only at its user-input checkpoint after 64 completed context messages and does not introduce filesystem monitoring or background document injection.
