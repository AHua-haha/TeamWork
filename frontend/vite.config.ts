import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ command }) => {
  const target = process.env.AGENT_BACKEND_ORIGIN;
  if (command === 'serve' && !target) throw new Error('Start the configured frontend with scripts/dev.sh start');
  return {
    envDir: false,
    plugins: [react(), tailwindcss()],
    server: command === 'serve' ? {
      proxy: Object.fromEntries(['/agents', '/config', '/workspaces'].map(path => [path, {
        target: target!,
        changeOrigin: true,
      }])),
    } : undefined,
  };
});
