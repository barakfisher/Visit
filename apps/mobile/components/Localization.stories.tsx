import type { Meta, StoryObj } from '@storybook/react';
import { expect } from 'storybook/test';
import { View } from 'react-native';
import { LocalePreview } from '../src/i18n/LocaleContext';
import { directionFor, en, he, formatAppointment, formatPrice, isolateLtr, type Locale } from '../src/i18n/messages';
import { AppText } from './AppText';
import { PhoneInput } from './auth/PhoneInput';
import { LanguageSettings } from './LanguageSettings';
function LocalizationExample({ locale, width }: { locale: Locale; width: number }) {
  return <LocalePreview locale={locale}><View {...{ dir: directionFor(locale) }} style={{ width, maxWidth: '100%', direction: directionFor(locale), gap: 16, padding: 16, backgroundColor: '#f8fafc' }}>
    <LanguageSettings />
    <AppText accessibilityRole="header" style={{ fontSize: 24 }}>{locale === 'he' ? he['auth.welcome'] : en['auth.welcome']}</AppText>
    <PhoneInput value="+972501234567" onChange={() => {}} />
    <AppText>{isolateLtr('support@visit.example')}</AppText>
    <AppText>{formatAppointment(locale, '2026-11-01T12:00:00Z', 'Asia/Jerusalem')}</AppText>
    <AppText>{formatPrice(locale, 12500, 'ILS')}</AppText>
  </View></LocalePreview>;
}
const meta = { title: 'Foundation/Localization', component: LocalizationExample, args: { locale: 'he', width: 390 } } satisfies Meta<typeof LocalizationExample>;
export default meta;
type Story = StoryObj<typeof meta>;
export const HebrewMobile: Story = { play: async ({ canvas }) => {
  await expect(Object.keys(he).sort()).toEqual(Object.keys(en).sort());
  await expect(canvas.getByRole('heading', { name: he['auth.welcome'] })).toBeVisible();
  await expect(canvas.getByLabelText(he['auth.phone'], { exact: true })).toHaveValue('+972501234567');
  await expect(canvas.getByRole('button', { name: 'עברית' })).toHaveAttribute('aria-pressed', 'true');
} };
export const HebrewDesktop: Story = { args: { width: 900 } };
export const EnglishMobile: Story = { args: { locale: 'en' }, play: async ({ canvas }) => {
  await expect(canvas.getByRole('heading', { name: en['auth.welcome'] })).toBeVisible();
  await expect(canvas.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true');
} };
export const EnglishDesktop: Story = { args: { locale: 'en', width: 900 } };
