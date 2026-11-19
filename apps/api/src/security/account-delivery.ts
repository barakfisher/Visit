import { env } from '../env.js';
import { AppError } from '../http/errors.js';
export type AccountChannel = 'email' | 'phone';
// 'confirm-own': an MVP account proving the address it was trusted with. Whoever reads the code may not be the
// account holder, so that email warns them not to share it (decisions.md, "An MVP account proves its own address").
export type AccountEmailPurpose = 'change' | 'confirm-own';
export type AccountDelivery = {
  emailVerification: (input: { destination: string; code: string; id: string; locale: string | null; purpose?: AccountEmailPurpose }) => Promise<void>;
  alert: (input: { channel: AccountChannel; destination: string; id: string; locale: string | null }) => Promise<string>;
  available: (channel: AccountChannel) => boolean;
  localCode?: (id: string) => string | undefined;
  /** A password sign-up's code, or "you already have an account" when the address is registered (login-plan-stage-2.md, slice 1). */
  signUp: (input: { destination: string; code: string | null; id: string; locale: 'he' | 'en' }) => Promise<void>;
  localSignUp?: (id: string) => { code: string | null } | undefined;
};
const unavailable = () => new AppError(503, 'ACCOUNT_DELIVERY_UNAVAILABLE', 'Verification delivery is unavailable. Try again shortly.');
export function createLocalAccountDelivery(): AccountDelivery {
  const codes = new Map<string, { code: string | null; expiresAt: number }>();
  const keep = (id: string, code: string | null) => { for (const [key, value] of codes) if (value.expiresAt <= Date.now()) codes.delete(key); if (codes.size >= 1000) codes.delete(codes.keys().next().value!); codes.set(id, { code, expiresAt: Date.now() + 600000 }); };
  const read = (id: string) => { const value = codes.get(id); if (!value || value.expiresAt <= Date.now()) { codes.delete(id); return undefined; } return value; };
  return {
    available: () => true,
    async emailVerification({ id, code }) { keep(id, code); },
    async alert() { return 'local-inbox'; },
    localCode: id => read(id)?.code ?? undefined,
    async signUp({ id, code }) { keep(id, code); },
    localSignUp: id => { const value = read(id); return value && { code: value.code }; },
  };
}
export function accountVerificationEmail(locale: string | null, code: string, purpose: AccountEmailPurpose) {
  const he = locale !== 'en';
  if (purpose === 'confirm-own') return he
    ? { subject: 'מישהו מבקש לאשר שהכתובת הזו שלו ב־Visit', text: `מישהו שנכנס לחשבון Visit שמשתמש בכתובת הזו מבקש לאשר שהיא שלו. הקוד: ${code}\nאם לא אתם ביקשתם עכשיו, מתוך Visit, לאשר את הכתובת הזו, אל תמסרו את הקוד לאף אחד. כניסה ל־Visit עם קישור במייל לכתובת הזו מבטלת את הסיסמה שנקבעה בלי לאשר אותה ומנתקת את המכשירים המחוברים.\nהקוד תקף ל־10 דקות.` }
    : { subject: 'Someone wants to confirm this address on Visit', text: `Someone signed in to a Visit account that uses this address wants to confirm it is theirs. The code: ${code}\nIf you did not just ask to confirm this address while signed in to Visit, do not share this code with anyone. Signing in to Visit with an email link to this address cancels the password that was set without proving it and signs out every device.\nThe code expires in 10 minutes.` };
  return he
    ? { subject: 'אימות כתובת הדואר בחשבון Visit', text: `קוד האימות לשינוי כתובת הדואר בחשבון Visit: ${code}\nאל תמסרו את הקוד לאף אחד. הקוד תקף ל־10 דקות. אם לא ביקשתם שינוי, התעלמו מהודעה זו.` }
    : { subject: 'Verify your Visit email address', text: `Your code to change your Visit email address: ${code}\nDo not share this code with anyone. This code expires in 10 minutes. If you did not request a change, ignore this message.` };
}
export function signUpEmail(input: { code: string | null; locale: 'he' | 'en' }) {
  const he = input.locale === 'he';
  if (input.code === null) return he
    ? { subject: 'כבר יש לכם חשבון Visit', text: 'מישהו ניסה להירשם ל־Visit עם הכתובת הזו, אבל כבר קיים לה חשבון.\nאפשר פשוט להיכנס לחשבון הקיים במסך הכניסה. אם לא ניסיתם להירשם, התעלמו מהודעה זו.' }
    : { subject: 'You already have a Visit account', text: 'Someone tried to sign up for Visit with this address, but it already has an account.\nSign in to your existing account on the sign-in screen instead. If this was not you, ignore this email.' };
  return he
    ? { subject: 'קוד ההרשמה שלכם ל־Visit', text: `קוד ההרשמה שלכם ל־Visit: ${input.code}\nהקוד תקף ל־10 דקות. אם לא ניסיתם להירשם, התעלמו מהודעה זו.` }
    : { subject: 'Your Visit sign-up code', text: `Your Visit sign-up code: ${input.code}\nThis code expires in 10 minutes. If you did not try to sign up, ignore this email.` };
}
export function createAccountDelivery({ emailMode = env.EMAIL_DELIVERY_MODE, apiKey = env.EMAIL_API_KEY, from = env.EMAIL_FROM, smsMode = env.SMS_DELIVERY_MODE, messagingServiceSid = env.TWILIO_MESSAGING_SERVICE_SID, accountSid = env.TWILIO_ACCOUNT_SID, authToken = env.TWILIO_AUTH_TOKEN, transport = fetch }: { emailMode?: string; apiKey?: string | undefined; from?: string; smsMode?: string; messagingServiceSid?: string | undefined; accountSid?: string | undefined; authToken?: string | undefined; transport?: typeof fetch } = {}): AccountDelivery {
  const local = createLocalAccountDelivery();
  async function email(destination: string, subject: string, text: string, id: string) {
    try {
      const response = await transport('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `account-security/${id}` }, body: JSON.stringify({ from, to: [destination], subject, text }), signal: AbortSignal.timeout(10000) });
      if (!response.ok || typeof (await response.json() as { id?: unknown }).id !== 'string') throw unavailable();
    } catch { throw unavailable(); }
  }
  return {
    available: channel => channel === 'email' ? emailMode === 'local-inbox' || Boolean(apiKey) : smsMode === 'local-inbox' || Boolean(messagingServiceSid && accountSid && authToken),
    localCode: id => local.localCode?.(id),
    localSignUp: id => local.localSignUp?.(id),
    async signUp(input) {
      if (emailMode === 'local-inbox') return local.signUp(input);
      if (!apiKey) throw unavailable();
      const message = signUpEmail(input);
      await email(input.destination, message.subject, message.text, input.id);
    },
    async emailVerification(input) {
      if (emailMode === 'local-inbox') return local.emailVerification(input);
      if (!apiKey) throw unavailable();
      const message = accountVerificationEmail(input.locale, input.code, input.purpose ?? 'change');
      await email(input.destination, message.subject, message.text, input.id);
    },
    async alert(input) {
      const localMode = input.channel === 'email' ? emailMode === 'local-inbox' : smsMode === 'local-inbox';
      if (localMode) return local.alert(input);
      const he = input.locale !== 'en';
      const text = he ? 'אמצעי הכניסה לחשבון Visit שלכם השתנו. אם לא ביצעתם שינוי, יש להיכנס עם אמצעי קיים ולבקש בדיקת בעלות לשחזור החשבון.' : 'Your Visit sign-in settings changed. If this was not you, sign in with an existing method and request reviewed account recovery.';
      if (input.channel === 'email') { if (!apiKey) throw unavailable(); await email(input.destination, he ? 'אמצעי הכניסה ל־Visit השתנו' : 'Visit sign-in settings changed', text, input.id); return 'resend'; }
      if (!messagingServiceSid || !accountSid || !authToken) throw unavailable();
      try {
        const response = await transport(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ To: input.destination, MessagingServiceSid: messagingServiceSid, Body: text }), signal: AbortSignal.timeout(10000) });
        const result = await response.json() as { sid?: unknown; status?: unknown };
        if (!response.ok || typeof result.sid !== 'string' || !/^SM[a-fA-F0-9]{32}$/.test(result.sid) || !['queued', 'accepted', 'sending', 'sent', 'delivered'].includes(String(result.status))) throw unavailable();
        return 'twilio';
      } catch { throw unavailable(); }
    },
  };
}
export const accountDelivery = createAccountDelivery();
