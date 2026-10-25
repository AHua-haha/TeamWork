import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import type { RowDataPacket } from 'mysql2/promise';
import { MySqlStorage } from '../../src/storage/mysql.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('Set TEST_DATABASE_URL to a disposable MySQL database');

test('engine resources support caller-owned schema, transactions and original failures without business knowledge', async () => {
  const storage = new MySqlStorage(url);
  const table = `engine_probe_${randomBytes(8).toString('hex')}`;
  try {
    await storage.pool.query(`CREATE TABLE ${table} (value INT PRIMARY KEY) ENGINE=InnoDB`);
    const acknowledgements: string[] = [];
    const result = await storage.transaction(async connection => {
      await connection.query(`INSERT INTO ${table} VALUES (7)`);
      storage.afterCommit(connection, () => acknowledgements.push('committed'));
      assert.deepEqual(acknowledgements, []);
      return 'caller result';
    });
    assert.equal(result, 'caller result');
    assert.deepEqual(acknowledgements, ['committed']);
    const failure = new Error('caller-defined operation failed');
    await assert.rejects(storage.transaction(async connection => {
      await connection.query(`INSERT INTO ${table} VALUES (8)`);
      storage.afterCommit(connection, () => acknowledgements.push('rolled back'));
      throw failure;
    }), error => error === failure);
    await assert.rejects(storage.transaction(async connection => {
      await connection.query(`INSERT INTO ${table} VALUES (7)`);
    }), (error: unknown) => (error as { code?: string }).code === 'ER_DUP_ENTRY');
    assert.deepEqual(acknowledgements, ['committed'], 'rollback does not acknowledge memory changes');
    const [rows] = await storage.pool.query<RowDataPacket[]>(`SELECT value FROM ${table} ORDER BY value`);
    assert.deepEqual(rows.map(row => row.value), [7], 'failed work rolled back; resource remains usable');
    assert.equal(storage.database, decodeURIComponent(new URL(url).pathname.slice(1)));
  } finally {
    await storage.pool.query(`DROP TABLE IF EXISTS ${table}`);
    const closing = storage.close();
    assert.equal(storage.close(), closing, 'shutdown is idempotent');
    await closing;
  }
});
