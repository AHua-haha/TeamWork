# Shared

## Purpose and boundaries

Shared provides frontend capabilities reused across features: presentation-only UI components and one public backend client. It does not own navigation, feature state, feature workflows or business policy.

## Child designs

- [UI](../ui/_ctx/DESIGN.md) — reusable visual components, interaction effects and presentation contracts.
- [Backend Client](../backend-client/_ctx/DESIGN.md) — the single public client for reaching backend APIs and parsing protocol responses.

## Constraints

- Shared abstractions must have genuine cross-feature reuse; feature-specific screens and behavior stay in their owning feature.
- The backend remains authoritative for data validity and durable effects.
