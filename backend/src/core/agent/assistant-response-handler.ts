import type { AssistantMessage } from '@earendil-works/pi-ai';
import type { AssistantResponseHandler, AssistantResponseHandlerContext } from './contracts.js';

/** Compatibility fallback: run every unclaimed configured tool with existing Harness execution and native result construction. */
export class DefaultAssistantResponseHandler implements AssistantResponseHandler {
  canHandle(_response: AssistantMessage): boolean { return true; }
  async handle(_response: AssistantMessage, context: AssistantResponseHandlerContext): Promise<void> {
    for (const call of context.toolCalls) await context.execute(call);
  }
}
