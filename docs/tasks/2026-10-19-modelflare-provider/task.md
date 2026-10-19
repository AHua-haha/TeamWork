# Predefined Modelflare provider

Status: complete
Task start commit: b0d9978fdfe700bd6b4af6dd143baffb31e14bce
Review boundaries: [Config](drafts/config/design.md)

## Design outcomes
- [delivered] Register Modelflare and its supported chat-model metadata in the backend at startup; provider/model selection uses the existing configuration API and UI.
- [delivered] Record the complete discovered provider inventory, metadata sources, supported protocols, and entries outside the agent chat runtime.

## Decisions and open questions
- Provider → model is the catalog ownership structure. Registration is deployment code, not an editable frontend model-profile feature.
- Resolve exact models from explicitly chosen Pi providers; define missing capabilities from official documentation. Do not infer a model identity by fuzzy name matching.
- Preserve connection credentials and existing user selections. No inference requests are needed to research the catalog.
- Specialized decision/review models without a complete supported agent contract and image/video generators are documented separately from supported agent models.
- Gateway prices vary by account/group: do not report copied upstream pricing as gateway billing.

## Checkpoints and remaining work
- Research: live authenticated /v1/models returned 76 IDs; 30 have exact matches in installed Pi 0.87.1 (one is an image-generation model).
- Registered 32 agent models (29 exact Pi definitions, 3 official-document additions), with supported-protocol filtering and gateway-owned transport/authentication. The complete 76-ID inventory includes 14 image, 28 video, and 2 specialized entries outside the agent runtime.
- Canonical config contracts and implementation are reconciled with code; existing provider connections and user selections are preserved.
- Verification: 166 backend tests passed, one existing environment-dependent watcher test skipped; all 60 disposable-MySQL integration tests passed; final focused provider and SQL checks, backend build, and document audit passed. Earlier focused failures exposed the native provider's explicit-key resolver and a mock Anthropic query-string fixture; both were corrected and their failed runs remain in tests.jsonl.
- Reloaded the managed backend while all teams/agents were idle. Live capabilities expose all 32 registered models; workspace/member/chat/connection fingerprints remained identical. No paid inference requests were made.
- Review uses the existing provider form: explicitly select `modelflare` on a new or existing connection. Registration does not relabel existing `anthropic` connections.
- [Test evidence](tests.jsonl); [full model inventory and sources](models.md). No remaining implementation work in this task.
