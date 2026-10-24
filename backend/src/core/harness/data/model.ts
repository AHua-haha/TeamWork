import type { ResolvedDesign } from '../../workspace/design.js';
import type { HarnessDefinition } from './resources.js';
export interface ResolvedHarness {
    working: ResolvedDesign[];
    dependencies: ResolvedDesign[];
    readable: string[];
    writable: string[];
    readonly: string[];
}
export interface PermissionScope {
    designContext: string[];
    implementationContext: string[];
    implementation: string[];
}
export interface HarnessPermissions {
    working: PermissionScope;
    dependencies: PermissionScope;
}
export interface HarnessEnvironment {
    root: string;
    definitions: HarnessDefinition[];
}
