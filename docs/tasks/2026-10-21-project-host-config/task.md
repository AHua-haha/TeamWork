# Project-owned host configuration

Status: complete
Task start commit: ca2e9e25ae1b0670aea7c1f262abed984fe6ea97
Review boundaries: [Deployment](drafts/host-deployment/design.md), [Development](drafts/local-dev/design.md), [Shared database](drafts/shared-database/design.md).

## Design outcomes

- delivered: consolidate all dev/deploy operator inputs in ignored project-root rsi.config.json with one shared MySQL address and independent environment sections.
- delivered: use configuration-derived child settings; ambient application/Node/Compose variables and legacy env files do not override them. Do not modify caller/global environment, shell profiles, Docker global settings or unrelated services.
- delivered: import existing credentials/keys/data identities once, keep old files untouched, validate private configuration and verify service isolation.

## Decisions and open questions

The user corrected the initial proposed external location: the sole configuration belongs under this project. Default rsi.config.json at the root; public rsi.config.example.json describes its shape. Keep existing deployment source selection/state and the shared MySQL project/volume. One-time import preserves current settings and refuses conflicting legacy addresses; later edits to legacy files are ignored. File permissions prevent other OS users reading secrets, but cannot stop deliberate edits by the same OS user. No unresolved design choices.

## Checkpoints and remaining work

Implemented a single project configuration reader, exact schema validation, private atomic one-time import, structured shared MySQL settings and explicit per-environment backend inputs. All lifecycle/direct backend npm entry points use it. Shell wrappers remove Node startup injection only from their child environment; services receive a clean host allowlist and configured values. Compose uses an explicit context/project/file/directory/empty env-file and --no-recreate. Vite disables env-file loading. Legacy env files remain untouched and ignored after import; the obsolete env example is retired. Private config is ignored by Git and deployment refuses revisions that track it.

Real project rsi.config.json was created with mode 0600. Verified exact preservation of both database URLs and encryption keys, stored configuration fingerprints, old environment file bytes and the existing MySQL container. Both environments had no active runs at the initial baseline; deployment then had 2 workspaces, 10 agents, 525 private messages and 69 shared messages. User activity subsequently added messages.

Operational failure: a later idle precheck detected an active deployment run, but a shell newline allowed the following restart command to execute anyway. This was a sequencing mistake, not an approved idle restart. The run was cancelled; its 10 completed private working messages remain durable. The error was disclosed to the user. Deployment was restored on the same b2734b1 release at ports 3001/5274. Readiness, unchanged config/key/file/container identities and nondecreasing history counts were verified afterward (535 private messages and 70 shared messages at that check). No further live restarts were performed.

Verification covers real fixture archives/builds/processes, build/launch recovery, private config exclusion, split/unsplit credential import, stale legacy files, corrupted/private-file validation, polluted environments, concurrent commands, foreign port/PID preservation, development-stop isolation, foreground backend configuration, credential encoding and streamed frontend proxying. All 12 lifecycle/proxy/config tests and both application builds passed (existing frontend bundle warning remains). Eight canonical documents match the completed drafts; [test evidence](tests.jsonl) retains failures and corrections. No paid model requests or database resets were performed. Only managed deployment processes were restarted; no unrelated service or shared database container was stopped or replaced. No remaining implementation work.
