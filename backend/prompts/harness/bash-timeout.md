The command exceeded the Bash tool's foreground execution limit of {{timeout_seconds}} seconds.
This timeout was enforced by the tool; it is not a network timeout reported by the command.

The member shell and all its jobs were stopped. Previous shell variables, cwd changes and job handles are no longer available. Earlier filesystem effects are not rolled back.

For long-running operations such as dependency installation, explicitly retry with background: true and redirect output to a log file.
Example Bash input: {"command":"npm install > install.log 2>&1","background":true}

Monitor progress with short Bash calls such as tail -n 50 install.log and jobs -l. Use the returned job_id as %N to inspect or stop the job. A foreground wait %N is still subject to the foreground time limit, so avoid blocking on a long-running job. Background output defaults to /dev/null unless you redirect it. No command is retried automatically.
