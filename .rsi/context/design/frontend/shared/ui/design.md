# UI

## Purpose, responsibilities and boundaries

Shared UI owns reusable visual components and presentation effects used by multiple features. Components render supplied data and expose user interactions through callbacks; features decide what data to provide, how state changes and what an action means.

UI components may own immediate presentation mechanics such as focus, keyboard interaction, accessibility behavior and ephemeral visual state. They do not fetch backend data, own feature workflows or apply business policy.

## Interface contract

**Input:** typed presentation properties, children/content and callbacks for user interactions.

**Output:** rendered, accessible browser UI and interaction callbacks.

**Effect:** presentation and local interaction only; no durable backend effects or feature state ownership.

**Usage example:** a shared confirmation dialog renders the provided title/body and calls `onConfirm`; the Workspace feature decides which request confirmation performs.

## Constraints

- Keep feature-specific screens and one-off business interactions in their feature.
- Share components when they provide useful cross-feature consistency; avoid a general-purpose component dumping ground.
