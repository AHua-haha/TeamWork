import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { backendSettings, hostEnvironment, initializeConfiguration, root } from './host-config.mjs';

// Foreground debugging/maintenance still uses the same project-owned development settings.
try {
  const [command, ...arguments_] = process.argv.slice(2);
  if (!['dev', 'start', 'reset'].includes(command)) throw new Error('Expected backend command dev, start or reset');
  const config = await initializeConfiguration();
  const entry = join(root, 'backend', command === 'reset' ? 'scripts/reset-workspace-data.mjs' : command === 'dev' ? 'src/main.ts' : 'dist/src/main.js');
  const child = spawn(process.execPath, [...(command === 'start' ? [] : ['--import', 'tsx']), entry, ...arguments_], { cwd: join(root, 'backend'), env: { ...hostEnvironment(), ...backendSettings(config, 'development') }, stdio: 'inherit' });
  const handlers = new Map(['SIGINT', 'SIGTERM'].map(signal => [signal, () => child.kill(signal)]));
  for (const [signal, handler] of handlers) process.on(signal, handler);
  await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); resolve(); }); });
  for (const [signal, handler] of handlers) process.off(signal, handler);
} catch (error) { console.error(error.message); process.exitCode = 1; }
