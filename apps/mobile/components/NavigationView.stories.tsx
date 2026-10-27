import { useRef, useState, type ComponentRef } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { Meta, StoryObj } from '@storybook/react';
import { expect, fn, userEvent, within } from 'storybook/test';
import { NavigationView } from './NavigationView.component';
import { translate } from '../src/i18n/messages';
import { useAppLocale } from '../src/i18n/LocaleContext';
import type { NavigationViewProps } from '../src/types/NavigationView.types';
type FixtureProps = Pick<NavigationViewProps, 'managed' | 'applicationStatus' | 'becomeProvider' | 'providerMode' | 'loading' | 'failed' | 'busy' | 'error' | 'onLogout'>;
function Fixture(props: FixtureProps) {
  const { t, direction } = useAppLocale();
  const trigger = useRef<ComponentRef<typeof View>>(null);
  const [open, setOpen] = useState(false), [choosingBusiness, setChoosingBusiness] = useState(false);
  return <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, bottom: 0, left: 0, right: 0 } }}><NavigationView {...props} t={t} direction={direction} trigger={trigger} open={open} choosingBusiness={choosingBusiness} close={() => { setOpen(false); setChoosingBusiness(false); }} onOpen={() => setOpen(true)} onRetry={fn()} onHome={() => setOpen(false)} onAccount={() => setOpen(false)} onApplication={() => setOpen(false)} onSwitchMode={() => setChoosingBusiness(true)} onBusiness={() => setOpen(false)} /></SafeAreaProvider>;
}
const meta = { globals: { locale: 'he' }, title: 'Home/Navigation', component: Fixture,
  play: async ({ canvas, canvasElement, args, globals }) => {
    const locale = globals.locale === 'en' ? 'en' : 'he';
    const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
    await userEvent.click(canvas.getByRole('button', { name: t('nav.open') }));
    const body = within(canvasElement.ownerDocument.body);
    await expect(body.getByRole('button', { name: t('account.signOut') })).toBeVisible();
    if (!args.failed) {
      if (args.becomeProvider) await expect(body.getByRole('button', { name: t('account.becomeProvider') })).toBeVisible(); else await expect(body.queryByRole('button', { name: t('account.becomeProvider') })).toBeNull();
      if (args.applicationStatus) await expect(body.getByRole('button', { name: t('account.applicationStatus') })).toBeVisible();
      if (args.managed.length) {
        await userEvent.click(body.getByRole('button', { name: t(args.providerMode ? 'nav.customerMode' : 'account.switchProvider') }));
        for (const membership of args.managed) await expect(body.getByRole('button', { name: membership.business.name })).toBeVisible();
      }
    } else await expect(body.getByRole('alert')).toBeVisible();
    await userEvent.keyboard('{Escape}');
  }, args: { managed: [], applicationStatus: false, becomeProvider: true, providerMode: false, loading: false, failed: false, busy: false, error: '', onLogout: fn() } } satisfies Meta<typeof Fixture>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Customer: Story = { play: async ({ canvas, canvasElement }) => {
  const trigger = canvas.getByRole('button'); trigger.focus(); await userEvent.keyboard('{Enter}');
  const body = within(canvasElement.ownerDocument.body);
  await expect(body.getByTestId('menu-panel')).toBeVisible();
  await expect(body.getByRole('button', { name: /יציאה/ })).toBeVisible();
  await userEvent.keyboard('{Escape}'); await expect(trigger).toHaveFocus();
} };
export const Pending: Story = { args: { applicationStatus: true, becomeProvider: false } };
export const Approved: Story = { args: { becomeProvider: false, applicationStatus: true, managed: [0, 1].map(i => ({ role: 'OWNER', status: 'ACTIVE', business: { id: `synthetic-${i}`, name: `המרכז המקצועי לייעוץ ושירותים ${i}`, approvalStatus: 'APPROVED' } })) } };
export const ProviderMode: Story = { args: { ...Approved.args, providerMode: true } };
export const Failed: Story = { args: { failed: true, becomeProvider: false } };
export const Loading: Story = { args: { loading: true, becomeProvider: false } };
export const English: Story = { globals: { locale: 'en' } };
