# Domain: Config

## Purpose, responsibilities and boundaries

Config owns deployment/application/agent configuration, provider connection management, model catalog resolution, and run-time configuration snapshots. It validates settings, resolves model choices from saved catalogs, manages secrets through the secrets service, and produces the exact configuration an agent run will use.

Config decides *what settings are valid* and *how they resolve*. It never persists records directly (that's Storage), never speaks HTTP (that's API), and never makes execution or activation decisions (those belong to Team and Agent runtime).

## Interface contract

**Purpose and supported interactions.** Config provides:
- Validation and resolution of provider connections (API keys, base URLs, timeouts)
- Model catalog management (save/load discovered models, resolve choices against catalogs)
- Agent configuration (model selection, reasoning mode, temperature, tool/prompt choices)
- Workspace model defaults (default model for a workspace's members)
- Run configuration snapshots (freeze the exact config used by a run, independent of later edits)

**Required inputs and returned information.**
- `validateConnection(connection)` — returns validation errors or success
- `resolveConfig(agentId)` — returns the resolved configuration for an agent (app defaults + agent overrides)
- `snapshotRunConfig(agentId, runId)` — freezes and stores the exact config for a run
- `saveModelCatalog(providerId, models)` — stores discovered models
- `resolveModelChoice(choice, catalogs)` — returns the concrete model from a choice against saved catalogs

**Observable effects.** Config calls Storage to read/write configuration records with revisions. It calls the secrets service to decrypt provider API keys. It never modifies workspace files, never starts runs, never sends HTTP requests to providers.

**Failure behavior.** Missing required settings, invalid model choices, unknown provider IDs, stale revisions fail explicitly with typed errors (`config_conflict`, `not_found`, `invalid_input`). Config never silently substitutes defaults when a required value is missing — it fails and reports what's needed.

## Constraints, specifications and requirements

- Config imports Foundation and Storage interfaces only
- Must not import concrete `MySqlStore`, API, or Runtime
- Provider API keys are write-only to the frontend; Config decrypts them through the secrets service but never exposes plaintext values
- Configuration edits do not lock records for the lifetime of a consuming run; a run's snapshot remains valid even if its source config is changed or deleted
- Model catalog size is bounded at 50 models per provider to prevent unbounded storage
