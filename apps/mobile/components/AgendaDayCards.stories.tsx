import type { Meta, StoryObj } from '@storybook/react';
import { View } from 'react-native';
import { expect, fn, userEvent } from 'storybook/test';
import { BlockCard, ClosedDayCard, FreeTimeCard } from './AgendaDayCards.component';
import { translate } from '../src/i18n/messages';
import type { FreeGap } from '../src/lib/AgendaToday.utils';
import type { TimeBlock } from '../src/types/TimeBlocks.types';

const he = (key: Parameters<typeof translate>[1], values?: Record<string, string | number>) => translate('he', key, values);
const gap: FreeGap = { staffId: 'barak', staffName: 'ברק', startsAt: '2026-11-11T13:30:00Z', endsAt: '2026-11-11T14:30:00Z', startLocal: '15:30', endLocal: '16:30', bookLocal: '15:30' };
const block = (patch: Partial<TimeBlock> = {}): TimeBlock => ({ id: 'lunch', startsAt: '2026-11-11T11:00:00Z', endsAt: '2026-11-11T11:30:00Z', allDay: false, reason: 'הפסקה', staff: null, fromDate: '2026-11-11', toDate: '2026-11-11', startLocal: '13:00', endLocal: '13:30', ...patch });

/** The three cards together, as the business home shows them between appointments. */
function DayCards({ onAdd, onBlock, onHours }: { onAdd: () => void; onBlock: () => void; onHours: () => void }) {
  return <View style={{ maxWidth: 390, gap: 8 }}>
    <ClosedDayCard t={he} onHours={onHours} />
    <BlockCard block={block()} t={he} onPress={onBlock} />
    <BlockCard block={block({ id: 'day', allDay: true, reason: null, startLocal: undefined, endLocal: undefined, staff: { id: 'barak', displayName: 'ברק' } })} t={he} onPress={onBlock} />
    <FreeTimeCard gap={gap} t={he} staffName={false} onPress={onAdd} />
    <FreeTimeCard gap={{ ...gap, staffId: 'dana', staffName: 'דנה' }} t={he} staffName onPress={onAdd} />
  </View>;
}
const meta = { globals: { locale: 'he' }, title: 'Provider/Agenda day cards', component: DayCards, args: { onAdd: fn(), onBlock: fn(), onHours: fn() } } satisfies Meta<typeof DayCards>;
export default meta;
type Story = StoryObj<typeof meta>;

// Free time says "Add appointment" and its hours; with several staff it names whose time it is. A tap adds there.
export const Free: Story = { play: async ({ canvas, args }) => {
  const [single] = canvas.getAllByRole('button', { name: /הוספת תור/ });
  await expect(single).toHaveTextContent('פנוי');
  await expect(canvas.getByText(/· דנה/)).toBeVisible();
  await userEvent.click(single!); await expect(args.onAdd).toHaveBeenCalledOnce();
} };
// A block shows its reason, or "Blocked" without one, and "All day" for a whole day; a tap opens its details.
export const Blocks: Story = { play: async ({ canvas, args }) => {
  await expect(canvas.getByRole('button', { name: /הפסקה/ })).toBeVisible();
  const allDay = canvas.getByRole('button', { name: /חסום/ });
  await expect(allDay).toHaveTextContent(he('blocks.allDay')); await expect(allDay).toHaveTextContent('ברק');
  await userEvent.click(allDay); await expect(args.onBlock).toHaveBeenCalledOnce();
} };
// A closed day cannot be released from here, so its card leads to the opening hours.
export const Closed: Story = { play: async ({ canvas, args }) => {
  await expect(canvas.getByText(he('dashboard.closed'))).toBeVisible();
  await userEvent.click(canvas.getByRole('link', { name: he('dashboard.closedHours') })); await expect(args.onHours).toHaveBeenCalledOnce();
} };
