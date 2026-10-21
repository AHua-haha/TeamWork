import assert from 'node:assert/strict';
import { test } from 'node:test';
import { backendSettings } from '../host-config.mjs';

test('structured database credentials round-trip reserved characters without changing the selected server or database', () => {
  const database = { name: 'rsi_agent', username: 'user@%name', password: 'p%a:ss@/?#中文' };
  const config = { mysql: { host: '127.0.0.1', port: 3306 }, deployment: { database, backendPort: 3001, encryptionKey: 'key', environment: { DEEPSEEK_WEB_API_KEY: 'explicit' } } };
  const settings = backendSettings(config, 'deployment'), url = new URL(settings.DATABASE_URL);
  assert.equal(decodeURIComponent(url.username), database.username);
  assert.equal(decodeURIComponent(url.password), database.password);
  assert.equal(url.host, '127.0.0.1:3306'); assert.equal(url.pathname, '/rsi_agent');
  assert.equal(settings.DEEPSEEK_WEB_API_KEY, 'explicit');
});
