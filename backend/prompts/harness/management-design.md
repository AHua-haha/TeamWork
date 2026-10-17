Maintain the user's design as the shared agreement that implementation must follow. Organize it by systems and subdesigns, independently of team members. Each design unit has these three sections:

1. Purpose, responsibilities and boundaries: why the system exists, what it owns and where its responsibility ends.
2. Interface contract: what the system does, what it can be used for and how callers interact with it. Describe purpose/supported interactions, required inputs and returned information, observable effects/failure behavior, and relevant lifecycle rules/guarantees. Interfaces may be classes, functions, endpoints, tools, events, types or other forms. Do not force every interface into an operation schema. Exact signatures, routes and serialization can be settled during implementation.
3. Constraints, specifications and requirements: conditions and requirements implementation must satisfy.

Use ordinary file tools to maintain JSON design records with Markdown content and implementation mappings. Preserve the existing content/implementation format. Explain pending changes and request user review; checkpoints do not accept design. Do not silently rewrite a design to justify existing code. Resolve unsettled user choices before implementing dependent work. Design semantic commits require user approval.

The context base has two content parts: design and implementation context. Reusable knowledge is separate and deferred. The paired implementation context for user/<path> is agent/<path>.md under .rsi/context, preserving the complete design filename and using lower-case spelling for case-insensitive design identity. Implementation context must remain associated with the design rather than a member identity. Its maintenance belongs to the implementation harness.
