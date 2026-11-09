import type { Meta, StoryObj } from '@storybook/react';
import { expect, fn, userEvent } from 'storybook/test';
import { UpcomingAppointment } from './UpcomingAppointment.component';
const appointment = { id: 'upcoming', when: 'Tomorrow · 12:00', place: 'Visit studio · Ramat Gan' };
const meta = { title: 'Home/Upcoming appointment', component: UpcomingAppointment, args: { state: 'ready', heading: '', loadingLabel: 'Loading upcoming appointment…', error: '', retryLabel: 'Try again', appointments: [appointment], onRetry: fn(), onOpen: fn() } } satisfies Meta<typeof UpcomingAppointment>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Ready: Story = { play: async ({ canvas, args }) => {
  await expect(canvas.queryByRole('heading')).toBeNull();
  await userEvent.click(canvas.getByRole('button', { name: /Tomorrow · 12:00.*Visit studio · Ramat Gan/ })); await expect(args.onOpen).toHaveBeenCalledWith('upcoming');
} };
export const SeveralToday: Story = { args: { appointments: [{ id: 'one', when: 'Today · 13:30', place: 'Barak · Ramat Gan' }, { id: 'two', when: 'Today · 15:00', place: 'Veterinarian · Ramat Gan' }, { id: 'three', when: 'Today · 18:45', place: 'Visit studio' }] }, play: async ({ canvas, args }) => {
  await expect(canvas.getAllByRole('button')).toHaveLength(3);
  await userEvent.click(canvas.getByRole('button', { name: /Today · 15:00/ })); await expect(args.onOpen).toHaveBeenCalledWith('two');
} };
export const OnABusinessPage: Story = { args: { heading: 'Your appointment with this business' }, play: async ({ canvas }) => { await expect(canvas.getByRole('heading', { name: 'Your appointment with this business' })).toBeVisible(); } };
export const Hidden: Story = { args: { state: 'hidden', appointments: [] }, play: async ({ canvas }) => { await expect(canvas.queryAllByRole('button')).toHaveLength(0); } };
export const NoAppointments: Story = { args: { appointments: [] }, play: async ({ canvas }) => { await expect(canvas.queryAllByRole('button')).toHaveLength(0); } };
export const Loading: Story = { args: { state: 'loading', appointments: [] }, play: async ({ canvas }) => { await expect(canvas.getByRole('status')).toHaveTextContent('Loading upcoming appointment…'); await expect(canvas.queryAllByRole('button')).toHaveLength(0); } };
export const FailedRead: Story = { args: { state: 'error', appointments: [], error: 'Upcoming appointments could not load.' }, play: async ({ canvas, args }) => { await expect(canvas.getByRole('alert')).toHaveTextContent('Upcoming appointments could not load.'); await userEvent.click(canvas.getByRole('button', { name: 'Try again' })); await expect(args.onRetry).toHaveBeenCalled(); } };
export const HebrewLongText: Story = { args: { appointments: [{ ...appointment, place: 'המרכז המקצועי לייעוץ ושיקום עם שם עסק ארוך מאוד שנשבר למספר שורות · רמת גן', when: 'מחר · 12:00' }] } };
