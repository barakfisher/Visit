import type { Meta, StoryObj } from '@storybook/react';
import { expect, fn, userEvent } from 'storybook/test';
import { View } from 'react-native';
import { PasswordSignIn } from './PasswordSignIn.component';
import type { SignUpCodeStep } from '@/src/types/PasswordSignIn.types';

const step = (overrides: Partial<SignUpCodeStep> = {}): SignUpCodeStep => ({ email: 'dana@example.com', code: '', cooldown: 0, remaining: 600, needsNewCode: false, issued: false, setCode: fn(), verify: fn(), resend: fn(), changeEmail: fn(), ...overrides });
const meta = {
  title: 'Authentication/PasswordSignIn', component: PasswordSignIn,
  args: { mode: 'sign-up', email: 'dana@example.com', password: 'correct horse', displayName: 'Dana Levi', busy: false, error: '', canSubmit: true, setEmail: fn(), setPassword: fn(), setDisplayName: fn(), submit: fn(), codeStep: null },
  decorators: [Story => <View style={{ width: 320, maxWidth: '100%', padding: 8 }}><Story /></View>],
} satisfies Meta<typeof PasswordSignIn>;
export default meta;
type Story = StoryObj<typeof meta>;

export const SignUpForm: Story = { play: async ({ canvas, args }) => {
  await expect(canvas.getByLabelText('Full name')).toBeVisible();
  await userEvent.click(canvas.getByRole('button', { name: 'Create account' }));
  await expect(args.submit).toHaveBeenCalledOnce();
} };
export const CodeSent: Story = { args: { codeStep: step({ code: '123456', cooldown: 30 }) }, play: async ({ canvas, args }) => {
  await expect(canvas.queryByLabelText('Full name')).toBeNull();
  await expect(canvas.getByText(/We sent a six-digit code to/)).toBeVisible();
  await expect(canvas.getByLabelText('Six-digit verification code')).toHaveAttribute('autocomplete', 'one-time-code');
  await expect(canvas.getByRole('button', { name: /30s/ })).toHaveAttribute('aria-disabled', 'true');
  await userEvent.click(canvas.getByRole('button', { name: 'Verify & create account' }));
  await expect(args.codeStep!.verify).toHaveBeenCalledOnce();
  await userEvent.click(canvas.getByRole('button', { name: 'Use a different email' }));
  await expect(args.codeStep!.changeEmail).toHaveBeenCalledOnce();
} };
export const IncompleteCode: Story = { args: { codeStep: step({ code: '123' }) }, play: async ({ canvas }) => {
  await expect(canvas.getByRole('button', { name: 'Verify & create account' })).toHaveAttribute('aria-disabled', 'true');
} };
export const WrongCode: Story = { args: { error: 'The code is incorrect. Check it and try again.', codeStep: step() }, play: async ({ canvas }) => {
  await expect(canvas.getByRole('alert')).toHaveTextContent('The code is incorrect.');
  await expect(canvas.getByLabelText('Six-digit verification code')).not.toBeDisabled();
} };
export const NeedsNewCode: Story = { args: { codeStep: step({ code: '', needsNewCode: true, remaining: 0 }) }, play: async ({ canvas, args }) => {
  await expect(canvas.getByText('This code is no longer valid. Send a new code.')).toBeVisible();
  await expect(canvas.getByRole('button', { name: 'Verify & create account' })).toHaveAttribute('aria-disabled', 'true');
  await userEvent.click(canvas.getByRole('button', { name: 'Send another code' }));
  await expect(args.codeStep!.resend).toHaveBeenCalledOnce();
} };
export const Verifying: Story = { args: { busy: true, codeStep: step({ code: '123456' }) }, play: async ({ canvas }) => {
  await expect(canvas.getByRole('button', { name: 'Use a different email' })).toHaveAttribute('aria-disabled', 'true');
} };
export const IssuedSessionRecovery: Story = { args: { error: 'Sign-in is unavailable right now. Check your connection and try again.', codeStep: step({ issued: true }) }, play: async ({ canvas, args }) => {
  await expect(canvas.queryByLabelText('Six-digit verification code')).toBeNull();
  await userEvent.click(canvas.getByRole('button', { name: 'Continue to my account' }));
  await expect(args.codeStep!.verify).toHaveBeenCalledOnce();
} };
export const HebrewCode: Story = { globals: { locale: 'he' }, args: { codeStep: step({ cooldown: 30 }) }, play: async ({ canvas }) => {
  await expect(canvas.getByText(/שלחנו קוד בן שש ספרות/)).toBeVisible();
  await expect(canvas.getByRole('button', { name: 'אימות ויצירת החשבון' })).toHaveAttribute('aria-disabled', 'true');
} };
