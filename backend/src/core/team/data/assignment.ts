import {contextPath} from '../../workspace/data/paths.js';
import {AppError} from '../../agent/data/model.js';

/** Team-owned responsibility assignment, independent of tool capabilities or permission. */
export interface DesignScope {working: string[]; dependencies: string[]}
export const emptyDesignScope = (): DesignScope => ({working: [], dependencies: []});
function paths(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 50) throw new AppError('invalid_config', 'A design scope lists at most 50 design files');
  const result = value.map(path => {
    if (typeof path !== 'string') throw new AppError('invalid_config', 'A design reference must be a context-relative path');
    return contextPath(path.replace(/^\.rsi\/context\/design\//i, '').replace(/^design\//i, ''));
  });
  if (new Set(result.map(path => path.toLowerCase())).size !== result.length) throw new AppError('invalid_config', 'Duplicate design scope paths');
  return result;
}
export function parseDesignScope(value: unknown): DesignScope {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['working', 'dependencies'].includes(key))) throw new AppError('invalid_config', 'Design scope has fields working, dependencies');
  const data = value as Record<string, unknown>, working = paths(data.working), dependencies = paths(data.dependencies);
  if (working.some(path => dependencies.some(other => other.toLowerCase() === path.toLowerCase()))) throw new AppError('invalid_config', 'A design cannot be both working and dependency');
  return {working, dependencies};
}
