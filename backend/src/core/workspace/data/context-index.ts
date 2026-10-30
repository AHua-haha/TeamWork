/** Disposable project-context metadata. No document or source bodies belong in this model. */
export interface ContextDiagnostic {
  path: string;
  code: string;
  message: string;
  severity: 'warning' | 'error';
}
export interface ConsumerMetadata {
  summary: string | null;
  include: readonly string[];
}
export interface DesignSystemMetadata {
  projectPath: string;
  kind: 'directory' | 'file';
  contextDirectory: string;
  designReference: string;
  documents: {design: string; readme?: string};
  metadata: ConsumerMetadata;
  /** Fingerprint of the metadata header only, not the Markdown body. */
  readmeHeaderHash?: string;
  metadataValid: boolean;
}
export interface ProjectContextNode {
  projectPath: string;
  kind: 'directory' | 'file';
  /** Only the node's own design system is bound; never an inherited binding. */
  designSystemPath?: string;
  children?: ProjectContextNode[];
}
export interface ContextIndexSnapshot {
  revision: string;
  refreshedAt: number;
  contextRoot: string;
  format: 'project' | 'legacy';
  tree: ProjectContextNode;
  designSystems: Readonly<Record<string, DesignSystemMetadata>>;
  diagnostics: readonly ContextDiagnostic[];
}

/** Share a frozen published view without copying the complete project tree on every read. */
export function freezeContextIndex(snapshot: ContextIndexSnapshot): ContextIndexSnapshot {
  const freeze = (value: object): void => {
    for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child);
    Object.freeze(value);
  };
  freeze(snapshot);
  return snapshot;
}
