import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  envDir: false,
  plugins: [react()],
  server: {
    proxy: {
      '/agents': {
        target: process.env.AGENT_BACKEND_ORIGIN ?? 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
      '/config': {
        target: process.env.AGENT_BACKEND_ORIGIN ?? 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
      '/workspaces': {
        target: process.env.AGENT_BACKEND_ORIGIN ?? 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
});
