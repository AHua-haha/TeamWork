import mysql, { type Pool, type PoolConnection } from 'mysql2/promise';

/** Engine resources only. Callers own every schema, statement and record model. */
export class MySqlStorage {
  readonly pool: Pool;
  readonly database: string;
  private closing?: Promise<void>;
  private readonly commits = new WeakMap<PoolConnection, {acknowledge: () => void; uncertain?: () => void}[]>();

  constructor(url: string) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'mysql:' || !parsed.pathname.slice(1)) throw new TypeError('MySQL storage requires a mysql: URL naming a database');
    this.database = decodeURIComponent(parsed.pathname.slice(1));
    this.pool = mysql.createPool({ uri: url, connectionLimit: 10, supportBigNumbers: true, bigNumberStrings: false, charset: 'utf8mb4' });
  }

  /** Repeatable-read transaction on one borrowed connection; callback errors are not reinterpreted. */
  async transaction<T>(action: (connection: PoolConnection) => Promise<T>): Promise<T> {
    const connection = await this.pool.getConnection();
    let committed = false;
    try {
      await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await connection.beginTransaction();
      this.commits.set(connection, []);
      const result = await action(connection);
      try { await connection.commit(); }
      catch (error) {
        for (const callback of this.commits.get(connection) ?? []) callback.uncertain?.();
        throw error;
      }
      committed = true;
      for (const callback of this.commits.get(connection) ?? []) callback.acknowledge();
      return result;
    } catch (error) {
      if (!committed) await connection.rollback().catch(() => undefined);
      throw error;
    } finally { this.commits.delete(connection); connection.release(); }
  }

  /** Register a synchronous, non-throwing memory acknowledgement on the outer transaction. */
  afterCommit(connection: PoolConnection, acknowledge: () => void, uncertain?: () => void): void {
    const callbacks = this.commits.get(connection);
    if (!callbacks) throw new Error('Commit acknowledgement requires a managed transaction');
    callbacks.push({acknowledge, uncertain});
  }

  close(): Promise<void> { return this.closing ??= this.pool.end(); }
}
