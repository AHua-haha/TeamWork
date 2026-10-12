/** The member a call is addressed to, read from its arguments, or null when they cannot be read. */
export function callRecipient(argsText: string | undefined): string | null {
  if (!argsText) return null;
  try {
    const value: unknown = JSON.parse(argsText);
    const to = value && typeof value === 'object' && 'to' in value ? value.to : null;
    return typeof to === 'string' && to.trim() && to.length <= 80 ? to.trim() : null;
  } catch { return null; }
}

/** The heading of a tool card: a call between members names the recipient; any other tool keeps its name. */
export function toolHeading(toolName: string, argsText: string | undefined): string {
  if (toolName === 'save_design') return 'Update design';
  if (toolName === 'read_design') return 'Read design';
  if (toolName === 'run_command') return 'Run command';
  if (toolName === 'configure_harness') return `Configure harness${callRecipient(argsText) ? ' → ' + callRecipient(argsText) : ''}`;
  if (toolName !== 'send_message' && toolName !== 'assign_member') return toolName;
  const to = callRecipient(argsText);
  return to ? `${toolName === 'assign_member' ? 'Assign →' : '→'} ${to}` : toolName;
}

/** The labels of the card's two parts: a call's input is the message, and its result is the final response. */
export function toolLabels(toolName: string): { input: string; output: string } {
  if (toolName === 'send_message') return { input: 'Message', output: 'Response' };
  if (toolName === 'assign_member') return { input: 'Assignment', output: 'Report' };
  if (toolName === 'configure_harness') return { input: 'Design scope and allowed commands', output: 'Member harness' };
  if (toolName === 'run_command') return { input: 'Command', output: 'Exit status and output' };
  if (toolName === 'save_design') return { input: 'Design change', output: 'Applied change' };
  if (toolName === 'read_design') return { input: 'Design file', output: 'Current design and revision' };
  return { input: 'Arguments', output: 'Result' };
}
