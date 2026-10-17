import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ContextCommit, WorkspaceRecord } from './context-base.js';
import { purposeHarnesses } from './harness-bases.js';
import { HarnessHistory, harnessStorage } from './harness-history.js';
import type { NewMember, MemberActivationState } from './team.js';
import { sha256 } from './text.js';
import { AppError } from './types.js';
import { contextRoot, designRoot, managedRoot, rootDesignPath } from './workspace-layout.js';

export interface WorkspaceBootstrap { activation: MemberActivationState; context: ContextCommit }
/** Prepare all initial files/history before the registry can expose the workspace. */
export async function bootstrapWorkspace(workspace: WorkspaceRecord, lead: NewMember): Promise<WorkspaceBootstrap> {
  if ((await readdir(workspace.directory)).some(name => name.toLowerCase() === managedRoot)) throw new AppError('file_exists', `${managedRoot} already exists; adopt a project without managed state`, 409);
  const root = join(workspace.directory, managedRoot);
  await mkdir(root);
  try {
    await mkdir(join(workspace.directory, designRoot), { recursive: true });
    await mkdir(join(workspace.directory, contextRoot, 'agent'));
    const content = JSON.stringify({ content: `# ${workspace.name}\n\nMaintain this project's goals, scope and design here.`, implementation: [] }, null, 2) + '\n';
    const path = rootDesignPath, absolute = join(workspace.directory, contextRoot, path);
    await writeFile(absolute, content, { flag: 'wx' });
    for (const [path, content] of Object.entries(lead.value.configuration!.files)) {
      const absolute = join(workspace.directory, dirname(lead.value.configuration!.path), path);
      await mkdir(dirname(absolute), { recursive: true }); await writeFile(absolute, content, { flag: 'wx' });
    }
    const history = new HarnessHistory(harnessStorage(workspace.directory), workspace.directory);
    await history.open();
    const worktree = await history.worktree(lead.id);
    let memberRevision = '';
    for (const part of purposeHarnesses({ ...lead, revision: 0 }).flatMap(harness => harness.parts)) {
      const state = await history.ensure(lead.id, part, worktree);
      if (part.id === 'member-config') memberRevision = state.committed;
    }
    await history.initializeMemberBundle(lead.id, lead.value.configuration!.path, async () => {});
    lead.value.configuration!.acceptedRevision = memberRevision;
    lead.value.configuration!.submittedBy = 'harness';
    const hash = sha256(content), size = Buffer.byteLength(content), time = workspace.createdAt, fileId = randomUUID(), revision = randomUUID();
    const author = { type: 'user' as const }, reason = 'Workspace bootstrap';
    const version = { fileId, seq: 1, revision, action: 'create' as const, path, fromPath: null, hash, size, time, author, reason };
    return {
      activation: { revision: memberRevision, time },
      context: { seq: 1, blobs: [{ hash, content, size }], versions: [version], removeKeys: [], files: [{ path, fileId, revision, hash, size, mtimeMs: (await stat(absolute)).mtimeMs, updatedAt: time, author, reason }], record: { seq: 1, time, author, reason, files: [{ action: 'create', path, fromPath: null, revision }] } },
    };
  } catch (error) { await rm(root, { recursive: true, force: true }); throw error; }
}
