import { harnessPrompt } from '../harness/harness-prompts.js';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ContextCommit, WorkspaceRecord } from '../workspace/context-base.js';
import { filesRevision, type GitBaseline } from '../workspace/workspace-git.js';
import type { NewMember, MemberActivationState } from '../team/team.js';
import { sha256 } from '../../foundation/text.js';
import { AppError } from '../../foundation/types.js';
import { contextRoot, designRoot, managedRoot, rootDesignPath, metadataPath, contextPaths, memberContextPath } from '../workspace/workspace-layout.js';

export interface WorkspaceBootstrap { baseline: GitBaseline; activation: MemberActivationState; context: ContextCommit }
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
      { path: memberContextPath(rootDesignPath).slice(contextRoot.length + 1), content: harnessPrompt('implementation-context-template', { design: rootDesignPath }) + '\n' },
    ];
    for (const file of initial) { const absolute=join(workspace.directory,contextRoot,file.path); await mkdir(dirname(absolute),{recursive:true}); await writeFile(absolute,file.content,{flag:'wx'}); }
    for (const [path, content] of Object.entries(lead.value.configuration!.files)) {
      const absolute = join(workspace.directory, dirname(lead.value.configuration!.path), path);
      await mkdir(dirname(absolute), { recursive: true }); await writeFile(absolute, content, { flag: 'wx' });
    }
    const baseline: GitBaseline = { time:workspace.createdAt, design: {}, members: {} };
    for(const {path,content} of initial) if(path.startsWith('design/'))baseline.design[`${contextRoot}/${path}`]=content;
    for(const [path,content] of Object.entries(lead.value.configuration!.files))baseline.members[join(dirname(lead.value.configuration!.path),path)]=content;
    const memberRevision = filesRevision(baseline.members);
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
    return { baseline, activation: { revision: memberRevision, time: workspace.createdAt }, context };
  } catch (error) { await rm(root, { recursive: true, force: true }); throw error; }
}
