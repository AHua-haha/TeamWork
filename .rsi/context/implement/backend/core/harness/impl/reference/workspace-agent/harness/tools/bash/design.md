> Existing behavior reference inside its owning system implementation context. It is not a separate design node; the enclosing high-level design governs ownership. References to historical task documents identify their Git source.

# Bash tool: input, output and execution model

Permission and approval enforcement below describes the default enabled mode. The operator's optional startup setting `harnessPermissionsEnabled: false` bypasses harness permission gates; semantic validation, user activation and runtime lifecycle rules remain in force.

## Purpose and boundary

Run agent-supplied Bash scripts through one persistent shell per member. Support foreground commands and native background jobs, with readable output followed by execution metadata. The agent manages jobs and any output files through ordinary Bash commands.

This contract defines the tool interface, persistent execution, resource policy and failure/lifecycle behavior.

## Inputs and preconditions

```typescript
{
  command: string;
  cwd?: string;
  timeout?: number;      // Seconds
  background?: boolean; // Default false
  metadata?: {
    // No metadata keys are currently defined.
  };
}
```

- command is the original Bash script. Preserve its text and normal Bash semantics, including explicit redirection.
- cwd optionally changes the persistent shell directory before execution. Without cwd, the first invocation starts at the workspace root and subsequent calls use the shell's current directory. If entering an explicit cwd fails, do not run command. cwd does not change or narrow sandbox authority: ordinary cd and actual resource access follow the policy below and underlying OS permissions.
- timeout requests a command lifetime in seconds, including background commands. Foreground defaults to 60 seconds; background has no default timeout. Explicit values must be positive finite seconds up to 2147483 (the timer limit). Foreground expiration resets the shell and its jobs; background expiration terminates that job. This is not merely a timeout on waiting for the background launch response.
- background defaults to false. When true, launch a native background job and return without waiting for completion.
- metadata remains invocation information. Remove the old git.scope selector; commit approval and caller identity are backend-owned. Only an empty metadata object is currently accepted; unknown fields refuse.

Caller identity and shell association come from the backend, not fields supplied by the agent.

### Bash sandbox resource policy

The Bash harness declares resource-access rules for the sandbox. It does not try to establish all permissions or effects by parsing the command string. The sandbox enforces actual resource operations while the shell and its descendants run.

| Resource | Permission |
| --- | --- |
| Entire registered workspace directory | Read and write |
| Workspace-owned temporary directory | Read and write |
| Rest of the system | Read-only, subject to existing OS permissions |
| Network | Allowed |
| Executables | No additional executable restrictions |

This policy applies to the member's persistent shell, foreground programs, scripts, child processes and background jobs. There is no Bash working/dependency-design write restriction and no executable/command allowlist. Existing OS permissions still apply; the harness grants no OS administrator privilege. Reading system paths does not grant writes to them. Writes outside the workspace and its owned temporary area are denied by the intended sandbox boundary, with normal command descriptor handling such as /dev/null remaining available.

The temporary area belongs to this workspace; this is not a grant to every workspace's temporary files or the entire host temporary directory. Its physical location and writable home/cache layout are implementation choices to make without granting additional host write areas.

Network is allowed under the sandbox runtime's supported networking facilities. This decision does not itself grant filesystem access to arbitrary host Unix sockets or Docker daemons; any separate socket configuration remains a separate resource decision.

The whole-workspace write grant includes design/member files and native Git metadata physically under the workspace. Do not preserve hidden .rsi/.git, design, member, dependency or per-member path exclusions as if they were still part of this Bash filesystem policy. Work assignments and maintenance instructions still tell agents where they should work, but do not block Bash filesystem writes inside the workspace.

This Bash policy is independent of other tools: Pi write/edit still use working-design target checks at invocation; Pi read/ls/grep/find retain their separately settled input boundary and default operations. Bash sandbox rules do not become replacement filesystem APIs or a sandbox around those built-ins.

Application acceptance and activation operations remain semantically distinct from editing files. Explicit Git commit requests follow the commit permission/approval rule below; broader Bash access can modify workspace control files. This prototype does not prevent equivalent effects through that broader authority.

## Outputs and observable effects

### One persistent shell per member

Each member reuses its own Bash shell across tool calls. Foreground execution preserves cwd, shell variables, exported environment variables, functions, aliases and shell options according to normal Bash behavior. A foreground cd affects subsequent calls unless an explicit cwd changes it. Another member has independent shell state while project files remain shared.

