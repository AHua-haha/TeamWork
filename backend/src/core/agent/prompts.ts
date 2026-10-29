import {readFileSync} from 'node:fs';
import {AppError} from './data/model.js';
const names = ['bash-timeout', 'bash-background-timeout', 'context-compaction', 'default-react-harness'] as const;
type PromptName = typeof names[number];
const prompts = new Map(names.map(name => {
  const path = new URL(`../../../prompts/agent/${name}.md`, import.meta.url);
  const text = readFileSync(path, 'utf8').trim();
  if (!text) throw new AppError('invalid_config', `Required Agent prompt is empty: ${path.pathname}`, 500);
  return [name, text];
}));
export function agentPrompt(name: PromptName, values: Readonly<Record<string, string>> = {}): string {
  return prompts.get(name)!.replace(/\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g, (_placeholder, key: string) => {
    if (!Object.hasOwn(values, key)) throw new AppError('invalid_config', `Missing Agent prompt value: ${name}.${key}`, 500);
    return values[key]!;
  });
}
