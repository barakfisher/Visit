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
      oxc: { jsx: { importSource: 'nativewind' } },
      optimizeDeps: { exclude: ['react-native-safe-area-context'], include: ['nativewind/jsx-runtime', 'nativewind/jsx-dev-runtime', 'react-native-css-interop/dist/runtime/web/api'] },
      // Isolated stories never inherit production credentials or the development API.
      define: { 'process.env.EXPO_PUBLIC_API_URL': JSON.stringify('https://storybook.invalid') },
      resolve: { extensions: ['.web.tsx', '.web.ts', '.web.js', '.tsx', '.ts', '.jsx', '.js', '.json'], alias: [{ find: /^react-native$/, replacement: 'react-native-web' }, { find: '@', replacement: fileURLToPath(new URL('..', import.meta.url)) }] },
    });
  },
};

export default config;
