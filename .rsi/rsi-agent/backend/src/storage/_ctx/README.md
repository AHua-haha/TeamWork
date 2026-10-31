---
summary: Provides MySQL pool access, repeatable-read transactions, commit acknowledgements and shutdown without owning application schemas or queries.
include:
  - backend/src/storage/mysql.ts
  - backend/src/core/data-transaction.ts
  - backend/test/business-data.test.ts
---

# Storage usage contract

**Input:** `new MySqlStorage(url: string)` accepts a mysql: URL naming a database. `transaction<T>(action: (connection: PoolConnection) => Promise<T>): Promise<T>` accepts caller-owned work. `afterCommit(connection, acknowledge: () => void, uncertain?: () => void)` registers a synchronous non-throwing callback on a managed transaction; registration outside one fails. `pool`, `database` expose engine resources/name. `close(): Promise<void>` shuts down resources.

**Output:** The driver pool, decoded database name, callback result or original technical failure. Invalid URI/database inputs fail at construction.

**Effect and failure:** Pool limit 10 and utf8mb4 preserve the previous driver settings. Transactions set REPEATABLE READ on one borrowed connection and commit/rollback caller-owned statements; callbacks run only after the outer commit, never on rollback. If COMMIT acknowledgement fails, optional uncertainty callbacks run instead, allowing the owner to invalidate its resident model without replay; the error propagates and rollback is attempted. A confirmed commit is never rolled back because a later callback fails. Callback lists are discarded when the transaction ends. Storage creates no application tables or business state. Closing ends the pool; callers must settle their work first.

**Usage example:** `const storage = new MySqlStorage(url); const value = await storage.transaction(async connection => { const [rows] = await connection.query("SELECT 1 AS value"); return rows; }); await storage.close();` A business owner defines any required schema/query separately.


## Consumer obligations and lifecycle

Import `MySqlStorage` from `backend/src/storage/mysql.ts` (or the existing backend API barrel). Callers own schema migration, SQL, domain validation and row serialization. `transaction` returns the callback result only after COMMIT and synchronous acknowledgements. `afterCommit` acknowledgement and uncertainty callbacks must not throw; their side effects must be limited to publishing/invalidation of owner memory. Register with the managed outer connection, rather than starting an independent nested transaction for a cross-owner change.

Every transaction releases its borrowed connection in `finally`. `close()` reuses its first pool-ending promise, so repeated close calls do not create new pools; it does not drain business work for callers or reopen a closed instance. Pool/connection driver errors propagate. Storage does not mask an uncertain commit as a rollback success or replay statements. A repeatable-read snapshot is a database transaction guarantee, not a filesystem or external-effect snapshot.

Supporting references in `include` are project-root-relative and supplement this contract; they are not automatically loaded when the README is shown.
