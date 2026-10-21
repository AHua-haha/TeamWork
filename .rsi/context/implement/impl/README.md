## Result summary

The backend design has been successfully restructured into a hierarchical five-layer organization on branch `feat/rsi-design-tree`.

**Design hierarchy completed:**
- **backend/** parent node created with layering documentation (five layers, import rules, labeled violations)
- **backend/foundation/** — 5 source files (types, codec, changes, text, tool-result)
- **backend/storage/** — 2 source files + compose.yaml + scripts (database, store interface)
- **backend/domain/** — 41 source files + backend/ root files (config, workspace, team, harness, agent runtime loop, all domain logic)
- **backend/api/** — 6 source files (http, routes, helpers, index, main as composition root)
- **backend/runtime/** — 1 source file (main.ts as process wiring)

**Old scattered backend nodes removed:**
- agent-runtime/, config/, database/, web-tools/, backend-foundation/, backend-api/ (flat feature nodes)
- All content consolidated into the new hierarchical structure

**Commits:**
- `658b40e` — Removed old flat backend design nodes and updated root design.md
- `e33e24a` — Added new backend/ hierarchy with all five layer designs

**Status:**
- Design tree now matches the physical code layout (backend/src/{foundation,storage,domain,api,runtime})
- All implementation mappings point to actual source files
- Build passes clean (`npm run build` successful)
- Working tree clean
- Implementation context not touched (as requested — will be updated after domain sub-splitting)

**Next step:** Further split domain/ into subdirectories (domain/config/, domain/workspace/, domain/team/, domain/harness/, domain/agent/) as the user requested.

## File lookup

| Path | Description |
| --- | --- |
| `.rsi/context/design/backend/design.md` | Backend parent node with five-layer documentation |
| `.rsi/context/design/backend/foundation/` | Foundation layer design node |
| `.rsi/context/design/backend/storage/` | Storage layer design node |
| `.rsi/context/design/backend/domain/` | Domain layer design node (to be further split) |
| `.rsi/context/design/backend/api/` | API layer design node |
| `.rsi/context/design/backend/runtime/` | Runtime layer design node |
| `.rsi/context/design/design.md` | Root design with updated backend reference |

## Automatic retrieval

```json
{
  "commands": []
}
```
