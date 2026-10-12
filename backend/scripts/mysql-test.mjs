import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';

// All database state belongs to the container created by this invocation.
const name = `rsi-agent-test-${randomUUID()}`;
let container;
try {
  container = execFileSync('docker', ['run', '--detach', '--rm', '--name', name,
    '--env', 'MYSQL_ROOT_PASSWORD=rsi-test-root', '--env', 'MYSQL_DATABASE=rsi_agent_test',
    '--publish', '127.0.0.1::3306', 'mysql:8.4'], { encoding: 'utf8' }).trim();
  let ready = false;
  for (let attempt = 0; attempt < 90; attempt++) {
    const result = spawnSync('docker', ['exec', container, 'mysqladmin', '--protocol=tcp', '-h127.0.0.1', '-uroot', '-prsi-test-root', 'ping'], { stdio: 'ignore' });
    if (result.status === 0) { ready = true; break; }
    await setTimeout(1000);
  }
  if (!ready) throw new Error('Disposable MySQL did not become ready');
  const port = execFileSync('docker', ['port', container, '3306/tcp'], { encoding: 'utf8' }).trim().split(':').at(-1);
  // The tests call mock servers on loopback. A shell that sets http_proxy and NODE_OPTIONS=--use-env-proxy would send those requests to the proxy.
  const noProxy = ['127.0.0.1', 'localhost', '::1', process.env.NO_PROXY ?? process.env.no_proxy].filter(Boolean).join(',');
  const result = spawnSync('npm', ['run', 'test:integration'], {
    stdio: 'inherit', env: { ...process.env, NO_PROXY: noProxy, no_proxy: noProxy, TEST_DATABASE_URL: `mysql://root:rsi-test-root@127.0.0.1:${port}/rsi_agent_test` },
  });
  process.exitCode = result.status ?? 1;
} finally {
  if (container) execFileSync('docker', ['rm', '--force', container], { stdio: 'ignore' });
}
