/** Workspace-owned filesystem state; API context paths remain user/... and agent/.... */
export const managedRoot = '.rsi';
export const contextRoot = `${managedRoot}/context`;
export const designRoot = `${contextRoot}/user`;
export const memberRoot = `${managedRoot}/members`;
export const rootDesignPath = 'user/design.json';
