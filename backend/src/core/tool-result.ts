import type { RuntimeTool } from './agent-runtime.js';
export type ToolOutput = Awaited<ReturnType<RuntimeTool['execute']>>;
export const toolText = (text: string): ToolOutput => ({ content: [{ type: 'text', text }], isError: false });
