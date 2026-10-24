import '../global.css';
import type { Preview } from '@storybook/react-vite';

const preview: Preview = {
  parameters: {
    layout: 'padded',
    controls: { expanded: true },
    a11y: { test: 'error' },
    viewport: { viewports: { phone: { name: 'Phone', styles: { width: '390px', height: '844px' } }, desktop: { name: 'Desktop', styles: { width: '1280px', height: '800px' } } } },
  },
};

export default preview;
