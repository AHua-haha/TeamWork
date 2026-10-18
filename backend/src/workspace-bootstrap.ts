import { harnessPrompt } from './harness-prompts.js';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ContextCommit, WorkspaceRecord } from './context-base.js';
import { purposeHarnesses } from './harness-bases.js';
import { HarnessHistory, harnessStorage } from './harness-history.js';
import type { NewMember, MemberActivationState } from './team.js';
import { sha256 } from './text.js';
import { AppError } from './types.js';
import { contextRoot, designRoot, managedRoot, rootDesignPath, implementationContextPath, metadataPath, contextPaths } from './workspace-layout.js';

export interface WorkspaceBootstrap { activation: MemberActivationState; context: ContextCommit }
/** Prepare all initial files/history before the registry can expose the workspace. */
export async function bootstrapWorkspace(workspace: WorkspaceRecord, lead: NewMember): Promise<WorkspaceBootstrap> {
  if ((await readdir(workspace.directory)).some(name => name.toLowerCase() === managedRoot)) throw new AppError('file_exists', `${managedRoot} already exists; adopt a project without managed state`, 409);
  const root = join(workspace.directory, managedRoot);
  await mkdir(root);
  try {
    await mkdir(join(workspace.directory, designRoot), { recursive: true });
    const initial = [
      { path: metadataPath(rootDesignPath), content: JSON.stringify({ implementation: [] }, null, 2) + '\n' },
      { path: contextPaths(rootDesignPath,'design')[0]!, content: harnessPrompt('design-template', { project: workspace.name }) + '\n' },
      { path: implementationContextPath(rootDesignPath), content: harnessPrompt('implementation-context-template', { design: rootDesignPath }) + '\n' },
    ];
    for (const file of initial) { const absolute=join(workspace.directory,contextRoot,file.path); await mkdir(dirname(absolute),{recursive:true}); await writeFile(absolute,file.content,{flag:'wx'}); }
    for (const [path, content] of Object.entries(lead.value.configuration!.files)) {
      const absolute = join(workspace.directory, dirname(lead.value.configuration!.path), path);
      await mkdir(dirname(absolute), { recursive: true }); await writeFile(absolute, content, { flag: 'wx' });
    }
    const history = new HarnessHistory(harnessStorage(workspace.directory), workspace.directory);
    await history.open();
    const rootDirectory = workspace.directory;
    let memberRevision = '';
    for (const part of purposeHarnesses({ ...lead, revision: 0 }).flatMap(harness => harness.parts)) {
      const state = await history.ensure(lead.id, part, rootDirectory);
      if (part.id === 'member-config') memberRevision = state.committed;
    }
    await history.initializeMemberBundle(lead.id, lead.value.configuration!.path, async () => {});
    lead.value.configuration!.acceptedRevision = memberRevision;
    lead.value.configuration!.submittedBy = 'harness';
    const context: ContextCommit = { seq: 1, blobs: [], versions: [], removeKeys: [], files: [], record: { seq: 1, time: workspace.createdAt, author: { type: 'user' }, reason: 'Workspace bootstrap', files: [] } };
    for (const { path, content } of initial) {
      const hash = sha256(content), size = Buffer.byteLength(content), time = workspace.createdAt, fileId = randomUUID(), revision = randomUUID();
      const author = { type: 'user' as const }, reason = 'Workspace bootstrap';
      context.blobs.push({ hash, content, size });
      context.versions.push({ fileId, seq: 1, revision, action: 'create', path, fromPath: null, hash, size, time, author, reason });
      context.files.push({ path, fileId, revision, hash, size, mtimeMs: (await stat(join(workspace.directory, contextRoot, path))).mtimeMs, updatedAt: time, author, reason });
      context.record.files.push({ action: 'create', path, fromPath: null, revision });
    }
    return { activation: { revision: memberRevision, time: workspace.createdAt }, context };
  } catch (error) { await rm(root, { recursive: true, force: true }); throw error; }
}
