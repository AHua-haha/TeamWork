import {Type, type JsonObject} from '@earendil-works/pi-ai';
import {maxGroupSummaryCharacters, type GroupSummary} from './data/group-summary.js';
import type {RuntimeTool} from '../agent/contracts.js';
export function groupSummaryTool(submit: (text: string) => Promise<GroupSummary>): RuntimeTool {
  return {
    definition: { name: 'submit_group_summary', description: 'Submit the updated shared summary of the supplied older group context. Keep the latest 30 original messages outside the summary. If rejected, correct the summary using the tool feedback and submit again.',
      parameters: Type.Object({ summary: Type.String({ minLength: 1, maxLength: maxGroupSummaryCharacters, description: 'Concise plain-text or Markdown summary of the supplied previous summary and older messages only.' }) }, { additionalProperties: false }) },
    execute: async (args: JsonObject) => {
      const result = await submit(args.summary as string);
      return { content: [{ type: 'text', text: `Group summary accepted for positions ${result.from}-${result.through}. The latest 30 original messages remain unchanged.` }],
        details: { revision: result.revision, from: result.from, through: result.through, analyzedThrough: result.analyzedThrough, retainedMessages: 30 }, isError: false };
    },
  };
}
