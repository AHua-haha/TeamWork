import mysql, { type Pool, type PoolConnection } from 'mysql2/promise';

/** Engine resources only. Callers own every schema, statement and record model. */
export class MySqlStorage {
  readonly pool: Pool;
  readonly database: string;
  private closing?: Promise<void>;

  constructor(url: string) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'mysql:' || !parsed.pathname.slice(1)) throw new TypeError('MySQL storage requires a mysql: URL naming a database');
    this.database = decodeURIComponent(parsed.pathname.slice(1));
    this.pool = mysql.createPool({ uri: url, connectionLimit: 10, supportBigNumbers: true, bigNumberStrings: false, charset: 'utf8mb4' });
  }

  /** Repeatable-read transaction on one borrowed connection; callback errors are not reinterpreted. */
  async transaction<T>(action: (connection: PoolConnection) => Promise<T>): Promise<T> {
    const connection = await this.pool.getConnection();
    try {
      await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await connection.beginTransaction();
      const result = await action(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      throw error;
    } finally { connection.release(); }
  }

  close(): Promise<void> { return this.closing ??= this.pool.end(); }
}
