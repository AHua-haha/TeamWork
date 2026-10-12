import type { RuntimeTool } from './runtime.js';
import { AppError } from './types.js';
export type ToolOutput = Awaited<ReturnType<RuntimeTool['execute']>>;
export const toolText = (text: string): ToolOutput => ({ content: [{ type: 'text', text }], isError: false });
/** Refusals and expected operation failures are results the agent may act on. */
export async function refusing(body: () => Promise<string>): Promise<ToolOutput> {
  try { return toolText(await body()); }
  catch (error) {
    if (error instanceof AppError && error.status < 500) return toolText(`Refused (${error.code}): ${error.message}`);
    throw error;
  }
}
