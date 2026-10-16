# Lead agent

## Purpose and boundary

The lead helps maintain project design and member configuration and assigns active members through shared group mentions. Its management harness supplies scoped files, validation and maintenance rules. File commit and member activation belong to the user.

## Inputs and preconditions

The lead may propose member creation, update or deletion through files. Creation supplies valid assignment/model/content/execute configuration. Updates may change only execution rules, supplementary prompts and responsibility; identity, name, role, model/run settings and working/dependency assignments stay fixed. Implementation access remains derived from accepted designs. Delete retires a worker and retains history/files; the lead cannot be deleted.

Backend owns control metadata and fixed base policies. Member prompts supplement base instructions. User workspace model choices/default remain the source for creating member settings.

## Outputs and observable effects

The workflow is pending file edit -> validation -> user commit -> separate user activation. Validation reports the complete semantic change set and issues without modifying active settings. The lead explains proposed changes and unresolved choices and requests exact user review. User commit alone does not change the roster.

Only the user activates the reviewed committed change set, atomically, while the whole workspace team has no running/admitted/finalizing work. Activation does not start members and excludes uncommitted edits. Subsequent group messages use the resulting roster. Assignments remain naturally completed accepted group replies with mentions; private tool work remains private.

## Failure behavior

Forbidden update fields, unsafe/missing references, duplicate names, lead deletion, stale review or workspace busy state refuse the change set. Failed activation preserves the entire previous active team and pending/committed files. No partial activation, automatic stop/retry or claimed user approval is allowed.

## Guarantees and limits

Only the lead accesses member files among agents. Only the user commits/activates member changes, in separate actions. Existing design acceptance, harness scope, Bash/Git enforcement and group-publication rules remain. Global base rule files are backend-owned. The file validation tool is validate_member_config with path .team/members; user review/activation uses the team configuration control API. No frontend activation controls are added in this backend prototype.

## Acceptance examples

1. The lead edits/validates a worker prompt and responsibility. User commits; the active worker remains unchanged until separate idle activation.
2. An update changes the worker's model or assignment. Validation refuses it.
3. An accepted change set creates A, updates B and retires C. Any running workspace member prevents activation; when idle all reviewed changes apply together or none do.
4. The lead's manifest is deleted. Validation refuses deletion of the lead.
5. User activation succeeds without running any member; later shared mentions use the new configuration.
