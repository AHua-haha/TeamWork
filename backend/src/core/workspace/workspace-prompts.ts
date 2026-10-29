import {readFileSync} from 'node:fs';
import {AppError} from '../errors.js';
export function workspacePrompt(name: 'design-template' | 'implementation-context-template', values: Readonly<Record<string, string>>): string {
  const text = readFileSync(new URL(`../../../prompts/workspace/${name}.md`, import.meta.url), 'utf8').trim();
  if (!text) throw new AppError('invalid_config', `Required Workspace prompt is empty: ${name}`, 500);
  return text.replace(/\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g, (_placeholder, key: string) => {
    if (!Object.hasOwn(values, key)) throw new AppError('invalid_config', `Missing Workspace prompt value: ${name}.${key}`, 500);
    return values[key]!;
  });
}
