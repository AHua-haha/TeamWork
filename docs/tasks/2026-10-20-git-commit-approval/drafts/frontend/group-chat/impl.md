<!-- Task proposal; current contract is under docs/systems/ -->
# Group chat Git approval UI proposal

## Contract

[Group chat](design.md) adds a compact pending-commit input above the composer and a separate right-panel review. Existing streaming, folding and avatars remain.

## Responsibilities and decomposition

Composer-adjacent UI owns user decision/feedback controls. The right panel owns commit details and diff presentation. Backend owns candidate identity, permissions, approval validity and execution. No frontend-owned Git snapshot or approval authority.

## Coordination and data flow

Observe backend pending approval, display the input and let Review select that same request in the right panel. Submit Accept, Deny or feedback to the backend and update controls from the result. Opening review does not submit a decision. API schema, transport, restart recovery and multiple-client resolution require follow-up design.

## Decisions and constraints

Do not put diff content in the approval input. Use existing file-diff presentation where it fits, replacing obsolete scope-token operations rather than retaining two acceptance models. No frontend implementation is included in this task.

## Code map

Future changes affect frontend/src/ui group composer/group view and right-panel review, plus the backend approval client contract. Existing code is unchanged.

## Verification

Future tests cover popup location, no embedded diff, right-panel navigation, all three decisions, stale candidate errors, duplicate submission and pending state while review is closed. Existing stream UI remains unchanged.
