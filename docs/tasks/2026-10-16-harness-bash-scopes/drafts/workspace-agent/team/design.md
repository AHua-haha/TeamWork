<!-- Task proposal; current contract is under docs/systems/ -->
# Team

## Purpose and boundary

The team belongs to one workspace and has two responsibilities: manage member creation, configuration and retirement; and coordinate work among members. The user and all active members participate in one shared workspace chat. The lead helps maintain the user design, divides work based on that design, configures harnesses and assigns members through shared responses. Members may be created or retired as the work changes. Designs and implementation survive member changes.

Members exist only inside their team and are absent from the global agent list and agent config API. Each retains its own private execution history alongside individually delivered shared messages. Model loops belong to the runtime, file authority and context delivery to the harness, and durable design records to the context base.

## Inputs and preconditions

### Member identity, content and inspection

The workspace still has one lead and active workers with unique names. Team membership and conversation identity remain backend-owned. Read-only team/member inspection continues to expose accepted content, effective harnesses and running/readiness information; exact projections will be reconciled with the new schema before implementation. No new frontend member-write interface is proposed.

Editable member content consists of name, role, responsibility, model settings and ordered supplementary Markdown prompt references, with designScope as its only configurable harness assignment. Existing name/model/path validation remains required. JSON carries member configuration and Markdown carries optional instructions. Base tools, mandatory rules and commit policy are fixed backend policy.

The backend owns format version handling, identity/path association, accepted revision and editing-base/conflict metadata. Agents do not write version/revision bookkeeping fields. Exact new manifest identity/creation representation is open. Invalid or stale edits preserve the previous accepted configuration and pending files.

### Design assignment and effective harnesses

The member assignment lists working and dependency user designs. The management harness permits pending edits to working designs and read-only dependency access. Only the lead can read/edit member configuration paths among agents. Design and member-config semantic commits require explicit user acceptance of exact reviewed content; implementation commits remain agent-authorized.

The implementation harness derives writable paths from accepted working-design mappings and read-only paths from accepted dependency mappings. Read-only mappings win overlaps and control files remain protected. Agents do not configure independent implementationScope paths/usePaths. Pending design edits grant no additional authority. Invalid/unresolved designs cannot activate a member configuration.

The execute harness controls general commands through the same Bash capability while preserving management restrictions. Detailed rule configuration remains deferred. New workers continue to obtain omitted model selection/options from the workspace default; chosen models must satisfy workspace/provider validation.

The lead management base grants access to maintain .context/user/ design files and .team/members/ configuration directories from workspace initialization, even before any design exists. Design dependencies remain read-only and both management parts retain user-approved commits. Implementation access starts empty and derives only from accepted assigned designs. Migration from explicit implementation assignments remains to be designed. Configuration-change/activation handling, including applying changes to active members, is deferred. Existing missing-lead recovery, identity/history preservation and one-active-run admission guarantees must be retained.

### Work and cooperation

The user posts `{text}` to `POST /workspaces/:workspaceId/team/chat/messages`. Text is 1–20,000 characters. A user message without mentions triggers the lead. Explicit mentions select recipients using `@Name` or `@{Name With Spaces}`, matching active names ignoring case. A member response without mentions triggers nobody. Duplicate mentions select one recipient. All selected members may work in parallel, with at most one run per member.

Every accepted shared message is delivered to every active member, including the sender. Idle members append it to their continuing context immediately. Working members buffer incoming shared messages and append them in group order after their private work ends, without waiting for or triggering another activation. Each member context interleaves shared messages and its private work. Its previous private history remains available, but no other member receives it. Tool calls, results, intermediate responses and rejected publication candidates stay private. Only an accepted final response is published in the group transcript.

A final response is checked before the sending activation ends. If any recipient is unknown, retired, unready, self, or busy, the whole publication is refused: no shared message, recipient activation or budget consumption. The sender receives private feedback and can revise or retry within its current run. There is no queue, automatic wait or retry. A successfully published final response completes the sending activation before its recipients begin, so a recipient can mention the sender in its own response.

Each user-initiated exchange has a mention budget, initially 32 activations. Default lead routing counts one; each distinct recipient activation counts one. A response's activations belong to the same exchange. A message exceeding the remaining budget is refused in full. Already-started members can finish and publish without mentions. Cooperation ends when no members remain active. A new user message starts a new exchange and budget, subject to the same busy checks. `PUT /workspaces/:workspaceId/team/chat` with `{mentionLimit}` sets a 1–1,000 limit for later exchanges.

`GET /workspaces/:workspaceId/team/chat?after=0&limit=100` returns `{workspaceId, position, mentionLimit, messages, more, runs}` from persistent records. Messages contain author, text, recipients, stable ID, position, time and exchange ID; runs pair exchange IDs with runtime state. History pages contain 1–500 messages. `GET /workspaces/:workspaceId/team/chat/follow?after=0` synchronizes messages then follows shared messages and activation state across runs using version 1 `message`, `sync`, and `state` SSE events. A disconnected follower does not stop work. Group observation does not expose private execution traces.

`POST /workspaces/:workspaceId/team/chat/stop` stops existing exchanges and requests cancellation of active members. Later user messages may start new exchanges. Direct `POST /agents/:memberId/runs` refuses all team members; solo agents retain their own input API. Private member history/state/follow remains available for inspection. The [group chat contract](../../../../../systems/workspace-agent/team/group-chat/design.md) provides the complete cooperation boundary.

