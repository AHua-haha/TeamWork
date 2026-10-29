The Bash tool did not receive confirmation of the background launch within its {{timeout_seconds}}-second launch-response limit.
This is a tool-enforced timeout, not a network timeout reported by the command. The launch was not confirmed; the member shell and all its jobs were stopped, so previous shell state and job handles are no longer available. Earlier filesystem effects are not rolled back.

Inspect existing files or logs before choosing whether to retry. Long-running work should use background: true with explicit output redirection; background jobs have no default execution timeout, but their launch must be acknowledged promptly. No command is retried automatically.
