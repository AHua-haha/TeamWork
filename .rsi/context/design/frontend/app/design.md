# App

## Purpose, responsibilities and boundaries

App owns browser application startup, router assembly, the shared application shell and global navigation. It composes feature-owned pages and route-level behavior without taking over feature workflows or data interpretation.

## Interface contract

App initializes and provides the shared backend client, installs global providers/layout, assembles feature routes and exposes the initial simple top-level navigation: Home, Providers, Chat and Workspace. Features provide page content; App owns the overall navigation composition and route fallback/error boundaries.

Exact route paths and workspace-selection behavior for Chat should follow the existing interaction flow and are not fixed by this design tree.

## Constraints

- Do not duplicate feature state or backend workflows in the shell/router.
- Navigation or browser disconnect does not imply cancellation of backend work.
