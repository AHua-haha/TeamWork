import { newLead } from './team/data/members.js';
import { harnessPrompt } from './harness/harness-prompts.js';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import type { ContextCommit, WorkspaceRecord } from './workspace/data/context-base.js';
import { filesRevision, type GitBaseline } from './workspace/workspace-git.js';
import type { NewMember, MemberActivationState } from './team/data/members.js';
import { sha256 } from './text.js';
import { PreparedWorkspaceFiles } from './workspace/workspace-initialization.js';
import { contextRoot, rootDesignPath, metadataPath, contextPaths, memberContextPath } from './workspace/workspace-layout.js';

export interface WorkspaceBootstrap { baseline: GitBaseline; activation: MemberActivationState; context: ContextCommit }
/** Prepare files and their imported baseline; the caller owns registration/rollback. */
async function bootstrapWorkspace(workspace: WorkspaceRecord, lead: NewMember, files: PreparedWorkspaceFiles): Promise<WorkspaceBootstrap> {
  await files.mkdir(contextRoot);
  await files.create(`${contextRoot}/${metadataPath(rootDesignPath)}`, JSON.stringify({ implementation: [] }, null, 2) + '\n');
  const [designFile, designDirectory] = contextPaths(rootDesignPath, 'design');
  if (!await files.exists(`${contextRoot}/${designFile}`, 'file')) {
    const path = await files.exists(`${contextRoot}/${designDirectory}`, 'directory') ? `${designDirectory}/README.md` : designFile;
    await files.create(`${contextRoot}/${path}`, harnessPrompt('design-template', { project: workspace.name }) + '\n');
  }
  const [implFile] = contextPaths(rootDesignPath, 'impl');
  if (!await files.exists(`${contextRoot}/${implFile}`, 'file'))
    await files.create(memberContextPath(rootDesignPath), harnessPrompt('implementation-context-template', { design: rootDesignPath }) + '\n');
  for (const [path, content] of Object.entries(lead.value.configuration!.files))
    await files.create(join(dirname(lead.value.configuration!.path), path), content);
  const initial = await files.contextFiles();
  const baseline: GitBaseline = { time:workspace.createdAt, design: {}, members: {} };
  for(const {path,content} of initial) if(path.startsWith('design/'))baseline.design[`${contextRoot}/${path}`]=content;
  for(const [path,content] of Object.entries(lead.value.configuration!.files))baseline.members[join(dirname(lead.value.configuration!.path),path)]=content;
  const memberRevision = filesRevision(baseline.members);
  lead.value.configuration!.acceptedRevision = memberRevision;
  lead.value.configuration!.submittedBy = 'harness';
  const context: ContextCommit = { seq: 1, blobs: [], versions: [], removeKeys: [], files: [], record: { seq: 1, time: workspace.createdAt, author: { type: 'user' }, reason: 'Workspace bootstrap', files: [] } };
  for (const { path, content, mtimeMs } of initial) {
    const hash = sha256(content), size = Buffer.byteLength(content), time = workspace.createdAt, fileId = randomUUID(), revision = randomUUID();
    const author = { type: 'user' as const }, reason = 'Workspace bootstrap';
    context.blobs.push({ hash, content, size });
    context.versions.push({ fileId, seq: 1, revision, action: 'create', path, fromPath: null, hash, size, time, author, reason });
    context.files.push({ path, fileId, revision, hash, size, mtimeMs, updatedAt: time, author, reason });
    context.record.files.push({ action: 'create', path, fromPath: null, revision });
  }
  return { baseline, activation: { revision: memberRevision, time: workspace.createdAt }, context };
}

/** Core coordinates Team's initial member with Workspace's initial context and files. */
export async function prepareWorkspace(workspace: WorkspaceRecord, settings: import('./team/data/config.js').RunSettings, cleanupRevision?: string) {
  const files = await PreparedWorkspaceFiles.begin(workspace.directory, cleanupRevision);
  try {
    const lead = newLead(workspace.workspaceId, settings, [rootDesignPath]);
    const bootstrap = await bootstrapWorkspace(workspace, lead, files);
    return { lead, bootstrap, files };
  } catch (error) { await files.rollback(); throw error; }
}