Reusable file capabilities and one Bash capability are assembled from management, implementation and execute harnesses. Scoped Git uses ordinary Git commands with requested-scope metadata; backend derives its authority and approval policy. Dedicated commit_scope/scope_history/restore_scope and argv-only run_command are superseded. Model discovery remains a lead capability. The future role of submit_member_config and retirement in the user-approved configuration flow remains open. Each model call receives current role/roster/readiness/running information, accepted member instructions and harness context. Designs and implementation knowledge remain independent of member identity.

## Outputs and observable effects

The lead edits member configuration files as pending harness content. Checkpoints preserve those edits without accepting or activating them. User approval is required to commit member configuration and design. Backend retains exact accepted source bytes, metadata and stable configuration independently of mutable drafts. Configuration-change/activation operations and busy-target handling are explicitly deferred; no immediate unapproved submission path is part of the target.

Accepted configuration controls subsequent member use according to the eventual activation contract. Workspace model-default changes preserve already assigned settings. Accepted design mappings determine implementation authority; application of changed configuration/scope to already-running members is deferred. Member/context/history inspection remains read-only, and retired/history records must survive migration.

Publication and creation of all selected recipient run records remain atomic. Model execution begins after admission; execution failure becomes run status without fabricating shared output. Group stop/restart behavior and retained private history remain unchanged. Configuration user acceptance, scoped semantic commits and final group-message publication are distinct effects.

## Failure behavior

Invalid member content, unsafe/unresolved designs, out-of-scope access, unapproved management commits and stale accepted/editing bases fail explicitly while preserving accepted configuration and pending edits. Metadata cannot claim lead authority or user approval. Missing or invalid mappings cannot produce permissive implementation access.

Group messages retain their existing atomic mention/readiness/busy/budget refusal behavior. Unexpected storage or execution failures do not claim successful acceptance. Exact error envelopes and approval continuation behavior for the new file workflow remain to be specified.

## Guarantees and limits

One unretirable lead, unique active names, shared ordered group messages, retained private histories, independently triggered parallel members and only accepted final responses shared between members remain required. The new assignment contract makes accepted designs the basis of implementation authority.

Among agents, member paths are lead-only. Design/member commits require user approval and backend-managed control metadata; implementation commits follow their harness policy. General execution cannot override these restrictions. Tools remain reusable and runtime assembles capabilities from three purpose harnesses.

No new frontend approval/configuration UI, automated context-maintenance algorithm, durable run resume, trigger queue or multiple-chat model is proposed. The full member activation/retirement/self-update flow, mapping refresh and concrete Bash enforcement mechanism remain open.

## Acceptance examples

1. An unmentioned user message starts the lead. Its final response mentions Backend and Frontend; both work concurrently and receive the same shared messages.
2. Backend reports with `@Lead`; Lead can work again after finishing its assignment response. Frontend sees the shared report without receiving Backend's private trace.
3. While Backend works, an accepted message mentioning only Frontend is appended to idle members and buffered for Backend. Backend receives it after finishing, without another activation.
4. A response mentions busy Backend and free Frontend: refuse the whole publication and let the sender revise privately.
5. A member can see every accepted shared message and still edit only its harness-authorized implementation. Pending design edits require user approval to commit; implementation commits follow harness permission.
6. Budget exhaustion refuses new activations. Existing branches can finish with unmentioned reports.
7. A replacement member receives the shared transcript and configured design scope, not the retired member's private execution history.

Each member uses a separate managed worktree. The harness automatically checkpoints finished runs and before successful final group publication. Scoped committed snapshots remain in harness Git; they are not automatically integrated into the original workspace or existing peer worktrees. User acceptance pins exact reviewed bytes/base and is scoped to one part; implementation commits never accept pending design. The [harness contract](../harness/design.md) specifies these operations and permissions.

## File-based configuration submission

The proposed file workflow retains JSON member content and bundle-relative Markdown instructions, lead-only editing and exact accepted source preservation. It removes agent-maintained version/revision bookkeeping and independent implementation scope fields. Backend maintains member/path association, schema handling and editing-base conflict checks.

User approval is required to commit member configuration. Handling member configuration changes and activation is explicitly deferred, including the validation-to-activation flow and timing for active members. In particular, do not assume the existing submit_member_config remains an immediate activator or that any ordinary Git commit automatically activates settings. These alternatives are reserved for the later team activation design and do not block continuing the harness discussion.

Migration must preserve existing member identities, conversations, prompt bytes, accepted source and pending drafts. Existing command allowances must be reconciled with execute-harness policy without introducing an undocumented agent configuration surface. New manifests cannot override base policy.

## Read-only member inspection

GET /workspaces/:workspaceId/team and GET /workspaces/:workspaceId/team/members/:memberId remain read-only inspection boundaries. Their future projection must distinguish editable accepted source, backend-owned control metadata, effective design-derived implementation scope and all three harness definitions. Pending drafts are separate from accepted content. Exact new payload fields remain open; no new frontend member write route is added by this proposal.

Workspace model choices/default and provider validity remain team configuration inputs. Inspection and group admission use backend-resolved effective configuration rather than frontend path derivation or mutable agent drafts.

## Unified streaming and model completion

Members finish using ordinary assistant text at natural model completion. Tool calls continue the run; metadata-marked commentary continues privately. Truncated responses fail without publication. Final selection prefers explicitly final text blocks and otherwise uses unphased text at natural completion. The team checkpoints and offers the selected text for atomic group acceptance; refusal appends private feedback and continues. Only accepted finals reach peer context.
