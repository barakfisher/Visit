import { useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { Meta, StoryObj } from '@storybook/react';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { confirmAppointmentCancellation } from '@/src/lib/bookingActions';
import { appointmentCancellationCopy } from '@/src/i18n/cancellationConfirm';
import { ActionButton } from './ActionButton';
import { AppText } from './AppText';
import { CancellationPrompt } from './CancellationPrompt.component';

// A screen's cancel button, the answer it got, and the sheet the root layout keeps mounted.
function Fixture() {
  const [answer, setAnswer] = useState('');
  return <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, bottom: 0, left: 0, right: 0 } }}>
    <ActionButton secondary danger label="Cancel" onPress={() => void confirmAppointmentCancellation().then(confirmed => setAnswer(confirmed ? 'cancelled' : 'kept'))} />
    <AppText testID="answer">{answer}</AppText>
    <CancellationPrompt />
  </SafeAreaProvider>;
}
const meta = { title: 'Booking/Cancellation prompt', component: Fixture } satisfies Meta<typeof Fixture>;
export default meta;
type Story = StoryObj<typeof meta>;
const en = appointmentCancellationCopy('en'), he = appointmentCancellationCopy('he');

// Tapping the backdrop is a "keep"; only the sheet's own button cancels.
export const BackdropKeeps: Story = { play: async ({ canvas, canvasElement }) => {
  const body = within(canvasElement.ownerDocument.body);
  await userEvent.click(canvas.getByRole('button', { name: 'Cancel' }));
  const sheet = await body.findByTestId('cancellation-prompt');
  await expect(within(sheet).getByText(en.title)).toBeVisible(); await expect(within(sheet).getByText(en.message)).toBeVisible();
  await userEvent.click(body.getByTestId('cancellation-prompt-backdrop'));
  await waitFor(() => expect(canvas.getByTestId('answer')).toHaveTextContent('kept'));
  await waitFor(() => expect(body.queryByTestId('cancellation-prompt-backdrop')).toBeNull());
  await userEvent.click(canvas.getByRole('button', { name: 'Cancel' }));
  await userEvent.click(within(await body.findByTestId('cancellation-prompt')).getByRole('button', { name: en.cancel }));
  await waitFor(() => expect(canvas.getByTestId('answer')).toHaveTextContent('cancelled'));
} };
export const Hebrew: Story = { globals: { locale: 'he' }, play: async ({ canvas, canvasElement }) => {
  await userEvent.click(canvas.getByRole('button', { name: 'Cancel' }));
  const sheet = await within(canvasElement.ownerDocument.body).findByTestId('cancellation-prompt');
  await expect(within(sheet).getByText(he.title)).toBeVisible();
  await userEvent.click(within(sheet).getByRole('button', { name: he.keep }));
  await waitFor(() => expect(canvas.getByTestId('answer')).toHaveTextContent('kept'));
} };
