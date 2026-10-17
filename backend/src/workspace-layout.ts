import { AppError } from './types.js';
import { contextPath } from './context-base.js';
/** Workspace-owned filesystem state; API context paths remain user/... and agent/.... */
export const managedRoot = '.rsi';
export const contextRoot = `${managedRoot}/context`;
export const designRoot = `${contextRoot}/user`;
export const memberRoot = `${managedRoot}/members`;
export const rootDesignPath = 'user/design.json';

/** Each design has its own Markdown context; preserve its extension to avoid collisions. */
export function implementationContextPath(design: string): string {
  contextPath(design);
  if (!design.startsWith('user/')) throw new AppError('invalid_path', 'Implementation context requires a user design');
  return contextPath(`agent/${design.slice('user/'.length).toLowerCase()}.md`);
}
