<!-- Task implementation; promoted with verified code. -->
# Storage implementation context

## Result summary

`MySqlStorage` is the sole storage-engine adapter. It contains no business models, table definitions, application SQL, serializers or app migrations. Only existing MySQL is supported.

Design: [Storage](../../../../design/backend/storage/design.md).

### Coordination and ownership

Core receives a pool for caller-owned SQL. transaction leases one connection, sets repeatable-read isolation, begins a transaction and invokes the callback. It commits the callback result; on failure it attempts rollback, rethrows the original failure and always releases the connection. close is idempotent.

### Implemented contract

**Input:** `new MySqlStorage(url: string)` accepts a mysql: URL naming a database. `transaction<T>(action: (connection: PoolConnection) => Promise<T>): Promise<T>` accepts caller-owned work. `pool`, `database` expose engine resources/name. `close(): Promise<void>` shuts down resources.

**Output:** The driver pool, decoded database name, callback result or original technical failure. Invalid URI/database inputs fail at construction.

**Effect and failure:** Pool limit 10 and utf8mb4 preserve the previous driver settings. Transactions commit/rollback caller-owned statements; Storage creates no application tables. Closing ends the pool; callers must settle their work first.

**Usage example:** `const storage = new MySqlStorage(url); const value = await storage.transaction(async connection => { const [rows] = await connection.query("SELECT 1 AS value"); return rows; }); await storage.close();` A business owner defines any required schema/query separately.

## File lookup

- [backend/src/storage](../../../../../../backend/src/storage): owned implementation.
- [Engine integration test](../../../../../../backend/test/integration/storage.test.ts): caller-owned schema, commit/rollback, raw engine failures and resource shutdown.
- [Boundary tests](../../../../../../backend/test/backend-layout.test.ts): source dependencies and source startup/assets.
- [Backend tests](../../../../../../backend/test): deterministic/unit/HTTP and disposable MySQL verification.

## Automatic retrieval

```json
{"commands": []}
```
