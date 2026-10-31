---
summary: Provides the generic SequenceInspector list/detail component, callback-based selection, native keyboard activation and responsive layout.
include:
  - frontend/src/shared/ui/SequenceInspector.tsx
  - frontend/src/shared/ui/SequenceInspector.stories.tsx
  - frontend/src/shared/ui/index.ts
  - frontend/src/app/styles.css
  - frontend/.storybook/preview.ts
  - frontend/src/features/workspace/GroupSummaryView.tsx
  - frontend/src/features/workspace/ContextTab.tsx
  - frontend/src/features/workspace/ContextEntryRow.tsx
  - frontend/src/features/workspace/context-message.tsx
---

# UI usage contract

Shared UI currently provides `SequenceInspector<T>`, a generic presentation component for an ordered list with a selected detail panel. It renders supplied data and invokes callbacks; it does not fetch backend data, own feature state, interpret records or apply business policy.

## Inputs and interactions

`SequenceInspector` accepts:

- `items: readonly T[]` — ordered items to display;
- `getKey?: (item, index) => string` — stable row key, defaulting to the index string;
- `renderRow(item, index, selected)` — row content supplied by the feature;
- `renderDetail(item, index)` — selected detail content supplied by the feature;
- `selectedKey?: string` — optional controlled selection;
- `onSelect?: (item, index) => void` — selection callback;
- `empty?: ReactNode` — empty or unavailable-state content.

With no controlled selection and initially nonempty items, the component initially selects the last item without calling `onSelect`. Clicking a row updates local selection and calls `onSelect(item, index)`. A supplied `selectedKey` takes precedence over local selection; its owner must update the prop for clicks to change the displayed selection. `undefined` uses local selection rather than representing an explicit controlled no-selection state.

If the active key is missing while items remain, an effect sets the local key to the last item and calls `onSelect`. With an invalid controlled key, the parent must apply that callback to restore displayed selection; until then no row is selected and the detail uses `empty`. The component never sorts supplied items or automatically jumps to a newly appended item when the previous selection still exists. An empty `items` array renders only the supplied empty node inside the inspector shell.

The list uses native buttons with `listbox`/`option` roles and `aria-selected` state. Rows expose browser keyboard focus, selected styling and click activation. The detail region is marked `aria-live="polite"`. CSS provides a two-column layout with independent list/detail scrolling and a stacked narrow-screen layout. Keyboard activation uses native Tab/Shift+Tab navigation and Enter/Space activation. The component does not implement arrow-key roving focus, Home/End navigation, pagination, loading, error, refresh or navigation semantics.

## Feature composition

Features decide what the items mean and how to render them. Workspace uses the component for group/member context pages and saved group summaries. Its feature-owned adapters add labels, pagination, revision handling, Pi message rendering through assistant-ui, images, tool results, thinking details and raw-data inspection. Those behaviors remain outside Shared UI. A feature may pass arbitrary records or React nodes and may copy or adapt the presentation code when its needs differ.

The `Shared/SequenceInspector` Storybook stories demonstrate representative generic entries with text, thinking, tools and empty-state content. They use a local `DemoEntry` shape rather than Pi messages and do not demonstrate image/unknown-content rendering or a Shared raw-data toggle. It is visual example data rather than a canonical backend model. The intended richer context presentation is composed in Workspace; Shared itself imports neither Pi nor assistant-ui.

Consumers must load `frontend/src/app/styles.css` (App startup and Storybook preview already do). Without these global rules the markup has no component-local layout styles. The generic inspector stacks below 700px; Workspace overrides preserve its message/detail panes side by side and move its own source picker above them at narrow widths.

Example:

```tsx
import { SequenceInspector } from './shared/ui/index.js';

<SequenceInspector
  items={records}
  getKey={(record) => record.id}
  renderRow={(record, index, selected) => <span aria-current={selected}>{index + 1}. {record.label}</span>}
  renderDetail={(record) => <article>{record.detail}</article>}
  selectedKey={selectedId}
  onSelect={(record) => setSelectedId(record.id)}
  empty={<p>No records are available.</p>}
/>
```

## Boundaries and guarantees

Shared UI owns immediate presentation mechanics: selection, focus behavior exposed by native controls, accessible state attributes, detail announcement and responsive layout styling. It has no network, persistence, backend protocol, feature workflow or business-validation behavior. Visual classes and responsive rules live in the application stylesheet and are intentionally presentation-only. Callers supply unique stable keys and suitable readable row labels; index keys are only the default and follow positions when data changes. Render/key/callback errors propagate through React or the event caller: the inspector adds no error boundary or fallback for thrown exceptions. Loading/error/raw-detail controls belong to consumer-supplied content.

The source and Storybook examples establish these behaviors; there is currently no dedicated automated Shared inspector interaction test or measured accessibility audit. In particular, native keyboard operation is implemented, while a complete ARIA listbox keyboard pattern is not. This gap against the UI design's accessibility verification expectations requires follow-up outside this context-only review.

Verification expectations for changes are visual and interaction focused: preserve ordered rendering, controlled/uncontrolled selection, fallback selection when data changes, empty state, accessible roles/labels, visible focus and narrow-screen layout. Backend and persistence behavior belong to the consuming feature or the Backend Client.
