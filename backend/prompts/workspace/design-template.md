# {{project}}

## Purpose, responsibilities and boundaries

To be clarified with the user: the project's purpose, owned responsibilities and boundaries.

## Interface contract

Describe this system from its caller's perspective: what it does, what it can be used for and how to use it. Multiple documents in this system's design/ directory keep this same boundary. A separate subdesign node describes a subsystem's own purpose and usable contract; callers of this system should not need to study child internals.

No project interfaces have been designed yet. For each interface, describe:

- Purpose and supported interactions: what it does, what it can be used for and how callers use it.
- Required inputs and returned information.
- Observable effects and failure behavior.
- Relevant lifecycle rules and guarantees.

Concrete class signatures, routes, schemas and invocation syntax can be settled during implementation.

## Constraints, specifications and requirements

To be clarified with the user. Implementation must follow the accepted design.
