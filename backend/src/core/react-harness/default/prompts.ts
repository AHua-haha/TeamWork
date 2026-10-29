import {readFileSync} from 'node:fs';
import {AppError} from '../../errors.js';
const names = ['instructions', 'bash-timeout', 'bash-background-timeout'] as const;
const prompts = new Map(names.map(name => {
  const text = readFileSync(new URL(`./prompts/${name}.md`, import.meta.url), 'utf8').trim();
  if (!text) throw new AppError('invalid_config', `Required React Harness prompt is empty: ${name}`, 500);
  return [name, text];
}));
export function defaultPrompt(name: typeof names[number], values: Readonly<Record<string,string>> = {}): string {
  return prompts.get(name)!.replace(/\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g, (_placeholder, key: string) => {
    if (!Object.hasOwn(values,key)) throw new AppError('invalid_config', `Missing React Harness prompt value: ${name}.${key}`, 500);
    return values[key]!;
  });
}
