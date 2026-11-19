import { env } from '../env.js';
import { AppError } from '../http/errors.js';

// The two emails a password sign-up sends (login-plan-stage-2.md, slice 1): a code for a new address, or
// "you already have an account" for a registered one. Neither carries a link (decisions.md, "Verified
// password sign-up"). Hebrew unless the locale is English.
export type SignUpLocale = 'he' | 'en';
export type SignUpMessage = { kind: 'code'; code: string } | { kind: 'existing-account' };
export type SignUpDelivery = {
  available: () => boolean;
  local: boolean;
  send: (input: { id: string; sendId: string; destination: string; locale: SignUpLocale; message: SignUpMessage }) => Promise<void>;
  /** Local inbox only: the last message for a pending sign-up, for the loopback development helper and tests. */
  localMessage?: (id: string) => SignUpMessage | undefined;
};

const unavailable = () => new AppError(503, 'EMAIL_DELIVERY_FAILED', 'The email could not be sent. Please retry shortly.');

export function signUpEmail(locale: SignUpLocale, message: SignUpMessage) {
  const he = locale !== 'en';
  if (message.kind === 'code') return he
    ? { subject: 'קוד ההרשמה שלך ל־Visit', text: `קוד ההרשמה שלך ל־Visit: ${message.code}\nהקוד תקף ל־10 דקות. אם לא ניסיתם להירשם, התעלמו מהודעה זו.` }
    : { subject: 'Your Visit sign-up code', text: `Your Visit sign-up code: ${message.code}\nThis code expires in 10 minutes. If you did not try to sign up, ignore this message.` };
  return he
    ? { subject: 'כבר יש לך חשבון Visit', text: 'מישהו ניסה ליצור חשבון Visit עם הכתובת הזו, אבל כבר יש לך חשבון. היכנסו כרגיל, עם הסיסמה או עם הדרך שבה נרשמתם.\nאם לא אתם ניסיתם, אפשר להתעלם מהודעה זו.' }
    : { subject: 'You already have a Visit account', text: 'Someone tried to create a Visit account with this address, but you already have one. Sign in as usual, with your password or the way you signed up.\nIf this was not you, you can ignore this message.' };
}

export function createLocalSignUpDelivery(): SignUpDelivery {
  const messages = new Map<string, { message: SignUpMessage; expiresAt: number }>();
  return {
    available: () => true,
    local: true,
    async send({ id, message }) {
      for (const [key, value] of messages) if (value.expiresAt <= Date.now()) messages.delete(key);
      if (messages.size >= 1000) messages.delete(messages.keys().next().value!);
      messages.set(id, { message, expiresAt: Date.now() + 600000 });
    },
    localMessage(id) { const value = messages.get(id); if (!value || value.expiresAt <= Date.now()) { messages.delete(id); return undefined; } return value.message; },
  };
}

export function createSignUpDelivery({ emailMode = env.EMAIL_DELIVERY_MODE, apiKey = env.EMAIL_API_KEY, from = env.EMAIL_FROM, transport = fetch }: { emailMode?: string; apiKey?: string | undefined; from?: string; transport?: typeof fetch } = {}): SignUpDelivery {
  if (emailMode === 'local-inbox') return createLocalSignUpDelivery();
  return {
    available: () => Boolean(apiKey),
    local: false,
    async send({ sendId, destination, locale, message }) {
      if (!apiKey) throw unavailable();
      const { subject, text } = signUpEmail(locale, message);
      try {
        // One key per send: a resend on the same pending row is a new message, never a duplicate of the last.
        const response = await transport('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `sign-up/${sendId}` }, body: JSON.stringify({ from, to: [destination], subject, text }), signal: AbortSignal.timeout(10000) });
        if (!response.ok || typeof (await response.json() as { id?: unknown }).id !== 'string') throw unavailable();
      } catch { throw unavailable(); }
    },
  };
}

export const signUpDelivery = createSignUpDelivery();
