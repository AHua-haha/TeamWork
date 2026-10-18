# Separate design and implementation context roots

Status: complete
Task start commit: b3eb5a80fbb36b1d8acad392c5bbbbca0798c0cf
Review boundaries: [Context layout](drafts/workspace-agent/context-base/design.md), [Harness authority](drafts/workspace-agent/harness/design.md)

## Design outcomes

- [delivered] Separate .rsi/context/design and .rsi/context/implement roots; implementation node hierarchy mirrors design nodes.
- [delivered] Lead can read/edit all design context; its implementation context and project source code follow accepted working/dependency designs. Other members read/follow working designs and edit their own implementation; dependency access remains read-only.
- [delivered] Preserve caller-facing Interface/Implemented contract guidance and independent document splitting vs subsystem decomposition.

## Decisions and open questions

Root placement under .rsi/context is settled. Existing per-node single-file/directory representation remains within the respective root. Design metadata/node identity stays on the design side; implementation context derives its matching location from that identity. Design acceptance remains user-only; edit permission does not imply commit permission. Other members lose design write/staging/restore authority.

User clarified: only design context is globally readable/editable by the lead. Its implementation context follows exact working/dependency design nodes; project code follows their accepted implementation mappings. Both roles retain read-only dependencies for implementation. Ordinary members cannot edit any design context. The clarified permissions are recorded below for design review.

## Checkpoints and remaining work

Implemented the approved split roots and working/dependency permission model. Bootstrap, semantic design reads, file/Bash/Git enforcement, base prompts, frontend document links and file controls agree with the new layout. Only lead management has a writable design part. Versioned read-only member design views hydrate accepted files, including additions, updates, tombstones and document-form changes. Per-node implementation history remains independently committed.

Verification is recorded in [tests.jsonl](tests.jsonl): 122 backend tests (121 passed; one environment-dependent filesystem-watcher test skipped), 62 frontend tests, 45 MySQL integration tests, both builds, packaged prompt/layout checks, actual HTTP frontend-proxy checks and browser Design/Team/Files navigation. The focused context suite also verifies existing read-only member views advance to the current accepted design. Draft/canonical sections, links and content are audited before commit.

All agreed behavior is implemented. Existing workspace data is preserved without automatic conversion/reset; old layout must be explicitly repaired or reset before using the new backend. Restart/rebuild loads updated code/prompts. Unrelated .claude/ and .DS_Store files are preserved. No merge or push is included.

## Current review summary

Permissions are organized as two parts: working scope and dependencies. Each contains design context, implementation context and implementation (actual project source/files). The backend resolves these components from role and assigned accepted designs; this is not a request for independent agent-authored implementation paths.

Working scope: the lead reads/edits all design context; other members read/follow only their working designs. Both roles read/edit exact working-node implementation context and accepted working source-code mappings. A working node can maintain implementation context even with an empty code mapping.

Dependencies: provide read-only design, implementation-context and source access. The lead's global working design-context scope already covers dependency designs, so it retains design management there while dependency implementation/context stays read-only. Read-only precedence applies to overlapping implementation/source mappings. Other members cannot edit any design context.

Design acceptance remains user-only; authorized implementation/context commits remain agent-controlled. Member management, separate user activation and execute allowances retain their existing boundaries. Implement the approved structure without resetting existing workspace data.