Foreground commands execute in the existing shell, rather than in an independent fresh bash -c process on every call. Calls to one member shell are serialized. A background job does not occupy the shell's foreground execution slot: the agent can issue subsequent Bash calls while that job runs. A foreground call's completion must not terminate existing background jobs.

A background command inherits the directory/environment at launch. Its own variable or directory changes do not modify the parent shell. It is a native Bash job registered in the same shell that handles later jobs, wait and kill commands.

### Foreground output

Capture the stdout/stderr that the original command leaves available and combine them into one text stream in observed arrival order. Do not duplicate output when command itself uses 2>&1. Explicitly redirected content stays at its chosen destination and does not also appear in the tool result.

Return captured text followed by metadata, with no outer JSON-string envelope. Example:

```text
12 tests passed.

<metadata>
status: "success"
exit_code: 0
duration_ms: 210
truncated: false
</metadata>
```

An empty captured result can use a short no-output notice. Normal Bash semantics determine script exit status; do not silently change shell options to redefine success. A nonzero exit code produces status error and a recoverable tool error while preserving available output. Timeout returns timed_out true and a shell-reset explanation. The next invocation reports shell_restarted true. Cancellation propagates as run cancellation after shell cleanup. A lost shell returns a readable error, resets jobs, and the next call reports fresh state.

Do not include cwd, cwd_before or cwd_after in output metadata. cwd remains an input and part of shell state; the agent can inspect it with pwd.

### Background output defaults and explicit redirection

Background jobs inherit stdout and stderr connected to /dev/null by default. Configure their inherited file descriptors before running the unchanged command. Do not append redirection text that overrides agent-provided redirection. Do not change the parent shell's stdout/stderr defaults for subsequent calls or launch reporting.

| Agent-supplied background command | Effect |
| --- | --- |
| npm run dev | stdout and stderr discarded |
| npm run dev > dev.log | stdout saved in dev.log; stderr discarded |
| npm run dev > dev.log 2>&1 | Both streams saved in dev.log |
| npm run dev 2> errors.log | stderr saved in errors.log; stdout discarded |

The tool does not create output files automatically. The agent chooses any redirection path in command and later reads/manages that file through Bash. Unredirected background output is discarded and cannot be mixed into a later foreground result.

Foreground descriptor capture also honors all explicit redirections: command output is whatever the original script emits to the inherited captured descriptors, not the contents of files it writes.

### Background launch result and management

```text
Started background command.

<metadata>
status: "started"
job_id: 1
</metadata>
```

job_id is the native Bash job number, used as %1 in the originating shell. It is not an application-generated task ID. started confirms launch, not eventual command success or continued execution.

The agent uses ordinary Bash, for example:

```bash
jobs -l
kill %1
wait %1
```

No dedicated output-reading, job-status or stop tool is introduced. The agent obtains current job information and exit status through shell commands. It already knows any chosen output-file path from its own command input.

Return job_id without a PID or automatic output_path. The backend may retain PIDs and associate jobs with member/shell identity, launch time and timeout for lifecycle handling. These are backend bookkeeping, not required model-visible launch fields.

Native job numbers may be reused and are local to one shell. They are temporary handles, not durable identities across shell restarts. Explicitly report a lost/replaced shell so an old handle is not silently treated as referring to a job in a new session. Do not automatically replay a command after shell failure because filesystem effects may already exist.

Structured details may retain execution information for durable storage and frontend rendering; internal process IDs need not be projected into model-visible content. Execution metadata values are JSON-escaped scalars in the footer; the hint section contains readable instruction text. Shell notices, tool errors and truncation guidance stay inside the footer, preserving the captured command output body. Structured details preserves the same model-visible execution facts without internal PIDs.

## Failure behavior

Command launch/execution failures produce recoverable tool errors. Foreground command failure does not stop the whole agent loop. Agent cancellation, storage failure and runtime ownership loss keep their runtime-level semantics. Cancellation of a foreground invocation stops the member shell and all its jobs before the call settles. No external filesystem effects are rolled back.

An explicit cwd failure prevents command execution. Failed commands may have already changed shell state or workspace files. Execution is not transactional and has no automatic rollback or replay.

A sandbox-denied resource operation fails through ordinary command error/exit behavior. It does not roll back earlier allowed operations. Running another program, using a script or backgrounding a command does not grant authority beyond the sandbox policy.

## Guarantees and limits

