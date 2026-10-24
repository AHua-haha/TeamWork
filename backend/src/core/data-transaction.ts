import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import type { MySqlStorage } from '../storage/mysql.js';
import { AppError } from './errors.js';
export type DataConnection = Pool | PoolConnection;
export async function rows(db: DataConnection, sql: string, values: (string | number | null)[] = []): Promise<RowDataPacket[]> {
    return (await db.execute<RowDataPacket[]>(sql, values))[0];
}
export async function insertRows(db: DataConnection, sql: string, values: (string | number | null)[][]): Promise<void> {
    for (let start = 0; start < values.length; start += 500)
        await db.query(sql, [values.slice(start, start + 500)]);
}
export function limitClause(limit: number): string {
    if (!Number.isSafeInteger(limit) || limit < 1)
        throw new AppError('invalid_input', 'Invalid limit');
    return ` LIMIT ${limit}`;
}
export const duplicate = (error: unknown) => !!error && typeof error === 'object' && 'code' in error && error.code === 'ER_DUP_ENTRY';
export async function dataTransaction<T>(storage: MySqlStorage, connection: PoolConnection | undefined, operation: (db: PoolConnection) => Promise<T>): Promise<T> {
    try {
        return connection ? await operation(connection) : await storage.transaction(operation);
    }
    catch (error) {
        if (duplicate(error))
            throw new AppError('conflict', 'Identity or position already exists', 409);
        throw error;
    }
}
/** Technical reset helper: callers supply their own tables, including optional older-schema tables. */
export async function clearTables(db: DataConnection, tables: readonly string[]): Promise<void> {
    const [existing] = await db.query<RowDataPacket[]>('SHOW TABLES');
    const available = new Set(existing.flatMap(row => Object.values(row)));
    for (const table of tables)
        if (available.has(table))
            await db.query(`DELETE FROM ${table}`);
}
