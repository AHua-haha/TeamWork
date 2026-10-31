---
summary: Provides aligned window-toolbar, sidebar and thread layout primitives, local disclosures, and the generic SequenceInspector list/detail component.
include:
  - frontend/src/shared/ui/AppShell.tsx
  - frontend/src/shared/ui/WindowToolbar.tsx
  - frontend/test/window-toolbar.test.ts
  - frontend/src/shared/ui/NavigationRailButton.tsx
  - frontend/src/shared/ui/SidebarHeader.tsx
  - frontend/src/shared/ui/SidebarSection.tsx
  - frontend/test/sidebar-section.test.ts
  - frontend/src/shared/ui/layout.css
  - frontend/src/shared/ui/AppShell.stories.tsx
  - frontend/src/shared/ui/app-shell.stories.css
  - frontend/test/shared-layout.test.ts
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

Shared UI provides optional application/thread layout primitives and `SequenceInspector<T>`, a generic ordered-list/detail component. They render supplied content; they do not fetch backend data, own feature state, interpret records or apply business policy.

## Reference layout primitives

Import `AppShell`, `WindowToolbar`, `NavigationRailButton`, `SidebarHeader`, `SidebarSection`, `ThreadColumn` and `ThreadRow` from `frontend/src/shared/ui/index.ts`, and explicitly load `frontend/src/shared/ui/layout.css`. The index deliberately does not import this stylesheet. Existing App and feature screens do not use these primitives yet, and their global stylesheet is unchanged.

`AppShell` receives a required `toolbar` node, optional `navigationRail` and `sidebar` nodes, and `children` for its main pane. It also accepts controlled `sidebarOpen` (default `true`), `sidebarId`, `navigationLabel`, `sidebarLabel`, `className` and `style`. It renders a full-width header above a horizontal rail/sidebar/main body. Missing side slots produce no empty landmarks or reserved columns. A closing sidebar becomes inert and `aria-hidden` immediately, then visually clips to zero width and hides after the transition without unmounting its children. An inner full-width scrolling wrapper prevents its text from rewrapping during the animation. The parent must supply a definite height; use a full-height parent or an explicit `style={{height: '100dvh'}}`. Main and sidebar content can scroll without moving the toolbar. The header is browser content, not a native operating-system title bar.

