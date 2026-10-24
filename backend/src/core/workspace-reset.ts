import { randomUUID } from 'node:crypto';
import { lstat, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { CoreData } from './data.js';
import { missing, sha256 } from './text.js';


/** Administrative reset, never an agent or HTTP capability. Requires exclusive database ownership. */
export async function resetWorkspaceData(store: CoreData) {
  await store.agents.acquireRuntime(() => {});
  const moved: { from: string; to: string }[] = [];
  try {
    const workspaces = await store.workspaces.listWorkspaces();
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
      store.agents.assertRuntime();
      await db.beginTransaction();
      await store.resetRuntimeRecords(db);
      store.agents.assertRuntime();
      await db.commit();
    } catch (error) {
      await db.rollback();
      for (const path of moved.reverse()) await rename(path.to, path.from);
      throw error;
    } finally { db.release(); }
    // Database is now empty of runtime state. Failure here retains quarantined files for explicit cleanup.
    for (const path of moved) await rm(path.to, { recursive: true, force: true });
    return { workspaces: workspaces.length, removed: moved.map(path => path.from), preserved: 'Provider connections, credentials, app settings and catalogs; project implementation and Git checkouts' };
  } finally { await store.agents.releaseRuntime(); }
}
