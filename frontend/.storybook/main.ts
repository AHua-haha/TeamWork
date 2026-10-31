import type { StorybookConfig } from '@storybook/react-vite';
import { fileURLToPath } from 'node:url';

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: [],
  // Stories are presentation-only; do not load the app's backend proxy config.
  framework: {
    name: '@storybook/react-vite',
    options: { builder: { viteConfigPath: fileURLToPath(new URL('./vite.config.ts', import.meta.url)) } },
  },
};

export default config;
