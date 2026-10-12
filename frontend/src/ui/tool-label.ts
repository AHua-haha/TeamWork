/** The member a `send_message` call is addressed to, read from the call's arguments, or null when they cannot be read. */
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
  if (toolName !== 'send_message') return toolName;
  const to = callRecipient(argsText);
  return to ? `→ ${to}` : toolName;
}

/** The labels of the card's two parts: a call's input is the message, and its result is the final response. */
export function toolLabels(toolName: string): { input: string; output: string } {
  return toolName === 'send_message' ? { input: 'Message', output: 'Response' } : { input: 'Arguments', output: 'Result' };
}
