import type {AssistantMessage} from '@earendil-works/pi-ai';
import type {ReactHarness, ReactHarnessContext, ReactHarnessFactory} from '../contracts.js';
import type {RuntimeTool} from '../../agent/data/index.js';
import {defaultTools} from './tools.js';
import {defaultPrompt} from './prompts.js';

/** Fallback for every unclaimed configured tool, preserving its existing executor and paired result. */
export class DefaultReactHarness implements ReactHarness {
  constructor(private readonly root?: string, private readonly extraTools: RuntimeTool[] = []) {}
  canHandle(_response: AssistantMessage): boolean { return true; }
  tools(): RuntimeTool[] { return this.root ? defaultTools(this.root, this.extraTools) : []; }
  systemPrompt(): string {
    if (!this.root) return '';
    return defaultPrompt('instructions');
  }
  async handle(_response: AssistantMessage, context: ReactHarnessContext): Promise<void> {
    for (const call of context.toolCalls) await context.execute(call);
  }
}
export function defaultReactHarnessFactory(root: string, tools: RuntimeTool[]): ReactHarnessFactory {
  return {harnessId: 'default', create: () => new DefaultReactHarness(root, tools)};
}
