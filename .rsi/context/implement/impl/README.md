# Implementation context

Design: `metadata.json`

## Result summary

The project-wide design tree has been created under `.rsi/context/design` from the existing system documentation in `docs/systems`, on branch `feat/rsi-design-tree`.

Structure: 19 design nodes with `metadata.json` implementation mappings — `agent-runtime`, `config`, `database`, `harness` (+ `tools`, `tools/bash`), `workspace-agent` (+ `workspace`, `context-base`, `team` (+ `group-chat`, `conversation-context`, `lead`)), `web-tools`, `frontend` (+ `group-chat`), `operations` (+ `local-dev`, `host-deployment`, `shared-database`). Every node carries purpose/responsibilities/boundaries, an interface contract (inputs, outputs/effects, failure behavior, guarantees) and constraints/specifications/requirements. The root `design.md` summarizes the whole product and links each subsystem.

Implementation context is intentionally left as placeholders: only this root `impl/README.md` exists. Each working member creates and maintains its own working nodes' `impl/README.md` Implemented contract.

Pending for the user: the design/member commit (`.rsi/context/design`, `.rsi/members`) needs user acceptance; the five new members (Runtime, Storage, Workspace, Team, Frontend) need separate user activation before they can run. `validate_member_config` still reports `not_found` design references until the design files are committed, because validation reads the committed design.

Known problems: none outstanding in the design text itself. `docs/systems` remains the previous canonical documentation and was copied, then reorganized to the three required sections; further drift between the two trees should be resolved by treating `.rsi/context/design` as the agreement.

## File lookup

| Path | Description |
| --- | --- |
| `.rsi/context/design/design.md` | Root product design: purpose, interface contract, constraints, subsystem index |
| `.rsi/context/design/metadata.json` | Root node implementation mapping (empty: lead owns no source) |
| `.rsi/context/design/<node>/design.md` | Per-node design documents |
| `.rsi/context/design/<node>/metadata.json` | Per-node implementation path mappings |
| `.rsi/members/<id>/member.json` | Member manifests for the five workers plus Lead |
| `.rsi/members/<id>/prompts/member.md` | Per-member supplementary instructions |
| `.rsi/context/implement/impl/README.md` | This file |
| `docs/systems/` | Original system documentation the design tree was derived from |
| `backend/src/` | Backend implementation mapped by the design nodes |
| `frontend/src/` | Frontend implementation mapped by the frontend nodes |
| `scripts/` | Lifecycle scripts mapped by the operations nodes |

## Automatic retrieval

```json
{
  "commands": []
}
```
