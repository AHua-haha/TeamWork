<!-- Task proposal; current contract is under docs/systems/ -->
# Agent harness

## Purpose and boundary

A harness defines an agent's work scope and authority and supplies tools and file context to the runtime. The lead configures it for a member assigned work under the user's design. Its configuration has exactly two parts: design scope and allowed commands.

The harness also has context-maintenance responsibilities, deferred beyond this prototype increment. Durable context follows the design and subdesigns rather than member identity.

## Inputs and preconditions

- The team supplies the member and assignment based on the user's design.
- The context base supplies design and harness-context files.
- Each design part maintains references to its corresponding implementation directories or files. Harness file permissions follow those references.
- **Design scope** identifies working designs and dependency designs:
  - For a working design, the member reads and follows the design and may read and edit its corresponding implementation.
  - For a dependency design, the member may read its design and implementation and must not edit either through file tools.
  - The member does not edit a working design's contents. The lead helps the user maintain the design, and every design change is made known to the user.
- **Allowed commands** identifies exact whole commands or allowed executables. An executable allowance matches that executable, such as npm or python, with arguments; it is not an arbitrary string prefix.
- Configuration is `{designScope: {working: [design paths], dependencies: [design paths]}, allowedCommands: [rules]}`. Each design path identifies an existing user-context design file. Each list has at most 50 distinct paths; a design cannot be both working and dependency.
- A command rule is `{kind: "exact", argv: [executable, ...arguments]}` or `{kind: "executable", executable: "name-or-path"}`. At most 50 rules are allowed. Matching uses complete arguments or an exact executable name/path, with no implicit shell parsing.
- A design file is a JSON object `{content: "Markdown design text", implementation: [project paths]}`. Implementation paths name files or folders, are relative to the workspace, and may use "." for the whole project. At most 50 paths are allowed. User design and .git/.context are never writable through implementation mappings.

## Outputs and observable effects

- The runtime receives the member's permitted tools, boundary instructions, and relevant file content.
- File tools enforce the design scope's read and edit permissions. Their scope is derived from the design's implementation references rather than configured as another independent file-permission list.
- Command permission checks distinguish an allowed whole command or executable from one that has not been allowed.
- The command tool receives {argv: [executable, ...arguments]}, runs from the workspace directory, and returns exit code, stdout, stderr, and timeout/output-truncation information. The execution limit is 60 seconds and retained output is at most 64 KiB. Cancellation stops the spawned process and its process group where supported.
- Dependency implementation is read-only even if it overlaps working implementation. Its read-only rule takes precedence.
- Design contents and mapped implementation file contents are supplied for each model call up to a 64 KiB section budget, with omitted files named. Listings are bounded and explicitly marked when truncated.
- How permitted command execution interacts with implementation file scopes is deferred to future development.
- A change to members or assignments preserves the associated design and knowledge.

## Failure behavior

A file-tool action outside the member's boundary is refused with a reason. A command that is not allowed is refused. Missing or invalid configuration must be resolved before that member operates under it. Missing or malformed design references prevent a worker run; a lead read can expose raw design content for repair. Command denial uses command_denied; invocation failure uses command_failed. Nonzero exits and timeout are normal command results. Invalid schemas, duplicate references/rules, or unsafe mapping paths fail explicitly. Commands accept 1–128 string arguments, without NUL, at most 10,000 characters each and 20,000 total; the executable is a nonempty name/path of at most 1,024 characters without controls.

## Guarantees and limits

The runtime receives member file tools, command tools when allowances exist, and role-eligible team tools through the harness. Workspace members do not receive unrestricted catalog tools. The lead has bootstrap read access to the workspace and context for helping the user design it, and dedicated tools for visible design changes. Its ordinary writes follow its configured working design.

- Permitted command effects are not confined by the file-tool scope in this prototype. The future execution policy remains undecided; neither a trusted-execution policy nor strict filesystem isolation has been selected.
- Automated harness-context maintenance is deferred.
- File permissions and command allowances are checked at tool execution against current configuration; design and file context are prepared again for each model call. Prior conversation messages remain until later context-management work.

## Acceptance examples

1. The lead assigns a subdesign to a member and configures its harness. The runtime offers only the configured tools and file view.
2. A member reads its working design, edits that design's implementation, and reads a dependency's design and implementation. Its file tool refuses edits to either design and to the dependency's implementation.
3. A member is replaced; its successor is assigned the same design and associated context.
4. An exact command entry permits that command. An executable entry for npm permits npm with arguments and does not permit npmx.
