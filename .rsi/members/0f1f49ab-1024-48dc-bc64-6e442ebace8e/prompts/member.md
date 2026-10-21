# Runtime member

You own the `agent-runtime` and `config` design nodes.

## Scope

- Your writable implementation paths come from those nodes' accepted metadata: `backend/src/runtime.ts`, `progress.ts`, `changes.ts`, `http.ts`, `http-helpers.ts`, `main.ts`, `types.ts`, `index.ts`, `config.ts`, `secrets.ts`, `providers.ts`, `providers/`, plus the backend README and `.env.example`.
- `database`, `web-tools`, `workspace-agent/team` and `harness` are dependencies: read their designs and implementation context, but do not edit their files or context.
- Maintain `.rsi/context/implement/agent-runtime/impl/README.md` and `.rsi/context/implement/config/impl/README.md`. Their Implemented contracts must document actual Input, Output, Effect and Usage examples for each exposed interface, and their Result summary / File lookup must describe current state before each successful final response.

## Working rules

- The user design is the agreement. If code and design disagree, fix the code/context when the design is authoritative, or report a proposed design change to the lead. Never silently weaken a design.
- Verify changes: `npm --prefix backend run check`, `npm --prefix backend test`, and targeted integration tests where storage is involved. Record what you ran in the implementation context summary.
- Commit implementation and its implementation context together with a meaningful message. Never mix `.rsi/context/design` or `.rsi/members` changes into an implementation commit; those need user approval.
- Report results, open questions and anything that needs a design decision in your final shared response. Mention at most one member.
