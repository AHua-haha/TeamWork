import assert from 'node:assert/strict';
import { test } from 'node:test';
import { composeDefinition, backendSettings, validateConfiguration } from '../host-config.mjs';

test('structured database credentials round-trip reserved characters without changing the selected server or database', () => {
  const database = { name: 'rsi_agent', username: 'user@%name', password: 'p%a:ss@/?#中文' };
  const config = { mysql: { host: '127.0.0.1', port: 3306 }, deployment: { database, backendPort: 3001, encryptionKey: 'key', environment: { DEEPSEEK_WEB_API_KEY: 'explicit' } } };
  const settings = backendSettings(config, 'deployment'), url = new URL(settings.DATABASE_URL);
  assert.equal(decodeURIComponent(url.username), database.username);
  assert.equal(decodeURIComponent(url.password), database.password);
  assert.equal(url.host, '127.0.0.1:3306'); assert.equal(url.pathname, '/rsi_agent');
  assert.equal(settings.DEEPSEEK_WEB_API_KEY, 'explicit');
});

test('retired permission switch is ignored and new configurations do not require it', () => {
  const config = {
    version: 2,
    paths: { stateDirectory: '/tmp/state', developmentStateDirectory: '/tmp/dev', deploymentSourceRoot: '/tmp/source' },
    mysql: { host: '127.0.0.1', port: 3306, project: 'backend', dockerContext: 'default', rootPassword: 'test', image: 'mysql:8.4', containerName: 'test-mysql', networkName: 'test-network', networkKey: 'database', volumeName: 'test-data' },
    development: { backendPort: 3000, frontendPort: 5273, database: { name: 'rsi_agent_dev', username: 'rsi_dev', password: 'test' }, encryptionKey: Buffer.alloc(32, 1).toString('base64'), environment: {}, harnessPermissionsEnabled: true, contextCompactionThresholdTokens: 64000 },
    deployment: { backendPort: 3001, frontendPort: 5274, database: { name: 'rsi_agent', username: 'rsi', password: 'test' }, encryptionKey: Buffer.alloc(32, 2).toString('base64'), environment: {}, harnessPermissionsEnabled: true, contextCompactionThresholdTokens: 64000 },
  };
  config.development.database.name = 'custom_dev'; config.development.database.username = 'custom_dev_user';
  config.deployment.database.name = 'custom_production'; config.deployment.database.username = 'custom_deploy_user';
  validateConfiguration(config);
  const sameName = structuredClone(config); sameName.deployment.database.name = sameName.development.database.name;
  assert.throws(() => validateConfiguration(sameName), /distinct database/);
  assert.equal(backendSettings(config,'development').RSI_HARNESS_PERMISSIONS_ENABLED,undefined);
  config.deployment.harnessPermissionsEnabled = true;
  validateConfiguration(config);
  assert.equal(backendSettings(config,'deployment').RSI_HARNESS_PERMISSIONS_ENABLED,undefined);
  delete config.deployment.harnessPermissionsEnabled;
  validateConfiguration(config);
  config.deployment.environment.RSI_HARNESS_PERMISSIONS_ENABLED = 'false';
  assert.throws(() => validateConfiguration(config), /Reserved/);
});

test('one token threshold is resolved independently per environment from explicit configuration', () => {
  const config = {
    version: 2,
    paths: { stateDirectory: '/tmp/state', developmentStateDirectory: '/tmp/dev', deploymentSourceRoot: '/tmp/source' },
    mysql: { host: '127.0.0.1', port: 3306, project: 'backend', dockerContext: 'default', rootPassword: 'test', image: 'mysql:8.4', containerName: 'test-mysql', networkName: 'test-network', networkKey: 'database', volumeName: 'test-data' },
    development: { backendPort: 3000, frontendPort: 5273, database: { name: 'rsi_agent_dev', username: 'rsi_dev', password: 'test' }, encryptionKey: Buffer.alloc(32, 1).toString('base64'), environment: {}, harnessPermissionsEnabled: true, contextCompactionThresholdTokens: 64000 },
    deployment: { backendPort: 3001, frontendPort: 5274, database: { name: 'rsi_agent', username: 'rsi', password: 'test' }, encryptionKey: Buffer.alloc(32, 2).toString('base64'), environment: {}, harnessPermissionsEnabled: true, contextCompactionThresholdTokens: 64000 },
  };
  validateConfiguration(config);
  assert.equal(backendSettings(config,'development').RSI_CONTEXT_COMPACTION_THRESHOLD_TOKENS,'64000');
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

test('Compose resource definitions use only the selected project configuration', () => {
  const config = { mysql: { host: '127.0.0.1', port: 23306, image: 'mysql:8.4', containerName: 'other-mysql', networkKey: 'legacy-network-key', networkName: 'other-network', volumeName: 'other-volume' } };
  const definition = composeDefinition(config);
  assert.equal(definition.services.mysql.container_name, 'other-mysql');
  assert.deepEqual(definition.services.mysql.ports, ['127.0.0.1:23306:3306']);
  assert.deepEqual(definition.networks, { 'legacy-network-key': { name: 'other-network' } });
  assert.equal(definition.volumes['mysql-data'].name, 'other-volume');
  assert.ok(!JSON.stringify(definition).includes('team-work'));
});
