# Storage usage contract

**Input:** `new MySqlStorage(url: string)` accepts a mysql: URL naming a database. `transaction<T>(action: (connection: PoolConnection) => Promise<T>): Promise<T>` accepts caller-owned work. `afterCommit(connection, acknowledge: () => void, uncertain?: () => void)` registers a synchronous non-throwing callback on a managed transaction; registration outside one fails. `pool`, `database` expose engine resources/name. `close(): Promise<void>` shuts down resources.

**Output:** The driver pool, decoded database name, callback result or original technical failure. Invalid URI/database inputs fail at construction.

**Effect and failure:** Pool limit 10 and utf8mb4 preserve the previous driver settings. Transactions commit/rollback caller-owned statements; callbacks run only after the outer commit, never on rollback. If COMMIT acknowledgement fails, optional uncertainty callbacks run instead, allowing the owner to invalidate its resident model without replay; the error propagates and rollback is attempted. A confirmed commit is never rolled back because a later callback fails. Callback lists are discarded when the transaction ends. Storage creates no application tables or business state. Closing ends the pool; callers must settle their work first.

**Usage example:** `const storage = new MySqlStorage(url); const value = await storage.transaction(async connection => { const [rows] = await connection.query("SELECT 1 AS value"); return rows; }); await storage.close();` A business owner defines any required schema/query separately.
