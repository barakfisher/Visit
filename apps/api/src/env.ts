import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ path: "../../.env" });

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
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
  GOOGLE_CLIENT_IDS: z.string().optional(),
  PLATFORM_ADMIN_EMAILS: z.string().default(""),
}).superRefine((value, context) => {
  if (value.NODE_ENV === "production" && value.SMS_DELIVERY_MODE === "local-inbox") context.addIssue({ code: "custom", path: ["SMS_DELIVERY_MODE"], message: "Local SMS inbox is development only." });
  if (value.SMS_DELIVERY_MODE === "twilio" && (!value.TWILIO_ACCOUNT_SID || !value.TWILIO_AUTH_TOKEN || !value.TWILIO_VERIFY_SERVICE_SID)) context.addIssue({ code: "custom", path: ["SMS_DELIVERY_MODE"], message: "Twilio Verify credentials are required." });
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
