import type { Preview } from '@storybook/react-vite';
import '../src/app/styles.css';

const preview: Preview = {
  parameters: {
    layout: 'fullscreen',
    backgrounds: { default: 'app' },
  },
};

export default preview;
