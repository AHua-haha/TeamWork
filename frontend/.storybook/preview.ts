import type { Preview } from '@storybook/react-vite';
import '../src/shared/ui/styles.css';
import './preview.css';

const preview: Preview = {
  parameters: {
    layout: 'fullscreen',
    backgrounds: { default: 'app' },
  },
};

export default preview;
