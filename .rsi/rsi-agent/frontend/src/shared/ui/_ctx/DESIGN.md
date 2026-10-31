# UI

## Purpose, responsibilities and boundaries

Shared UI owns reusable visual components and presentation effects used by multiple features. Components render supplied data and expose user interactions through callbacks; features decide what data to provide, how state changes and what an action means.

UI components may own immediate presentation mechanics such as focus, keyboard interaction, accessibility behavior and ephemeral visual state. They do not fetch backend data, own feature workflows or apply business policy.

## Interface contract

Shared UI provides direct UI component implementations and visual examples, not a UI-library SDK or mandatory abstraction layer. A component may expose a concrete, fixed presentation input shape for its example and immediate use. Features may copy, adapt, extend, or replace that code around their own data models rather than being required to conform to the Shared example.

**Input:** The concrete example data and callbacks needed by each supplied component implementation. The example data exists to demonstrate the intended visual result; it is not a canonical feature or backend model.

**Output:** Accessible browser UI source, visual examples, and local interaction behavior that feature developers can reuse or further develop.

**Effect:** Presentation and local interaction only, including focus, keyboard behavior, selection, disclosure and other ephemeral visual mechanics. No data fetching, feature state ownership, business policy or feature-specific interpretation.

**Usage example:** A feature may compose a shared two-pane layout with its own message list and detail renderer, passing React nodes or render callbacks. Another feature may use the same layout for files or revisions with its own data and rendering. The feature chooses whether and how to use the component; it may also build its full feature UI independently while following the shared visual conventions.

## Constraints

- Do not impose a Shared data model or require features to use the Shared component unchanged.
- Provide direct, understandable component code with representative example data focused on the desired visual result.
- Features own their data models, mapping, workflow, and complete feature-specific UI composition; they may further develop Shared code to fit those requirements.
- Shared code must not interpret feature records or own business meaning.
- Shared UI begins empty; add components or examples only for genuine reuse or when explicitly requested.
- Keep feature-specific screens and one-off business interactions in their feature.
- Preserve accessibility, keyboard interaction and local visual mechanics as part of component contracts.

## Reference application layout

The user requested reusable Shared layout foundations based on the supplied reference screenshot, before adjusting the existing frontend. This is a presentation-only design. Existing App composition, routes, screens and application styles must not be migrated as part of this step.

- A window toolbar spans the complete frame, above the navigation rail, sidebar and main pane.
- The window toolbar has three presentation regions: application identity (logo, name, supporting information and sidebar toggle), the open main panel's title/information, and its action buttons.
- With the sidebar open, the identity region starts at the navigation rail's left border and spans rail plus sidebar: 56 + 264 = 320 px. The 32 px toggle is at the identity track's far-right edge (x=320), aligned with the sidebar's right border. The title region starts there as well.
- Closing the sidebar keeps the logo and full app name visible. The toggle compacts from 32 px to 24 px, and the identity/title boundary animates from x=320 to the width of the branding and toggle rather than a fixed 208 px minimum. In this closed state, leave equal 8 px spaces from the app-name area to the toggle and from the toggle to the main-panel title; one shared CSS token controls both spaces. The main pane still moves left to x=56; the toolbar title remains beside the branding without overlapping or hiding it. Actions remain pinned to the window's right edge.
- Opening and closing animate the sidebar body grid and toolbar identity/title tracks over 200 ms with `cubic-bezier(0.2, 0, 0, 1)`. The toolbar title and main pane move over the same duration/easing, with different compact stops: the title remains beside persistent branding, while the pane finishes at the rail border. The sidebar toggle compacts and moves; the logo/name and right-aligned actions remain visible. Sidebar content keeps its full width and is clipped by the narrowing pane instead of rewrapping. Rapid reversals must not leave stale state. Respect reduced-motion preferences by switching to immediate changes. Closed sidebar content is inert and hidden from assistive technology.
- These regions provide slots and callbacks only; App/feature composition owns actual application identity, panel title, action behavior and persistence.
- A narrow navigation rail and a separate fixed-width sidebar sit below the toolbar; the main pane fills the remaining width and height.
- Navigation-rail icon controls use the sidebar-header height as their full hit-area height. The icon artwork is inset inside that area and does not define the rail width or row height.
- The sidebar header spans the full sidebar width, uses the same initial 48 px height as the rail controls, and may place title content and optional actions in separate slots.
- A centered thread column has its own content-width budget. Adjacent message avatars and their gap are outside that budget and must not reduce the content width.
- Use reference-based CSS defaults of 48 px toolbar height, 56 px rail width and 264 px sidebar width. Use a 724 px maximum thread content width for the current text-sample layout; at 14 px, the requested line through `Restart the backend` measures about 716 px before its avatar gutter. These are approximate CSS dimensions based on the reference image and supplied sample, not exact source-pixel measurements.
- Keep these dimensions available as scoped CSS custom properties for later visual tuning, including `--shared-sidebar-header-height`. At constrained widths the thread content may shrink; the rail and sidebar do not automatically collapse. Their visibility and navigation policy remain with the consumer.
- Supply the toolbar, navigation, sidebar and thread contents through React nodes. These primitives do not provide routing, backend calls, feature state or native operating-system window controls.
- Provide a standalone Storybook example for reviewing the full frame and a thread row with an avatar positioned outside its content column.
- Thread body content uses 14 px text with a unitless line height of 1.65. Sidebar items use 14 px text with a unitless line height of 1.5. These user-selected text defaults are scoped to those regions; sidebar-header and toolbar typography are separate.
- Sidebar item rows use an exact 32 px height. Section-title rows use the same 32 px height. Sidebar text remains 14 px with a 1.5 line height (21 px), leaving 11 px of vertical room inside each row.
- Use the same 4 px gap between items, between a section title and its first item, and between adjacent sections; do not add section-specific vertical margins.
- Place the section fold/expand chevron immediately to the right of the title text with a 4 px gap.
- Sidebar items highlight immediately on hover and keyboard focus; disabled items do not gain a hover highlight, and selected items retain their distinct background.
- Sidebar sections fold independently through an accessible disclosure button and start expanded by default. Collapsing hides the content without unmounting it; a consumer may control open state through props and a callback.
- The reference layout and these body-text defaults are established. Demo colors remain illustrative; the final palette, remaining type hierarchy, control styling and feature integration remain separate design decisions.

## Agent context viewer

The Shared UI design includes a reusable two-pane presentation for inspecting an Agent's current persisted context. This is a visual component design; it does not make Agent context a universal Shared data model or require other features to use Pi messages.

### Purpose

Render the supplied Pi message list as one chronological list. Selecting an entry highlights it and renders its readable detail in a right-hand panel. The viewer is read-only and does not fetch, mutate, reorder or interpret Agent persistence.

### Presentation contract

The context feature may supply real ordered Pi messages when integrating the example, but Shared's responsibility is the direct visual implementation and representative data needed to demonstrate it. Feature-owned loading, refresh, revision and error behavior remains outside Shared. The Shared viewer supplies the visual composition and local interaction mechanics:

- Chronological message list preserving supplied order.
- Selected-row styling and selection callback.
- Right-side detail panel for the selected message.
- Accessible keyboard focus and selection behavior.
- Responsive narrow-screen list/detail presentation.
- Readable structured content where supported.
- Optional read-only raw-data inspection.

The initial implementation may use Pi's message list and representative Pi content directly because this viewer is an agreed concrete example. This does not establish a universal Shared UI model or SDK contract. A feature developer may copy the viewer code, keep its example input shape, or adapt/rewrite it around feature-owned records. The viewer must not expose a backend persistence-row contract.

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
