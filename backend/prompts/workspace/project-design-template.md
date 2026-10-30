# {{project}}

## Purpose, responsibilities and boundaries

Clarify the user's goals and this design part's responsibilities and boundaries with the user.

## User requests and requirements

Record the user's intended behavior and requirements. Do not describe planned interfaces as implemented.

## Constraints and architectural mental model

Record accepted constraints and architectural decisions. This document expresses the user's design; it need not specify a complete concrete protocol.

## Context maintenance

Context mirrors project paths under `.rsi/<project-name>/`. A directory design part owns `_ctx/`; a file design part owns `<file-name>.ctx/`. Only meaningful design parts have these context directories. Their nearest enclosing design part maintains context about other files and directories.

`DESIGN.md` records the user's design. An optional `README.md` is the concrete usage contract of the actual implementation: interfaces, inputs, outputs, observable effects, failures, lifecycle guarantees and examples. Internal development knowledge remains separate from that contract. Its detailed format is not prescribed. Keep design changes visible to the user.
