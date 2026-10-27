import assert from 'node:assert/strict';
import { test } from 'node:test';
import { apiUrl, configureBackendBase } from '../src/shared/backend-client/transport.js';

test('browser calls remain relative until desktop is configured', () => {
  configureBackendBase(null);
  assert.equal(apiUrl('/agents'), '/agents');
});

test('desktop client routes API requests through the trusted local protocol', () => {
  configureBackendBase('teamwork://app/api/');
  assert.equal(apiUrl('/workspaces/abc'), 'teamwork://app/api/workspaces/abc');
  assert.throws(() => configureBackendBase('http://evil.example/api/'));
  configureBackendBase(null);
});
