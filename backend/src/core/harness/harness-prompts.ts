import { readFileSync } from 'node:fs';
import { AppError } from '../agent/data/model.js';

const names = ['bash-timeout', 'bash-background-timeout', 'context-compaction', 'permissions-disabled', 'common', 'management', 'management-design', 'management-members', 'implementation', 'implementation-scope', 'implementation-context', 'design-template', 'implementation-context-template', 'execute'] as const;
type PromptName = typeof names[number];
const templates = new Map<PromptName, string>(names.map(name => {
  const file = new URL(`../../../prompts/harness/${name}.md`, import.meta.url);
  const content = readFileSync(file, 'utf8').trim();
  if (!content) throw new AppError('invalid_config', `Required harness prompt is empty: ${file.pathname}`, 500);
  return [name, content];
}));

/** Release-owned rules, loaded once; supplied values are data rather than policy. */
export function harnessPrompt(name: PromptName, values: Readonly<Record<string, string>> = {}): string {
  return templates.get(name)!.replace(/\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g, (_placeholder, key: string) => {
    if (!Object.hasOwn(values, key)) throw new AppError('invalid_config', `Missing harness prompt value: ${name}.${key}`, 500);
    return values[key]!;
  });
}
