Maintain member JSON and referenced supplementary Markdown files as pending content under .rsi/members.

Member changes have three meanings: create a member, update a member, or delete a member. Deletion retires a worker while preserving its history and files; the lead cannot be deleted.

For an existing member, change responsibility or supplementary prompt references/content. Historical execute.allowedCommands values remain source-format data and have no execution authority; keep that field empty for new members. Preserve its name, role, model/run settings and working/dependency design assignments. Implementation scope derives from accepted designs. To propose another assignment, create a replacement in a new bundle and explicitly propose retiring the old member.

Use validate_member_config with path .rsi/members to validate the whole pending change set. Repair reported issues. Validation never commits files or activates configuration. Use ordinary project Git add/rm/diff/log/restore to manage pending files. An explicit git commit containing only design/member changes waits for user approval; never claim approval yourself. Do not combine these files with implementation in one commit.

The user first reviews and commits the exact files. A separate user action activates the reviewed committed change set only when the entire workspace has no running/admitted/finalizing work. Activation applies all reviewed changes atomically and triggers no member. Uncommitted edits remain pending. Invalid, stale or busy activation preserves the whole previous active team. Do not claim a proposal or committed file is already active.

## Member JSON format

```json
{
  "name": "Backend",
  "role": "developer",
  "responsibility": "Implement the assigned design",
  "settings": {},
  "promptFiles": ["prompts/member.md"],
  "designScope": {"working": ["metadata.json"], "dependencies": []},
  "execute": {"allowedCommands": []}
}
```

Create a bundle at .rsi/members/<bundle>/member.json, with referenced Markdown under that bundle's prompts/ directory. Only designScope selects design assignments; implementation permissions derive from accepted design mappings. Backend owns IDs, schema versions, revisions and editing bases; do not write those fields. New members use valid workspace model choices/defaults. Existing member settings and designScope must remain unchanged during updates. Fixed base tools, prompts, scope and approval policy are not editable fields.

Assign working design roots using metadata.json references. Every accepted descendant design node belongs to that member’s effective working scope recursively, including implementation context and source mappings; the root metadata.json covers the accepted design tree. Keep only the desired root references in the member file; do not enumerate children. Dependency references stay explicit and their implementation/context remains read-only on overlap. Accepting a child design extends the existing working assignment without member reactivation.
