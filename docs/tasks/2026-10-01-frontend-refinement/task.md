# 2026-10-01-frontend-refinement

Status: complete
Task start commit: cf318e60f72feecff93e745496c8abadc75acc1e
Review boundaries: [Frontend system](drafts/frontend/design.md), [config model choices](drafts/config/design.md)

## Design outcomes

- [delivered] Replace the current navigation with a two-level rail and sliding contextual sidebar for Conversations and Config. See [frontend design](../../systems/frontend/design.md).
- [delivered] Make Providers the only visible Config destination, with an overview list and add/edit dialogs. See [frontend design](../../systems/frontend/design.md).
- [delivered] Simplify the composer to one cross-provider model selector and a reasoning control on the shared five-level scale. See [frontend design](../../systems/frontend/design.md).
- [delivered] Store model-call settings (reasoning, maximum output, temperature, context budget) per conversation and per model; edit them in the composer with a pill-style reasoning slider and a folded More settings section. See [config design](../../systems/config/design.md) and [frontend design](../../systems/frontend/design.md); task drafts: [config](drafts/config/design.md), [frontend](drafts/frontend/design.md).

## Decisions and open questions

- User selected one backend agent per conversation; New conversation creates a new agent.
- User selected hiding existing app, prompt, tool, and advanced call editors for now while preserving their saved values.
- User selected larger provider cards for the overview.
- Model selection must use `(connectionId, modelId)` as identity, since names and model IDs can repeat across connections.
- The backend API and runtime behavior remain unchanged in this design discussion.
- [superseded by the model-settings revision and shared scale below] User refined the composer: search starts folded behind a top icon; the selected model folds the model list; reasoning uses a slider with one discrete position for each backend-listed level plus Provider default. Incompatible hidden call-option changes still require explicit approval when switching models. (Folded search and list remain; the approval on model switch was removed.)
- [superseded by the shared scale below] User later removed Provider default as a slider stop: the left stop is now the first model-supported reasoning level. Existing unset reasoning remains unchanged until the user makes a selection. (Unset reasoning still writes nothing; the left stop is now Off.)
- [superseded by the shared scale below] User considered one unified thinking scale, then explicitly chose the model-specific levels supplied by Pi. The backend's model-choice list must agree with Pi's supported-level logic; the frontend uses that list directly.
- Prompt and tool settings are outside this frontend revision; no editor or repair action is planned for them.
- 2026-10-01 model-settings revision (supersedes the agent-wide reasoning/call-option decisions above and the model-switch conflict dialog):
  - Providers hold only connection information; no model settings live there.
  - Each conversation (agent) keeps a separate settings entry per `(connectionId, modelId)`: reasoning, maximum output tokens, temperature, context budget. Switching models uses that model's entry; nothing is shared across models or conversations. A switch never prompts.
  - [superseded by the shared scale below] Reasoning levels are exactly Pi's supported levels for the model, including `off` when supported. Pi's adapters mostly treat unset reasoning as thinking disabled, so the misleading "Model default" state is removed: an unset level uses the effective default, `off` when supported, otherwise the first level.
  - Maximum output, temperature, and context budget change rarely: unset by default (omitted from the Pi call) and edited in a More settings section folded by default.
  - Old agent-wide `callOptions` are dropped, not migrated.
  - The reasoning slider follows the user's reference image (thick pill track, blue sparkle fill, large white thumb, stop dots); its two icon buttons are not copied.
  - The backend config contract changes (agent config shape, `off` level, effective default); the database and runtime contracts do not.
- 2026-10-01 shared reasoning scale (supersedes the Pi model-specific level lists above): every reasoning model offers `off · low · medium · high · xhigh`; settings remain per conversation and per model. A level the model lacks is clamped to Pi's nearest supported level (`clampThinkingLevel`) and the UI shows "Sent as …". Non-reasoning models keep "No reasoning". `minimal`/`max` are no longer writable; stored out-of-scale levels read as unset. The slider was made smaller (22px track, 18px thumb).

## Checkpoints and remaining work

- Reference screenshots and current frontend contract reviewed. The new rail, contextual sidebars, provider cards/dialog, and composer controls are implemented in the worktree.
- Frontend build, 16 tests, whitespace check, and a desktop/mobile browser pass succeeded. See [tests.jsonl](tests.jsonl).
- A follow-up visual fix removed the textarea's rectangular focus outline; a focused browser screenshot confirmed the rounded composer alone carries the focus indicator.
- The composer popover now starts with its selected model and stepped reasoning slider, with search folded behind an icon and the full model list expandable from the model button. Desktop/mobile browser review, final build, and 16 tests passed.
- After clarifying that the model/reasoning popover was too large, restored the input composer dimensions and reduced the popover width, padding, and slider size. The compact and expanded popover were checked at desktop and narrow mobile widths.
- The reasoning slider now starts at the first supported named level. Unset saved reasoning remains unset until selection; one-level and no-level models have explicit states. The frontend build, 16 tests, and browser inspection passed.
- Awaiting user review. No commit has been made; the canonical frontend documents still describe the last committed behavior.
- Per-conversation, per-model settings design drafted and approved by the user.
- Per-model settings implemented in the backend config service (`modelOptions`, `off` level, `defaultReasoning`, selected-entry validation, legacy `callOptions` dropped) and in the composer (pill slider, level in header, folded More settings with staged save). Draft `impl.md` files updated. Backend/frontend typechecks, backend unit tests, 18 frontend tests, frontend build, and whitespace check pass.
- The user ran the MySQL integration suite outside the sandbox: 26 tests pass, including the per-model settings test.
- Shared five-level scale with clamping and smaller slider implemented; drafts updated. Backend/frontend typechecks, backend unit tests, 19 frontend tests, frontend build, and whitespace check pass. The MySQL suite's assertions changed and must be re-run outside the sandbox.
- The user re-ran the MySQL suite outside the sandbox: 26 tests pass with the shared-scale assertions.
- Drafts promoted to `docs/systems/config/` and `docs/systems/frontend/`; the frontend impl draft was rewritten as the full merged document so draft and canonical agree. The backend README no longer sends the rejected `callOptions` field and documents `modelOptions`; both READMEs describe the shared scale.
- The final shared-scale popover revision (five stops, "Sent as" note, smaller slider) had no browser pass: the preview tools were unavailable, and the user chose to commit without it. The earlier popover revisions passed desktop/mobile browser checks. Recorded as blocked in [tests.jsonl](tests.jsonl).
- Task complete; committed after final checks.
