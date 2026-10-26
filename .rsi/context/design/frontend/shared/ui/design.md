# UI

## Purpose, responsibilities and boundaries

Shared UI owns reusable visual components and presentation effects used by multiple features. Components render supplied data and expose user interactions through callbacks; features decide what data to provide, how state changes and what an action means.

UI components may own immediate presentation mechanics such as focus, keyboard interaction, accessibility behavior and ephemeral visual state. They do not fetch backend data, own feature workflows or apply business policy.

## Interface contract

Shared UI provides reusable visual building blocks and presentation effects, not feature-level UI kits with a prescribed data model. Components focus on how supplied content is laid out and how immediate visual interactions behave. They must not require features to adopt Shared-owned domain types or data workflows.

**Input:** Component-specific presentation inputs, children/rendered content, and callbacks. Shared UI may use generic props, React children, render props, slots, or narrowly typed visual options as appropriate; it does not define a canonical model for feature records.

**Output:** Accessible, reusable browser UI and interaction callbacks.

**Effect:** Presentation and local interaction only, including focus, keyboard behavior, selection, disclosure and other ephemeral visual mechanics. No data fetching, feature state ownership, business policy or feature-specific interpretation.

**Usage example:** A feature may compose a shared two-pane layout with its own message list and detail renderer, passing React nodes or render callbacks. Another feature may use the same layout for files or revisions with its own data and rendering. The feature chooses whether and how to use the component; it may also build its full feature UI independently while following the shared visual conventions.

## Constraints

- Do not impose a fixed Shared data model or require features to adapt their records to one.
- Prefer visual primitives, layouts and interaction patterns that features can compose around their own data.
- Features own their data models, mapping, workflow, and complete feature-specific UI composition.
- Shared components may provide slots/render props and callbacks, but must not interpret feature records or own business meaning.
- Shared UI begins empty; add components only for genuine reuse or when explicitly requested.
- Keep feature-specific screens and one-off business interactions in their feature.
- Preserve accessibility, keyboard interaction and local visual mechanics as part of component contracts.

## Agent context viewer

The Shared UI design includes a reusable two-pane presentation for inspecting an Agent's current persisted context. This is a visual component design; it does not make Agent context a universal Shared data model or require other features to use Pi messages.

### Purpose

Render the supplied Pi message list as one chronological list. Selecting an entry highlights it and renders its readable detail in a right-hand panel. The viewer is read-only and does not fetch, mutate, reorder or interpret Agent persistence.

### Presentation contract

The Agent feature supplies the current ordered Pi messages and feature-owned loading, refresh, revision and error behavior. The Shared viewer supplies the visual composition and local interaction mechanics:

- Chronological message list preserving supplied order.
- Selected-row styling and selection callback.
- Right-side detail panel for the selected message.
- Accessible keyboard focus and selection behavior.
- Responsive narrow-screen list/detail presentation.
- Readable structured content where supported.
- Optional read-only raw-data inspection.

The initial concrete usage may accept Pi's message list directly, using the public Pi message type available to the frontend. This is a specific viewer contract and does not constrain other Shared UI components. The component must not expose a backend persistence-row contract. A feature may wrap or adapt messages if its own data needs require it.

### Assistant UI integration

Use `@assistant-ui/react` presentation primitives in the detail panel where they can render Pi message content. Assistant UI conversation state, runtime, submission and transport behavior are out of scope: this viewer is an inspection surface, not an interactive chat thread. The feature or a viewer adapter maps Pi content parts to assistant-ui-compatible renderers. Unsupported content remains visible through a safe fallback rather than being silently dropped.

Readable detail rendering should support, where present:

- Text and Markdown.
- Native images with accessible alternatives.
- Tool calls and tool results.
- Structured content blocks.
- Compaction or derived context entries.
- A clearly separated raw representation for debugging.

### Visual structure

```text
+------------------------------+--------------------------------+
| chronological context list   | selected message detail        |
| 01 system                    | role, author and source        |
| 02 group                     | readable structured content   |
| 03 assistant                 | images/tools/other parts      |
| ...                          | optional raw data             |
+------------------------------+--------------------------------+
```

The viewer selects an entry through a callback, not by imposing persistence or navigation semantics. The feature decides the initial selection and what metadata labels mean. Empty selection, empty list, loading and error visuals may be supplied by the feature or composed through presentation slots.

### Boundaries

Shared UI does not load Agent context, choose which messages to show, own context state, expose private data, or decide feature meaning. It owns only the visual view, content rendering integration and ephemeral interaction state. The Agent/Chat feature owns the Pi data source, mapping, refresh lifecycle and any feature-specific extensions.

### Verification expectations

Test the visual component with representative Pi message fixtures covering text, image, tool call/result, structured and unknown content. Verify chronological ordering, selection, detail rendering, raw-data toggle, keyboard accessibility and responsive layout. Do not add backend or persistence behavior to Shared UI.
