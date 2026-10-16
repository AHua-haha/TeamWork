import { designPath } from './design.js';
import { AppError } from './types.js';

export type CommandRule = { kind: 'exact'; argv: string[] } | { kind: 'executable'; executable: string };
export interface HarnessConfig {
  designScope: { working: string[]; dependencies: string[] };
  allowedCommands: CommandRule[];
}
export interface EffectiveHarnessConfig extends HarnessConfig { implementationScope: { paths: string[]; usePaths: string[] } }
export const emptyHarness = (): HarnessConfig => ({ designScope: { working: [], dependencies: [] }, allowedCommands: [] });

function object(value: unknown, allowed: string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new AppError('invalid_config', `${label} has fields ${allowed.join(', ')}`);
  return value as Record<string, unknown>;
}
function paths(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 50) throw new AppError('invalid_config', 'A design scope lists at most 50 design files');
  const result = value.map(designPath);
  if (new Set(result.map(path => path.toLowerCase())).size !== result.length) throw new AppError('invalid_config', 'Duplicate design scope paths');
  return result;
}
export function commandArgv(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || value.length > 128 || value.some(arg => typeof arg !== 'string' || arg.includes('\0') || arg.length > 10_000)) throw new AppError('invalid_input', 'A command is an argument vector of 1–128 strings without NUL characters');
  executable(value[0]);
  if (value.join('').length > 20_000) throw new AppError('invalid_input', 'A command is at most 20,000 characters');
  return value as string[];
}
function executable(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 1024 || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) throw new AppError('invalid_input', 'An executable is a non-empty name or path without control characters');
  return value;
}
export function harnessConfig(value: unknown): HarnessConfig {
  const data = object(value, ['designScope', 'allowedCommands'], 'Harness');
  const scope = object(data.designScope, ['working', 'dependencies'], 'Design scope');
  const working = paths(scope.working), dependencies = paths(scope.dependencies);
  if (working.some(path => dependencies.some(other => other.toLowerCase() === path.toLowerCase()))) throw new AppError('invalid_config', 'A design cannot be both working and dependency');
  if (!Array.isArray(data.allowedCommands) || data.allowedCommands.length > 50) throw new AppError('invalid_config', 'At most 50 command rules are allowed');
  const allowedCommands = data.allowedCommands.map((value): CommandRule => {
    const rule = object(value, ['kind', 'argv', 'executable'], 'Command rule');
    if (rule.kind === 'exact' && !('executable' in rule)) return { kind: 'exact', argv: commandArgv(rule.argv) };
    if (rule.kind === 'executable' && !('argv' in rule)) return { kind: 'executable', executable: executable(rule.executable) };
    throw new AppError('invalid_config', 'A command rule is exact with argv, or executable with an executable name');
  });
  if (new Set(allowedCommands.map(rule => JSON.stringify(rule))).size !== allowedCommands.length) throw new AppError('invalid_config', 'Duplicate command rules');
  return { designScope: { working, dependencies }, allowedCommands };
}
export function commandAllowed(rules: readonly CommandRule[], argv: readonly string[]): boolean {
  return rules.some(rule => rule.kind === 'executable' ? rule.executable === argv[0] : rule.argv.length === argv.length && rule.argv.every((arg, index) => arg === argv[index]));
}
