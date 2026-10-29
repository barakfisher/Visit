import { SectionNavigation } from './SectionNavigation';
import { useState } from 'react';
import { View } from 'react-native';
import type { Meta, StoryObj } from '@storybook/react';
import { expect, fn, userEvent } from 'storybook/test';
import { LocalePreview, useAppLocale } from '@/src/i18n/LocaleContext';
import { type Locale, translate } from '@/src/i18n/messages';
import { tokens } from '@/src/design/tokens';
import { AppText } from './AppText';
import { ScreenContent } from './ScreenContent';
import { ActionButton } from './ActionButton';
import { TextField } from './TextField';
import { ServiceCard } from './ServiceCard';
import { TimeChips } from './TimeChips';
import { HorizontalCalendarBar } from './HorizontalCalendarBar';
import { ActiveBookingCard } from './ActiveBookingCard';
import { AvailabilityState } from './AvailabilityState';

function Examples({ onAction }: { onAction: () => void }) {
  const { t, locale } = useAppLocale();
  const [email, setEmail] = useState('customer@example.test');
  const [time, setTime] = useState<string | null>(null);
  const [section, setSection] = useState('agenda');
  const [day, setDay] = useState('monday');
  const name = locale === 'he' ? 'פגישת ייעוץ ראשונית ארוכה עם צוות המרפאה ותכנון המשך הטיפול' : 'Extended first consultation with the clinic team and planning your follow-up care';
  return <ScreenContent testID="foundation-content">
    <AppText accessibilityRole="header" className="text-2xl font-semibold text-ink">{t('auth.welcome')}</AppText>
    <ActionButton label={t('booking.confirm')} onPress={onAction} />
    <TextField label={t('methods.email')} value={email} onChangeText={setEmail} identifier hint={t('methods.intro')} />
    <TextField label={t('account.businessName')} value={name} onChangeText={() => {}} error={t('account.submitFailed')} />
    <View className="flex-row flex-wrap gap-3"><View className="flex-1"><ActionButton secondary disabled label={t('methods.recovery')} onPress={onAction} /></View><ActionButton busy label={t('auth.verify')} onPress={onAction}/></View>
    <ServiceCard name={name} description={name} durationMinutes={45} priceLabel="₪125.00" selected onPress={onAction} />
    <HorizontalCalendarBar days={Array.from({ length: 12 }, (_, index) => ({ id: index === 0 ? 'monday' : `day-${index}`, label: locale === 'he' ? 'יום שני' : 'Monday', dateLabel: String(index + 1), accessibilityLabel: `${locale === 'he' ? 'נובמבר' : 'November'} ${index + 1}, 2026`, disabled: index === 2 }))} selectedId={day} onSelect={setDay} />
    <SectionNavigation label={t('account.workspace')} items={[{ id: 'agenda', label: t('agenda.title') }, { id: 'catalog', label: t('catalog.title') }, { id: 'future', label: t('setup.title'), disabled: true }]} selectedId={section} onSelect={setSection} />
    <TimeChips slots={[{ id: 'a', label: '09:00' }, { id: 'b', label: '09:30' }, { id: 'c', label: '10:00', locked: true }]} timezone="Asia/Jerusalem" selectedId={time} onSelect={setTime} />
    <AvailabilityState state="error" onRetry={onAction} />
    <ActiveBookingCard service={name} provider={name} dateLabel={locale === 'he' ? 'יום שני, 2 בנובמבר' : 'Monday, November 2'} timeLabel="10:30" timezone="Asia/Jerusalem" onReschedule={onAction} onCancel={onAction} />
  </ScreenContent>;
}
function Foundation({ locale, width, onAction }: { locale: Locale; width: number; onAction: () => void }) {
  return <LocalePreview locale={locale}><View testID="foundation-viewport" style={{ width, maxWidth: '100%', backgroundColor: tokens.color.canvas }}><Examples onAction={onAction} /></View></LocalePreview>;
}
const meta = { title: 'Foundation/ResponsiveControls', component: Foundation, args: { locale: 'he', width: 320, onAction: fn() } } satisfies Meta<typeof Foundation>;
export default meta;
type Story = StoryObj<typeof meta>;

