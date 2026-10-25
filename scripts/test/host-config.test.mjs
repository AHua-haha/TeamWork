import assert from 'node:assert/strict';
import { test } from 'node:test';
import { backendSettings, validateConfiguration } from '../host-config.mjs';

test('structured database credentials round-trip reserved characters without changing the selected server or database', () => {
  const database = { name: 'rsi_agent', username: 'user@%name', password: 'p%a:ss@/?#中文' };
  const config = { mysql: { host: '127.0.0.1', port: 3306 }, deployment: { database, backendPort: 3001, encryptionKey: 'key', environment: { DEEPSEEK_WEB_API_KEY: 'explicit' } } };
  const settings = backendSettings(config, 'deployment'), url = new URL(settings.DATABASE_URL);
  assert.equal(decodeURIComponent(url.username), database.username);
  assert.equal(decodeURIComponent(url.password), database.password);
  assert.equal(url.host, '127.0.0.1:3306'); assert.equal(url.pathname, '/rsi_agent');
  assert.equal(settings.DEEPSEEK_WEB_API_KEY, 'explicit');
});

test('project switch is independently selected, defaults to enforcement and rejects nonboolean values', () => {
  const config = {
    version: 1,
    paths: { stateDirectory: '/tmp/state', developmentStateDirectory: '/tmp/dev', deploymentSourceRoot: '/tmp/source' },
    mysql: { host: '127.0.0.1', port: 3306, project: 'backend', dockerContext: 'default', rootPassword: 'test' },
    development: { backendPort: 3000, frontendPort: 5273, database: { name: 'rsi_agent_dev', username: 'rsi_dev', password: 'test' }, encryptionKey: Buffer.alloc(32, 1).toString('base64'), environment: {} },
    deployment: { backendPort: 3001, frontendPort: 5274, database: { name: 'rsi_agent', username: 'rsi', password: 'test' }, encryptionKey: Buffer.alloc(32, 2).toString('base64'), environment: {} },
  };
  validateConfiguration(config);
  assert.equal(backendSettings(config, 'development').RSI_HARNESS_PERMISSIONS_ENABLED, 'true');
  config.deployment.harnessPermissionsEnabled = false;
  validateConfiguration(config);
  assert.equal(backendSettings(config, 'deployment').RSI_HARNESS_PERMISSIONS_ENABLED, 'false');
  assert.equal(backendSettings(config, 'development').RSI_HARNESS_PERMISSIONS_ENABLED, 'true');
  for (const value of ['false', null, 0, {}]) {
    config.deployment.harnessPermissionsEnabled = value;
    assert.throws(() => validateConfiguration(config), /must be boolean/);
  }
  config.deployment.harnessPermissionsEnabled = true;
  config.deployment.environment.RSI_HARNESS_PERMISSIONS_ENABLED = 'false';
  assert.throws(() => validateConfiguration(config), /Reserved/);
});

test('one token threshold is resolved independently per environment with a validated default', () => {
  const config = {
    version: 1,
    paths: { stateDirectory: '/tmp/state', developmentStateDirectory: '/tmp/dev', deploymentSourceRoot: '/tmp/source' },
    mysql: { host: '127.0.0.1', port: 3306, project: 'backend', dockerContext: 'default', rootPassword: 'test' },
    development: { backendPort: 3000, frontendPort: 5273, database: { name: 'rsi_agent_dev', username: 'rsi_dev', password: 'test' }, encryptionKey: Buffer.alloc(32, 1).toString('base64'), environment: {} },
    deployment: { backendPort: 3001, frontendPort: 5274, database: { name: 'rsi_agent', username: 'rsi', password: 'test' }, encryptionKey: Buffer.alloc(32, 2).toString('base64'), environment: {} },
  };
  validateConfiguration(config);
  assert.equal(backendSettings(config,'development').RSI_CONTEXT_COMPACTION_THRESHOLD_TOKENS,'512000');
  assert.equal(backendSettings(config,'deployment').RSI_CONTEXT_COMPACTION_THRESHOLD_TOKENS,'512000');
  config.development.contextCompactionThresholdTokens=12000;
  config.deployment.contextCompactionThresholdTokens=48000;
  validateConfiguration(config);
  assert.equal(backendSettings(config,'development').RSI_CONTEXT_COMPACTION_THRESHOLD_TOKENS,'12000');
  assert.equal(backendSettings(config,'deployment').RSI_CONTEXT_COMPACTION_THRESHOLD_TOKENS,'48000');
  for(const value of [0,-1,1.5,'32000',null,Number.MAX_SAFE_INTEGER+1]) {
    config.development.contextCompactionThresholdTokens=value;
    assert.throws(()=>validateConfiguration(config),/positive safe integer/);
  }
  config.development.contextCompactionThresholdTokens=12000;
  config.development.environment.RSI_CONTEXT_COMPACTION_THRESHOLD_TOKENS='1';
  assert.throws(()=>validateConfiguration(config),/Reserved/);
});
