import { Type, type Message } from '@earendil-works/pi-ai';
import type { RuntimeTool } from './runtime.js';
import { chatText } from './group-chat.js';
import { toolText } from './tool-result.js';

export const finalResponseTool = 'final_response';
export interface MessageOutput { response: { toolCallId: string; text: string } }
/** Explicit presentation projected from persisted Pi content, never from prose or stop reason. */
export function responseOutput(message: Message): MessageOutput | undefined {
  if (message.role !== 'assistant') return undefined;
  const calls = message.content.filter(part => part.type === 'toolCall');
  const call = calls[0];
  if (calls.length !== 1 || call?.name !== finalResponseTool) return undefined;
  return { response: { toolCallId: call.id, text: typeof call.arguments?.text === 'string' ? call.arguments.text : '' } };
}
/** Preparing the response is a regular tool effect; the team publishes after its result is stored. */
export function responseTool(): RuntimeTool {
  return {
    definition: { name: finalResponseTool, description: 'Finish this activation by composing the final shared response. Put the complete Markdown reply in text. Use this tool alone after all work/tools are finished. Ordinary assistant prose is private working commentary and does not publish a response. Mentions in text trigger recipients only after publication is accepted.', parameters: Type.Object({ text: Type.String({ minLength: 1, maxLength: 20_000 }) }) },
    execute: async args => { chatText(args.text); return toolText('Response prepared for publication.'); },
  };
}
