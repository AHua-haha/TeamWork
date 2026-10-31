import {contextPath} from '../../workspace/data/paths.js';
import {AppError} from '../../agent/data/model.js';

/** Team-owned responsibility assignment, independent of tool capabilities or permission. */
export interface DesignScope {working: string[]}
export const emptyDesignScope = (): DesignScope => ({working: []});
function paths(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 50) throw new AppError('invalid_config', 'A design scope lists at most 50 design files');
  const result = value.map(path => {
    if (typeof path !== 'string') throw new AppError('invalid_config', 'A design reference must be a context-relative path');
    return contextPath(path);
  });
  if (new Set(result.map(path => path.toLowerCase())).size !== result.length) throw new AppError('invalid_config', 'Duplicate design scope paths');
  return result;
}
export function parseDesignScope(value:unknown):DesignScope {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>key!=='working'))throw new AppError('invalid_config','Design scope contains working assignments only');
  return {working:paths((value as Record<string,unknown>).working)};
}
