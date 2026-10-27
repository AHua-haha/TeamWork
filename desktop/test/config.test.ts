import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDesktopConfig } from '../src/main/config.js';

test('accepts an explicit HTTP origin', () => {
  assert.deepEqual(parseDesktopConfig({ backendOrigin: 'http://127.0.0.1:3100' }), { backendOrigin: 'http://127.0.0.1:3100' });
});

test('accepts an HTTPS origin', () => {
  assert.deepEqual(parseDesktopConfig({ backendOrigin: 'https://backend.example.test' }), { backendOrigin: 'https://backend.example.test' });
});

test('rejects missing or non-object configuration', () => {
  for (const value of [null, [], {}, { backendOrigin: '' }]) assert.throws(() => parseDesktopConfig(value));
});

test('rejects URL paths, credentials, query, fragment and non-HTTP schemes', () => {
  for (const backendOrigin of ['file:///tmp', 'http://user:secret@localhost:3000', 'http://localhost:3000/path', 'http://localhost:3000?x=1', 'http://localhost:3000#fragment']) {
    assert.throws(() => parseDesktopConfig({ backendOrigin }));
  }
});
