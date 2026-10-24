import { MySqlStorage } from '../src/storage/mysql.ts';
import { CoreData } from '../src/core/data.ts';
import { resetWorkspaceData } from '../src/core/workspace-reset.ts';
if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL');
if (process.argv.length !== 3 || process.argv[2] !== '--apply') throw new Error('Stop the backend, then run npm run reset:workspace-data -- --apply. Clears runtime/workspace data and managed files; preserves providers and implementation.');
const store = new CoreData(new MySqlStorage(process.env.DATABASE_URL));
try { console.log(JSON.stringify(await resetWorkspaceData(store), null, 2)); }
finally { await store.close(); }
