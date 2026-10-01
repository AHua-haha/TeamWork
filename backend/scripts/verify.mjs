import { appendFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const [command, ...args] = process.argv.slice(2);
if (!command) throw new Error('Usage: node scripts/verify.mjs COMMAND ...ARGS');
const backendDir = fileURLToPath(new URL('..', import.meta.url));
const repoDir = fileURLToPath(new URL('../..', import.meta.url));
const start = execFileSync('git', ['-C', repoDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const taskId = process.env.VERIFY_TASK_ID;
if (!taskId || !/^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/.test(taskId)) {
  throw new Error('Set VERIFY_TASK_ID to the current docs/tasks/<task-id> directory name');
}
const result = spawnSync(command, args, { cwd: backendDir, stdio: 'inherit', env: process.env });
appendFileSync(resolve(repoDir, `docs/tasks/${taskId}/tests.jsonl`), JSON.stringify({
  time: new Date().toISOString(), start_commit: start, command: [command, ...args].join(' '),
  scope: process.env.VERIFY_SCOPE ?? 'TypeScript backend; MySQL integration uses disposable local MySQL 8.4 when TEST_DATABASE_URL is set',
  result: result.status === 0 ? 'pass' : 'fail',
}) + '\n');
process.exitCode = result.status ?? 1;
