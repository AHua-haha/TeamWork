import { appendFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';

const [command, ...args] = process.argv.slice(2);
if (!command) throw new Error('Usage: node scripts/verify.mjs COMMAND ...ARGS');
const start = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const result = spawnSync(command, args, { stdio: 'inherit', env: process.env });
appendFileSync('docs/tasks/2026-09-29-agent-platform/tests.jsonl', JSON.stringify({
  time: new Date().toISOString(), start_commit: start, command: [command, ...args].join(' '),
  scope: process.env.VERIFY_SCOPE ?? 'TypeScript backend; MySQL integration uses disposable local MySQL 8.4 when TEST_DATABASE_URL is set',
  result: result.status === 0 ? 'pass' : 'fail',
}) + '\n');
process.exitCode = result.status ?? 1;
