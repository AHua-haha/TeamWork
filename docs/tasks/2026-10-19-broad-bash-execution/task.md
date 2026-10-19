# Broad Bash execution

Status: complete
Task start commit: 82c282733c2fecd271904cf2bd241bdc2c998464
Review boundaries: [Harness](drafts/workspace-agent/harness/design.md), [Team](drafts/workspace-agent/team/design.md). Related runtime, workspace, web-tool and frontend drafts reconcile affected callers.

## Design outcomes
- [delivered] Every member can run arbitrary Bash; sandbox resource permissions replace executable admission.
- [delivered] Read project source broadly, write accepted working implementation only, keep management/Git and dependencies protected.
- [delivered] Discover installed toolchains, provide isolated writable home/caches/tmp, allow outbound network and local binding.

## Decisions and open questions
The user approved the broad prototype policy. Docker daemon/socket authority remains deferred and is not granted. Common file tools retain their design/member permissions. Git metadata selects the broker scope without changing normal Bash filesystem authority. Existing persisted command-rule fields remain source-format data only, with no execution authority; no workspace/member-source migration or activation is required. Inspection must describe the effective fixed policy rather than advertise old command allowances. Process timeout/output/lifetime limits remain unchanged.

## Checkpoints and remaining work
Implementation, canonical documents and final verification are complete; the task commit contains the finished design and code. Live smoke successfully installed is-number@7.0.0 from npm and ran offline uv sync using the installed macOS Python in a disposable project. Initial checks exposed and then corrected a nested read-deny composition issue, macOS DNSConfiguration/alias access, a stale tool-list assertion and a TypeScript overload inference error. All failed runs remain in tests.jsonl. Preserve unrelated .claude and .DS_Store files. No personal-todo files or member settings will be edited.

## Verification procedure
`execution-smoke.mts` is the repeatable macOS live-network probe: resolves Node/npm/uv/Docker binaries, installs a pinned small npm dependency in a disposable assigned directory and runs offline uv sync using the installed CommandLineTools Python. It never contacts a model provider, modifies personal-todo or requests Docker daemon access. Unit tests additionally verify localhost DNS/binding, isolated home/cache/secrets, source reads, scoped writes, partial effects and approval/Git boundaries. MySQL checks use the repository disposable-container runner.

## Final evidence
- Backend: 159 passing unit/HTTP tests; one pre-existing environment-dependent filesystem-watcher test skipped.
- Frontend: 76 tests passed.
- Disposable MySQL: 59 integration tests passed; the runner removed its test container.
- Backend and frontend builds passed; the frontend retains its existing bundle-size warning.
- Live macOS smoke: Node/npm/uv visible; an npm package downloaded/installed successfully; offline uv sync created and ran a virtual environment.
- Canonical/draft equality, affected documentation links and whitespace checks passed.
- The managed local backend was gracefully reloaded only after verifying all workspace and solo work was idle. HTTP inspection confirms the broad fixed policy for all four personal-todo members. Full active team and group-history response hashes match before/after reload. No member-source activation, project edit, chat reset or model call was performed.

## Remaining limits
Docker daemon authority is deferred. The existing 60-second action lifetime/output bounds remain; background servers are terminated at action completion. No CPU/memory quota is added. Linux behavior depends on the library's dependencies and was not exercised on this macOS host. Historical command-rule source fields remain validated for source/history continuity but have no execution authority.
