import type { RuntimeTool } from '../contracts.js';
export type ToolOutput = Awaited<ReturnType<RuntimeTool['execute']>>;
export const toolText = (text: string): ToolOutput => ({ content: [{ type: 'text', text }], isError: false });
