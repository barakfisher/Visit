import { env } from '../env.js';
import { AppError } from '../http/errors.js';
export type AccountChannel = 'email' | 'phone';
export type AccountDelivery = {
  emailVerification: (input: { destination: string; code: string; id: string; locale: string | null }) => Promise<void>;
  alert: (input: { channel: AccountChannel; destination: string; id: string; locale: string | null }) => Promise<string>;
  available: (channel: AccountChannel) => boolean;
  localCode?: (id: string) => string | undefined;
};
const unavailable = () => new AppError(503, 'ACCOUNT_DELIVERY_UNAVAILABLE', 'Verification delivery is unavailable. Try again shortly.');
export function createLocalAccountDelivery(): AccountDelivery {
  const codes = new Map<string, { code: string; expiresAt: number }>();
  return { available: () => true, async emailVerification({ id, code }) { for (const [key, value] of codes) if (value.expiresAt <= Date.now()) codes.delete(key); if (codes.size >= 1000) codes.delete(codes.keys().next().value!); codes.set(id, { code, expiresAt: Date.now() + 600000 }); }, async alert() { return 'local-inbox'; }, localCode: id => { const value = codes.get(id); if (!value || value.expiresAt <= Date.now()) { codes.delete(id); return undefined; } return value.code; } };
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
    async emailVerification(input) {
      if (emailMode === 'local-inbox') return local.emailVerification(input);
      if (!apiKey) throw unavailable();
      const he = input.locale !== 'en';
      await email(input.destination, he ? 'אימות כתובת הדואר בחשבון Visit' : 'Verify your Visit email address', he ? `קוד האימות לשינוי כתובת הדואר בחשבון Visit: ${input.code}\nהקוד תקף ל־10 דקות. אם לא ביקשתם שינוי, התעלמו מהודעה זו.` : `Your code to change your Visit email address: ${input.code}\nThis code expires in 10 minutes. If you did not request a change, ignore this message.`, input.id);
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