- One reusable shell per member; no workspace-wide shared shell.
- Preserve original command text. Output handling configures descriptors instead of adding competing redirects to the script.
- Background execution leaves the shell available and defaults both output streams to /dev/null.
- Explicit command redirection retains normal Bash behavior.
- Model-visible output has readable text plus execution metadata; no cwd or PID fields and no automatically created background output file.
- Background handles use native job_id, with no separate application task identifier.
- The Bash policy is broad system-read/workspace-write authority, independent of working-design write/edit checks.

### Lifecycle, output and Git commit approval

Shell state and jobs survive agent-run completion. Context reset and member retirement stop their shells/jobs; successful member-file activation stops affected updated/retired shells; administrative member updates do the same. Backend shutdown stops all remaining shells/jobs and removes its workspace temporary areas. Backend restart starts fresh shells and never replays prior commands. A reset reports a fresh shell on the next invocation. Explicit background timeouts terminate only the relevant native job; foreground timeout/cancellation resets the whole member shell and its jobs.

Commands are noninteractive with stdin /dev/null. The tool returns output on invocation completion. Foreground content retains the last 50 KiB with a truncation notice and advice in metadata to redirect/read selected ranges for more. No automatic foreground or background log file is created. Background launch has a 10-second control-response deadline; if the shell cannot acknowledge, reset it and report the failure. Shell startup has a 10-second deadline. Bash metadata is small and not truncated with command content.

Explicit git commit requests use the [harness commit decision](../../design.md). Evaluate actual candidate contents rather than all dirty files. Implementation-only commits execute; mixed protected/implementation commits refuse with split instructions; design/member-only commits wait for user Accept, Deny or Send feedback. Approval covers exact reviewed contents. Indirect commits inside scripts/programs are outside detection. Other Git operations are native, with no scope selector, controlled Git dialect or backend checkpoints. Member activation remains separate. Foreground execution timeout is suspended while waiting for user input, then resumes with its remaining budget. Cancellation/reset/shutdown removes the pending request; restart never replays it. Explicit commits must be foreground. The harness contract defines supported flags, unknown-path refusal and stale-candidate checks. Commit preparation/execution uses the same sandbox resources and disables commit hooks to preserve reviewed content.

Sandbox rules are fixed for the shell lifetime. Configuration activation/update stops affected shells rather than mutating policy under an existing shell/job. File-tool input authorization remains a separate mechanism. Any backend control IPC must retain narrowly configured sandbox access and must not expand system-read/workspace-write authority. The commit approval IPC socket is granted narrowly on macOS; no obsolete scope-routing socket or Git scope selector remains. Linux depends on bubblewrap/runtime dependencies and is not verified by the macOS-only test environment.

## Acceptance examples

1. A foreground call changes directory and defines a variable. A later call without cwd observes those changes; another member's shell does not.
2. A background launch returns job_id immediately. The agent runs another foreground command, then inspects jobs -l or waits with wait %1 in the same shell.
3. A job emits output after its launch call returned without redirection. That output goes to /dev/null and never appears as an unrelated command's result.
4. The agent includes > dev.log 2>&1 in a background command. Its output reaches dev.log despite inherited /dev/null descriptors. No other output file is created by the tool.
5. A foreground command already uses 2>&1. Captured output appears once, followed by execution metadata.
6. Foreground redirection sends all output to a file. The tool returns metadata only, without a fabricated no-output body or reading that file automatically.
7. A shell has been replaced. The tool reports the changed session; prior job handles are not silently reused and no old command is automatically retried.
8. A member writes another subsystem's file inside the workspace using Bash: the sandbox allows it even if Pi edit would refuse that path for the member's assignment.
9. Bash reads system files readable by the host process: the sandbox adds no working-design read restriction. A normal file write outside the workspace and its owned temporary directory is denied.
10. A command writes to the workspace-owned temporary area or accesses the network: allowed under the configured sandbox resources. No executable allowlist is checked.
11. A background child attempts a denied host write: it remains subject to the same sandbox boundary; its launch as a job does not grant more access.

## Optional permission bypass

The operator may disable harness permission enforcement using the environment's harnessPermissionsEnabled Boolean in the project configuration; omitted means true. The setting takes effect at backend startup. With false, every active member receives all available tools, native file tools accept paths outside the workspace and through links without assignment checks, Bash runs without the OS sandbox, and explicit Git commits run without classification or user approval (including background commits). Ordinary host OS permissions remain, without administrator privilege. Shells retain host HOME and toolchain PATH without receiving backend credentials. Native tool schemas/truncation, input validation, timeouts, cancellation, persistent session cleanup, maintenance responsibilities and user-only configuration activation remain. Restoring true and restarting restores existing harness rules. This mode changes permissions, not configuration validation or group-chat lifecycle rules.
