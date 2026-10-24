import type { StorybookConfig } from '@storybook/react-vite';
import { mergeConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const config: StorybookConfig = {
  stories: ['../components/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-a11y', '@storybook/addon-vitest'],
  framework: {
    name: '@storybook/react-vite',
    options: {
      pluginReactOptions: { jsxImportSource: 'nativewind' },
    },
  },
  staticDirs: ['../public'],
  docs: { autodocs: 'tag' },
  async viteFinal(config) {
    return mergeConfig(config, {
      resolve: { alias: [{ find: /^react-native$/, replacement: 'react-native-web' }, { find: '@', replacement: fileURLToPath(new URL('..', import.meta.url)) }] },
    });
  },
};

export default config;
