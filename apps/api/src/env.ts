import dotenv from "dotenv";
import { isIP } from "node:net";
import { z } from "zod";

dotenv.config({ path: "../../.env" });

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  TRUSTED_PROXY_CIDRS: z.string().default("").refine(value => value.split(',').map(entry => entry.trim()).filter(Boolean).every(entry => {
    const [address, prefix, extra] = entry.split('/');
    const version = isIP(address ?? '');
    return !extra && Boolean(version) && (prefix === undefined || (/^\d+$/.test(prefix) && Number(prefix) > 0 && Number(prefix) <= (version === 4 ? 32 : 128)));
  }), 'Use explicit proxy IPs or bounded CIDRs.'),
  API_HOST: z.string().default("0.0.0.0"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().default("redis://localhost:6380"),
  SESSION_SECRET: z.string().min(32),
  EMAIL_DELIVERY_MODE: z.enum(["local-inbox", "resend"]).default("local-inbox"),
  EMAIL_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("Visit <login@localhost>"),
  WEB_APP_URL: z.string().url().default("http://localhost:8081"),
  SMS_DELIVERY_MODE: z.enum(["disabled", "local-inbox", "twilio"]).default("disabled"),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_VERIFY_SERVICE_SID: z.string().optional(),
  GOOGLE_CLIENT_IDS: z.string().optional(), // Legacy ID-token configuration is intentionally ignored.
  GOOGLE_CLIENT_ID: z.preprocess(value => value === '' ? undefined : value, z.string().min(1).optional()),
  GOOGLE_CLIENT_SECRET: z.preprocess(value => value === '' ? undefined : value, z.string().min(8).optional()),
  GOOGLE_CALLBACK_URL: z.preprocess(value => value === '' ? undefined : value, z.string().url().optional()),
  GOOGLE_NATIVE_RETURN_URL: z.preprocess(value => value === '' ? undefined : value, z.string().url().optional()),
  PLATFORM_ADMIN_EMAILS: z.string().default(""),
}).superRefine((value, context) => {
  try {
    const appUrl = new URL(value.WEB_APP_URL);
    if (!['http:', 'https:'].includes(appUrl.protocol) || appUrl.username || appUrl.password || appUrl.pathname !== '/' || appUrl.search || appUrl.hash || (value.NODE_ENV === 'production' && appUrl.protocol !== 'https:')) context.addIssue({ code: 'custom', path: ['WEB_APP_URL'], message: 'Use a web origin, with HTTPS in production.' });
  } catch { context.addIssue({ code: 'custom', path: ['WEB_APP_URL'], message: 'Use a valid web origin.' }); }
  const googleValues = [value.GOOGLE_CLIENT_ID, value.GOOGLE_CLIENT_SECRET, value.GOOGLE_CALLBACK_URL];
  if (googleValues.some(Boolean) && !googleValues.every(Boolean)) context.addIssue({ code: 'custom', path: ['GOOGLE_CLIENT_ID'], message: 'Google code flow requires client ID, server secret and callback URL.' });
  if (value.GOOGLE_CALLBACK_URL) {
    try {
      const callback = new URL(value.GOOGLE_CALLBACK_URL);
      const local = ['localhost', '127.0.0.1', '[::1]'].includes(callback.hostname);
      if (callback.username || callback.password || callback.search || callback.hash || callback.pathname !== '/api/auth/google/callback' || (callback.protocol !== 'https:' && !(value.NODE_ENV !== 'production' && local && callback.protocol === 'http:'))) context.addIssue({ code: 'custom', path: ['GOOGLE_CALLBACK_URL'], message: 'Use the exact HTTPS Google callback (loopback HTTP is development only).' });
    } catch { context.addIssue({ code: 'custom', path: ['GOOGLE_CALLBACK_URL'], message: 'Use a valid callback URL.' }); }
  }
  if (value.GOOGLE_NATIVE_RETURN_URL) {
    try {
      const target = new URL(value.GOOGLE_NATIVE_RETURN_URL);
      const claimed = target.protocol === 'https:' && target.origin === new URL(value.WEB_APP_URL).origin && target.pathname === '/auth/google';
      const development = value.NODE_ENV !== 'production' && target.toString() === 'visit://auth/google';
      if (!googleValues.every(Boolean) || (!claimed && !development) || target.username || target.password || target.search || target.hash) context.addIssue({ code: 'custom', path: ['GOOGLE_NATIVE_RETURN_URL'], message: 'Configure a claimed HTTPS app link (fixed Visit scheme is development only).' });
    } catch { context.addIssue({ code: 'custom', path: ['GOOGLE_NATIVE_RETURN_URL'], message: 'Use a valid native callback URL.' }); }
  }
  if (value.NODE_ENV === "production" && value.SMS_DELIVERY_MODE === "local-inbox") context.addIssue({ code: "custom", path: ["SMS_DELIVERY_MODE"], message: "Local SMS inbox is development only." });
  if (value.SMS_DELIVERY_MODE === "twilio" && (!/^AC[0-9a-fA-F]{32}$/.test(value.TWILIO_ACCOUNT_SID ?? '') || (value.TWILIO_AUTH_TOKEN?.length ?? 0) < 32 || !/^VA[0-9a-fA-F]{32}$/.test(value.TWILIO_VERIFY_SERVICE_SID ?? ''))) context.addIssue({ code: "custom", path: ["SMS_DELIVERY_MODE"], message: "Twilio Verify credentials are required." });
  if (value.NODE_ENV === "production" && value.EMAIL_DELIVERY_MODE !== "resend") {
    context.addIssue({ code: "custom", path: ["EMAIL_DELIVERY_MODE"], message: "Production requires configured email delivery." });
  }
  if (value.EMAIL_DELIVERY_MODE === "resend" && !value.EMAIL_API_KEY) {
    context.addIssue({ code: "custom", path: ["EMAIL_API_KEY"], message: "Required when EMAIL_DELIVERY_MODE=resend." });
  }
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const fields = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
  throw new Error(`Invalid environment configuration. Check: ${fields}`);
}

export const env = parsed.data;
