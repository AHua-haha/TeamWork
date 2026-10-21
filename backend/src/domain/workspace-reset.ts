import { randomUUID } from 'node:crypto';
import { lstat, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Store } from '../storage/store.js';
import { missing, sha256 } from '../foundation/text.js';

const tables = ['chat_changes', 'chat_entries', 'chat_clock', 'member_context_runs', 'member_contexts', 'chat_runs', 'chat_messages', 'chat_images', 'chat_exchanges', 'chat_settings', 'messages', 'runs', 'members', 'workspace_git_baselines', 'member_activation', 'context_files', 'context_versions', 'context_blobs', 'context_records', 'workspace_models', 'workspaces', 'agents'];
/** Administrative reset, never an agent or HTTP capability. Requires exclusive database ownership. */
export async function resetWorkspaceData(store: Store) {
  await store.acquireRuntime(() => {});
  const moved: { from: string; to: string }[] = [];
  try {
    const workspaces = await store.listWorkspaces();
    const paths = [...new Set(workspaces.flatMap(workspace => [
      ...['.rsi', '.context', '.team'].map(name => join(workspace.directory, name)),
      join(dirname(workspace.directory), '.rsi-harness', sha256(workspace.directory)),
    ]))];
    const db = await store.pool.getConnection();
    try {
      // Move managed paths aside before deleting records, so a failed transaction can restore them.
      for (const from of paths) {
        try { await lstat(from); } catch (error) { if (missing(error)) continue; throw error; }
        const to = `${from}.reset-${randomUUID()}`;
        await rename(from, to); moved.push({ from, to });
      }
      const [existing] = await db.query('SHOW TABLES');
      const available = new Set((existing as Record<string, string>[]).flatMap(row => Object.values(row)));
      store.assertRuntime();
      await db.beginTransaction();
      for (const table of tables.filter(table=>available.has(table))) await db.query(`DELETE FROM ${table}`);
      await db.execute("DELETE FROM config_records WHERE scope = 'agent'");
      store.assertRuntime();
      await db.commit();
    } catch (error) {
      await db.rollback();
      for (const path of moved.reverse()) await rename(path.to, path.from);
      throw error;
    } finally { db.release(); }
    // Database is now empty of runtime state. Failure here retains quarantined files for explicit cleanup.
    for (const path of moved) await rm(path.to, { recursive: true, force: true });
    return { workspaces: workspaces.length, removed: moved.map(path => path.from), preserved: 'Provider connections, credentials, app settings and catalogs; project implementation and Git checkouts' };
  } finally { await store.releaseRuntime(); }
}
