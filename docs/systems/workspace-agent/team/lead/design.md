# Lead agent

Permission and approval enforcement below describes the default enabled mode. The operator's optional startup setting `harnessPermissionsEnabled: false` bypasses harness permission gates; semantic validation, user activation and runtime lifecycle rules remain in force.

## Purpose and boundary

The lead helps maintain project design and member configuration and assigns active members through shared group mentions. Its management harness supplies scoped files, validation and maintenance rules. Protected commit approval and separate member activation belong to the user; the agent manages ordinary Git commands.

## Inputs and preconditions

The lead may propose member creation, update or deletion through files. Creation supplies valid assignment/model/content/execute configuration. Updates may change only execution rules, supplementary prompts and responsibility; identity, name, role, model/run settings and working/dependency assignments stay fixed. Implementation access remains derived from accepted designs. Delete retires a worker and retains history/files; the lead cannot be deleted.

Backend owns control metadata and fixed base policies. Member prompts supplement base instructions. User workspace model choices/default remain the source for creating member settings.

## Outputs and observable effects

The workflow is pending file edit -> validation -> user commit -> separate user activation. Validation reports the complete semantic change set and issues without modifying active settings. The lead explains proposed changes and unresolved choices and requests exact user review. User commit alone does not change the roster.

Only the user activates the reviewed committed change set, atomically, while the whole workspace team has no running/admitted/finalizing work. Activation does not start members and excludes uncommitted edits. Subsequent group messages use the resulting roster. Assignments remain naturally completed accepted group replies with mentions; private tool work remains private.

## Failure behavior

Forbidden update fields, unsafe/missing references, duplicate names, lead deletion, stale review or workspace busy state refuse the change set. Failed activation preserves the entire previous active team and pending/committed files. No partial activation, automatic stop/retry or claimed user approval is allowed.

## Guarantees and limits

Only the lead receives member-file write/edit and validation capabilities. Read tools inspect workspace content; Bash retains broad system-read/workspace-write/network resources. Explicit design/member-only commits wait for user approval; mixed protected/implementation commits refuse. Indirect Git is outside detection. The user separately activates valid committed member files while the whole workspace is idle. validate_member_config still validates .rsi/members and never commits/activates.

## Acceptance examples

1. The lead edits/validates a worker prompt and responsibility. User commits; the active worker remains unchanged until separate idle activation.
2. An update changes the worker's model or assignment. Validation refuses it.
3. An accepted change set creates A, updates B and retires C. Any running workspace member prevents activation; when idle all reviewed changes apply together or none do.
4. The lead's manifest is deleted. Validation refuses deletion of the lead.
5. User activation succeeds without running any member; later shared mentions use the new configuration.

## Harness tool execution boundary

Workspace members receive native Pi file/search tools. Read-only tools inspect workspace content; write/edit enforce accepted assignment and role grants at invocation. Custom Bash supplies one persistent shell per member with system reads, whole-workspace/workspace-temp writes and networking. This broader Bash authority does not enforce working-design scopes. Pi content/details and native truncation are preserved. Custom results use readable content plus relevant metadata. Shells/jobs survive runs and stop on context reset, retirement, affected configuration activation/update, or shutdown. Foreground timeout/cancellation resets the member shell/jobs; background jobs use native job IDs and default their output to /dev/null unless explicitly redirected. Scoped Git acceptance and activation APIs retain their checks but do not claim to prevent all raw workspace changes.

## Operator permission mode

The project environment's harnessPermissionsEnabled setting defaults to true. With false all active members can use the available native file/Bash and management tools; file workspace/assignment/role/link guards, Bash OS sandbox and explicit Git approval/classification are bypassed. Design assignments remain work guidance. Active member identity, file schemas/update constraints and separate atomic idle user activation retain their existing rules. This setting is operator-owned and requires backend restart; member files cannot select it.
