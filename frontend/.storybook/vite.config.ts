import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

// UI examples do not need the application server's backend origin/proxy.
export default defineConfig({ envDir: false, plugins: [tailwindcss()] });
