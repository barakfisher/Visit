import type { Meta, StoryObj } from '@storybook/react';
import { expect, fn, userEvent } from 'storybook/test';
import { ScheduleEditor } from './ScheduleEditor.component';
import { translate } from '../src/i18n/messages';
import type { ScheduleEditorView, SchedulePreview } from '../src/types/ScheduleEditor.types';
const t: ScheduleEditorView['t'] = (key, values) => translate('en', key, values);
const preview: SchedulePreview = { token: 'preview', timezone: 'Asia/Jerusalem', canSave: true, affected: [] };
const affected = { id: 'appointment', revision: 2, status: 'CONFIRMED', startsAt: '2027-03-15T10:00:00Z', endsAt: '2027-03-15T10:30:00Z', serviceName: 'Consultation', staffName: 'Specialist' };
const meta = { title: 'Provider/Schedule editor', component: ScheduleEditor, args: {
  t, locale: 'en', staff: false, ready: true, loading: false, failed: false, busy: false, feedback: '',
  weekly: [[{ startLocal: '09:00', endLocal: '17:00' }]], overrides: [], preview: null,
  interval: fn(), exception: fn(), inherit: fn(), addHours: fn(), removeException: fn(), addException: fn(), save: fn(), confirm: fn(), reload: fn(), when: () => '15 March · 12:00 · Israel time',
} } satisfies Meta<typeof ScheduleEditor>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Ready: Story = { play: async ({ canvas, args }) => {
  await expect(canvas.getByDisplayValue('09:00')).toBeVisible();
  await userEvent.click(canvas.getByRole('button', { name: t('setup.saveHours') }));
  await expect(args.save).toHaveBeenCalled();
} };
export const SafePreview: Story = { args: { preview }, play: async ({ canvas, args }) => {
  await expect(canvas.getByText(t('agendaEdit.safe', { count: 0 }))).toBeVisible();
  await userEvent.click(canvas.getByRole('button', { name: t('agendaEdit.confirm') }));
  await expect(args.confirm).toHaveBeenCalled();
} };
export const ConflictingAppointment: Story = { args: { preview: { ...preview, canSave: false, affected: [affected] } }, play: async ({ canvas, args }) => {
  await expect(canvas.getByText('Consultation · Specialist')).toBeVisible();
  await expect(canvas.getByRole('button', { name: t('agendaEdit.confirm') })).toBeDisabled();
  await expect(args.confirm).not.toHaveBeenCalled();
} };
export const ActiveReservation: Story = { args: { preview: { ...preview, canSave: false, affected: [{ ...affected, status: 'HELD' }] } }, play: async ({ canvas }) => {
  await expect(canvas.getByText(t('agendaEdit.reservation'))).toBeVisible();
  await expect(canvas.getByRole('button', { name: t('agendaEdit.confirm') })).toBeDisabled();
} };
export const Pending: Story = { args: { busy: true, preview }, play: async ({ canvas }) => {
  for (const button of canvas.getAllByRole('button')) await expect(button).toBeDisabled();
  await expect(canvas.getByDisplayValue('09:00')).toHaveAttribute('readonly');
} };
export const Loading: Story = { args: { ready: false, loading: true }, play: async ({ canvas }) => {
  await expect(canvas.getByRole('status')).toHaveTextContent(t('common.loading'));
  await expect(canvas.queryByDisplayValue('09:00')).toBeNull();
} };
export const FailedInitialLoad: Story = { args: { ready: false, failed: true }, play: async ({ canvas, args }) => {
  await expect(canvas.getByRole('alert')).toBeVisible();
  await userEvent.click(canvas.getByRole('button', { name: t('common.retry') })); await expect(args.reload).toHaveBeenCalled();
} };
export const FailedReloadRetainsDraft: Story = { args: { failed: true }, play: async ({ canvas }) => {
  await expect(canvas.getByRole('alert')).toHaveTextContent(t('setup.failure'));
  await expect(canvas.getByDisplayValue('09:00')).toBeVisible();
} };
export const FailedCommitRetainsDraft: Story = { args: { feedback: 'error', preview }, play: async ({ canvas }) => {
  await expect(canvas.getByRole('alert')).toHaveTextContent(t('agendaEdit.saveFailure'));
  await expect(canvas.getByDisplayValue('09:00')).toBeVisible();
} };
export const StaffInheritance: Story = { args: { staff: true, weekly: [] }, play: async ({ canvas, args }) => {
  await userEvent.click(canvas.getByRole('button', { name: t('setup.inherit') })); await expect(args.inherit).toHaveBeenCalled();
} };
export const HebrewConflicts: Story = { args: { locale: 'he', t: (key, values) => translate('he', key, values), preview: { ...preview, canSave: false, affected: [{ ...affected, serviceName: 'פגישת ייעוץ מקיפה ומעקב ארוך טווח עם צוות המומחים', staffName: 'מומחית ראשית' }] } }, globals: { locale: 'he' } };