`WindowToolbar` supplies the three requested regions: application identity (optional persistent `logo`, `brand` name/supporting information and the built-in sidebar toggle), `title` (the current main panel's information), and optional `actions` (caller-supplied controls). It requires `sidebarOpen` and `onSidebarToggle`, and accepts `sidebarId` and `className`. Supply the logo separately from `brand`; both the logo and name remain visible and accessible in either sidebar state. Pass the same open state and sidebar ID to the shell and toolbar. The toggle exposes Show/Hide sidebar labels, `aria-expanded` and optional `aria-controls`; it invokes the supplied callback rather than storing state or navigating.

In the rail/sidebar reference layout, the identity region begins at the navigation rail's left border and spans rail plus sidebar while open: x=0, width=320 px. The 32 px toggle is at x=288–320, exactly at the sidebar's right border. The title region starts at x=320, matching the main pane, and its text begins 8 px after the toggle's hit area; its trailing inset stays 12 px. With closing, the identity/title boundary animates to the max-content width of the logo, full brand, 8 px gap, and compact toggle rather than reserving a fixed width. Both the logo and app name remain visible. The toggle and title move left with the content-sized region instead of leaving extra empty toolbar padding. The main pane itself moves to x=56. Actions stay pinned to the right edge. Toolbar/title and sidebar movement share the 200 ms easing. The title's compact stop is to the right of the persistent branding, while the main pane continues to the rail border; branding never fades or becomes inert. Sidebar content is clipped at full width to avoid rewrapping during motion. Reduced-motion preferences disable transitions, and long panel titles truncate instead of displacing the actions.

Initial desktop dimensions approximate the reference screenshot in CSS pixels:

| Region | Default | CSS custom property |
| --- | --- | --- |
| Window toolbar | 48 px high | `--shared-toolbar-height` |
| Brand-to-toggle and toggle-to-panel-title gaps | 8 px each | `--shared-toolbar-brand-toggle-gap` |
| Sidebar motion | 200 ms | `--shared-sidebar-transition-duration` |
| Sidebar motion easing | `cubic-bezier(0.2, 0, 0, 1)` | `--shared-sidebar-transition-easing` |
| Navigation rail | 56 px wide | `--shared-rail-width` |
| Sidebar | 264 px wide | `--shared-sidebar-width` |
| Sidebar header / rail control | 48 px high | `--shared-sidebar-header-height` |
| Rail icon artwork | 20 px square | `--shared-navigation-icon-size` |
| Thread content | 724 px maximum width | `--shared-thread-width` |
| Thread text | 14 px; line height 1.65 | `--shared-thread-font-size`, `--shared-thread-line-height` |
| Sidebar item text | 14 px; line height 1.5 | `--shared-sidebar-item-font-size`, `--shared-sidebar-item-line-height` |
| Sidebar item row | 32 px exact height | `--shared-sidebar-item-height` |
| Sidebar item gap | 4 px, including section title-to-content | `--shared-sidebar-item-gap` |
| Avatar slot | 32 px square | `--shared-thread-avatar-size` |
| Avatar-to-content gap | 12 px | `--shared-thread-avatar-gap` |
| Minimum thread outer inset beyond the avatar gutter | 16 px per side | `--shared-thread-edge-padding` |

`NavigationRailButton` is a reusable icon-only native button. It defaults to `type="button"`, takes `icon`, `label` and optional `active`, forwards native button attributes, and exposes `aria-current="page"` when active. Its full hit area is the same `--shared-sidebar-header-height` as the sidebar header; the icon artwork is inset to `--shared-navigation-icon-size` and does not determine row height. It does not navigate or own selected state. `SidebarHeader` spans the entire sidebar width, accepts title `children`, optional `actions` and `className`, and keeps actions separate from clipped title content. Set shell-size properties on the `AppShell` root; thread properties may be set on that root or a `ThreadColumn`. Size properties take CSS lengths. `ThreadColumn` centers its inner content in the available pane and shrinks it when necessary, reserving a separate avatar gutter on both edges. The 724 px limit applies only to the inner content; it excludes avatars and their gap. The reference story's first line ends at `Restart the backend`, with `to load them.` wrapping onto the next line at 14 px. At narrower available widths, the text wraps naturally. No breakpoint automatically hides or resizes the rail/sidebar. The consumer decides when to omit slots or change dimensions; this is a desktop geometry foundation rather than a complete mobile navigation workflow.

Thread content defaults to 14 px text and unitless line height 1.65 (23.1 px at the default size). Wrap sidebar item content in `.shared-sidebar-items` to apply 14 px text and a 1.5 line height separately from the thread and sidebar header. The wrapper stacks items with a configurable 4 px gap; interactive direct children use an exact 32 px row height by default. Section headings use the same height and gap; their chevron sits immediately to the right of the title text with a 4 px gap. Sidebar text remains 14 px with a 1.5 line height. Storybook uses these same defaults.

Enabled sidebar action rows and rail buttons highlight immediately on pointer hover or keyboard focus, using `--shared-sidebar-hover` (default `#eef1f4`). Current-page items retain their selected background; disabled rows do not receive hover highlighting. Section headers use the same highlight.

`SidebarSection` accepts `title`, `children`, `defaultOpen` (default `true`), optional controlled `open`, `onOpenChange(nextOpen)` and `className`. Its native disclosure button exposes `aria-expanded` and `aria-controls`, supports click/Enter/Space, and rotates its chevron when folded. Uncontrolled sections keep their own independent open state. With `open`, the consumer must apply the callback to change the visible state. Collapsing uses a hidden panel while leaving children mounted, preserving their local state; no data loading, navigation or persistence is triggered by the component. Projects and Recent demonstrate this in the layout story. Omitted or failed render content follows normal React behavior; the section adds no error boundary or loading policy.

```tsx
<SidebarSection title="Projects" defaultOpen>
  <div className="shared-sidebar-items">{projectButtons}</div>
</SidebarSection>
```

`ThreadColumn` takes `children`, `className` and `style`. `ThreadRow` takes `children`, optional `avatar` and `className`. Its avatar is a sibling of message content, positioned in the leading gutter without narrowing the message. Avatar rows reserve at least the configured avatar height. Consumers supply accessible avatar content and decide message roles, alignment, rendering and composer behavior. These components expose no state, routing, submission or scrolling-to-latest policy.

```tsx
import { useId, useState } from 'react';
import { AppShell, WindowToolbar, ThreadColumn, ThreadRow } from './shared/ui/index.js';
import './shared/ui/layout.css';

// Inside the consuming component:
const [sidebarOpen, setSidebarOpen] = useState(true);
const sidebarId = useId();

<AppShell navigationRail={navigation} sidebar={sidebar}
  sidebarOpen={sidebarOpen} sidebarId={sidebarId} style={{height: '100dvh'}}
  toolbar={<WindowToolbar logo={appLogo} brand={brand} title={panelTitle} actions={panelActions}
    sidebarOpen={sidebarOpen} sidebarId={sidebarId}
    onSidebarToggle={() => setSidebarOpen(open => !open)} />}>
  <ThreadColumn>
    <ThreadRow avatar={<img src={avatarUrl} alt="Assistant" />}>
      {messageContent}
    </ThreadRow>
    {composer}
  </ThreadColumn>
</AppShell>
```

Storybook `Shared/AppShell` provides `ReferenceLayout`, `ConstrainedWidth`, `NavigationAlignment`, `TallerSidebarHeader`, `WindowToolbarLayout`, `SidebarClosed` and `ContentWithoutAvatars`. The main examples contain a working sidebar toggle, the three toolbar regions, and an initial-closed case for testing reopening. `NavigationAlignment` shows rail icon hit areas aligned to the sidebar header; `TallerSidebarHeader` shows both responding to the shared height token. Sidebar toggling, section folding and hover/focus highlighting work in the example; main-panel action buttons, navigation and composer actions remain placeholders rather than feature workflows. Its separate scoped demo stylesheet illustrates neutral surfaces; the final palette, remaining type hierarchy and control design are not established by the demo.

Without `layout.css`, the components retain their semantic structure but not these dimensions. Invalid CSS overrides follow browser CSS behavior. Content/render errors propagate through React; the primitives provide no error boundary or network failure state. Geometry and optional-slot/landmark behavior are covered by focused tests and browser review; existing feature interfaces remain unchanged.

## SequenceInspector inputs and interactions

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

Consumers of `SequenceInspector` must load `frontend/src/app/styles.css` (App startup and Storybook preview already do). Without these global rules the markup has no component-local layout styles. The generic inspector stacks below 700px; Workspace overrides preserve its message/detail panes side by side and move its own source picker above them at narrow widths.

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

Shared UI owns immediate presentation mechanics: selection, focus behavior exposed by native controls, accessible state attributes, detail announcement and responsive layout styling. It has no network, persistence, backend protocol, feature workflow or business-validation behavior. Inspector visual classes and responsive rules live in the application stylesheet. The optional shell/thread geometry lives in the separate, class-scoped `layout.css`; both remain presentation-only. Callers supply unique stable keys and suitable readable row labels; index keys are only the default and follow positions when data changes. Render/key/callback errors propagate through React or the event caller: the inspector adds no error boundary or fallback for thrown exceptions. Loading/error/raw-detail controls belong to consumer-supplied content.

The source and Storybook examples establish these behaviors; there is currently no dedicated automated Shared inspector interaction test or measured accessibility audit. In particular, native keyboard operation is implemented, while a complete ARIA listbox keyboard pattern is not. This gap against the UI design's accessibility verification expectations remains separate from the shell and navigation layout work.

Verification expectations for changes are visual and interaction focused: preserve ordered rendering, controlled/uncontrolled selection, fallback selection when data changes, empty state, accessible roles/labels, visible focus and narrow-screen layout. Backend and persistence behavior belong to the consuming feature or the Backend Client.
