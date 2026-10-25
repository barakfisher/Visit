import { cssInterop } from 'react-native-css-interop/dist/runtime/web/api';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
// NativeWind skips automatic registration under NODE_ENV=test. Vite 8 also
// requires an explicit OXC importSource (configured in main.ts).
for (const component of [View, Text, Pressable, TextInput, ActivityIndicator]) cssInterop(component, { className: 'style' });
cssInterop(ScrollView, { className: 'style', contentContainerClassName: 'contentContainerStyle' });
import { createElement } from 'react';
import { LocalePreview } from '../src/i18n/LocaleContext';
import '../global.css';
import type { Preview } from '@storybook/react-vite';

const preview: Preview = {
  initialGlobals: { locale: 'en' },
  globalTypes: { locale: { description: 'Display language', toolbar: { icon: 'globe', items: [{ value: 'he', title: 'עברית · RTL' }, { value: 'en', title: 'English · LTR' }] } } },
  decorators: [(Story, context) => createElement(LocalePreview, { locale: context.globals.locale === 'he' ? 'he' : 'en', children: createElement(Story) })],
  parameters: {
    layout: 'padded',
    controls: { expanded: true },
    a11y: { test: 'error' },
    viewport: { viewports: { phone: { name: 'Phone', styles: { width: '390px', height: '844px' } }, desktop: { name: 'Desktop', styles: { width: '1280px', height: '800px' } } } },
  },
};

export default preview;