const check: NonNullable<Story['play']> = async ({ canvas, args }) => {
  const t = (key: Parameters<typeof translate>[1]) => translate(args.locale, key);
  const content = canvas.getByTestId('foundation-content');
  const window = content.ownerDocument.defaultView!;
  await expect(window.getComputedStyle(content).direction).toBe(args.locale === 'he' ? 'rtl' : 'ltr');
  const viewport = canvas.getByTestId('foundation-viewport');
  await expect(viewport.scrollWidth).toBeLessThanOrEqual(Math.ceil(viewport.getBoundingClientRect().width) + 1);
  const input = canvas.getByRole('textbox', { name: t('methods.email') });
  await expect(window.getComputedStyle(input).direction).toBe('ltr');
  await expect(canvas.getByRole('textbox', { name: t('account.businessName') })).toHaveAttribute('aria-invalid', 'true');
  for (const button of canvas.getAllByRole('button')) {
    const box = button.getBoundingClientRect();
    await expect(box.height).toBeGreaterThanOrEqual(tokens.layout.minTouchTarget);
    await expect(box.width).toBeGreaterThanOrEqual(tokens.layout.minTouchTarget);
  }
  const confirm = canvas.getByRole('button', { name: t('booking.confirm') });
  // Start with keyboard modality, then test both standard button activations.
  await userEvent.tab(); confirm.focus();
  await expect(confirm).toHaveFocus();
  await expect(window.getComputedStyle(confirm).backgroundColor).toBe('rgb(15, 118, 110)');
  await expect(window.getComputedStyle(confirm).borderRadius).not.toBe('0px');
  await expect(window.getComputedStyle(confirm).outlineStyle).toBe('solid');
  await expect(window.getComputedStyle(confirm).outlineWidth).toBe('3px');
  await userEvent.keyboard('{Enter}');
  await userEvent.keyboard(' ');
  await expect(args.onAction).toHaveBeenCalledTimes(2);
  await userEvent.tab();
  await expect(input).toHaveFocus();
  await userEvent.clear(input); await userEvent.type(input, 'new@example.test');
  await expect(input).toHaveValue('new@example.test');
  const disabled = canvas.getByRole('button', { name: t('methods.recovery') });
  await expect(disabled).toHaveAttribute('aria-disabled', 'true');
  disabled.click();
  await expect(args.onAction).toHaveBeenCalledTimes(2);
  const busy = canvas.getByRole('button', { name: t('auth.verify') });
  await expect(busy).toHaveAttribute('aria-busy', 'true');
  await expect(busy).toHaveAttribute('aria-disabled', 'true');
  const catalog = canvas.getByRole('button', { name: t('catalog.title') });
  catalog.focus(); await userEvent.keyboard('{Enter}');
  await expect(catalog).toHaveAttribute('aria-pressed', 'true');
  const slot = canvas.getByRole('button', { name: /09:00/ });
  await userEvent.click(slot);
  await expect(slot).toHaveAttribute('aria-pressed', 'true');
  await expect(slot).toHaveTextContent(t('ui.selected'));
  const locked = canvas.getByRole('button', { name: /10:00/ });
  await expect(locked).toHaveAttribute('aria-disabled', 'true');
  await expect(locked).toHaveTextContent(t('ui.held'));
  const closed = canvas.getByRole('button', { name: new RegExp(t('ui.closed')) });
  await expect(closed).toHaveAttribute('aria-disabled', 'true');
  const calendar = canvas.getByLabelText(t('ui.dates'));
  // Keyboard focus brings a far-future date into view in both RTL and LTR.
  const future = canvas.getByRole('button', { name: /12, 2026/ });
  const geometry = () => { const s = calendar.getBoundingClientRect(), d = future.getBoundingClientRect(); return { stripLeft: s.left, stripRight: s.right, dateLeft: d.left, dateRight: d.right, scrollLeft: calendar.scrollLeft, scrollWidth: calendar.scrollWidth, clientWidth: calendar.clientWidth }; };
  future.focus();
  const focused = geometry();
  await userEvent.keyboard('{Enter}');
  await expect(future).toHaveAttribute('aria-pressed', 'true');
  // Assert the date is inside the visible strip, not that the strip scrolled: a row that overflows by a few pixels
  // (font metrics differ per OS) can already show the date, and then scrolling would be wrong.
  const selected = geometry(); const report = JSON.stringify({ focused, selected });
  await expect(selected.dateLeft, report).toBeGreaterThanOrEqual(selected.stripLeft - 1);
  await expect(selected.dateRight, report).toBeLessThanOrEqual(selected.stripRight + 1);
};
export const HebrewCompact: Story = { play: check };
export const EnglishCompact: Story = { args: { locale: 'en' }, play: check };
export const HebrewMobile: Story = { args: { width: 390 }, play: check };
export const EnglishMobile: Story = { args: { locale: 'en', width: 390 }, play: check };
export const HebrewDesktop: Story = { args: { width: 960 }, play: check };
export const EnglishDesktop: Story = { args: { locale: 'en', width: 960 }, play: check };
