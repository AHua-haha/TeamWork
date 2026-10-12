# Design parts implementation

## Contract

[Design parts design](design.md). Preserve shared content/mapping identity, strict metadata validation and versioned attributed saves.

## Responsibilities and decomposition

DesignService owns the interpretation of a user-context file as a design, mapping validation, encoding, and inspect/read/save operations. The parent [context base](../design.md) owns files, revisions, attribution and durability. Harness and lead consume this semantic view. No separate design table or member-owned design store exists.

## Coordination and data flow

Normalize optional .context prefix and require user category. Validate exactly content/implementation fields, text limits, no duplicate implementation paths ignoring case and project path rules. Read parses a current context version; inspect also returns raw content/revision and a parsing issue so the lead can repair it. Save encodes one stable pretty JSON record and asks ContextBase.saveDesign to replace it with the supplied lead author, reason and revision. Content and mapping therefore share history and conflict protection.

## Decisions and constraints

Markdown content remains free-form; implementation metadata is structured because it defines authority. Hierarchy is represented by file paths and content references. Mappings can name future files. Case-insensitive comparisons follow workspace/context identity rules. No agent identities enter a design record.

## Code map

- [Design record validation and service](../../../../../backend/src/design.ts)
- Parent [context base implementation](../impl.md) owns persistence and the attributed save.

## Verification

[Lead tests](../../../../../backend/test/lead.test.ts) exercise serialized records, revisions, author and unchanged saves. [Harness tests](../../../../../backend/test/harness.test.ts) validate mappings and malformed-record repair. [MySQL integration](../../../../../backend/test/integration/backend.test.ts) checks design author/history persistence through the runtime.
