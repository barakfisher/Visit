import { registerSavedProviders } from './routes/saved-providers.js';
import { registerAccountMethods } from './routes/account-methods.js';
import Fastify from "fastify";
import cors from "@fastify/cors";
import { Pool } from "pg";
import { AppError } from "./http/errors.js";
import { ensureRedisReady, redis } from "./infra/redis.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerProviderRoutes } from "./routes/providers.js";
import { registerBookingRoutes } from "./routes/bookings.js";
import { registerFlowAuth } from "./routes/flow-auth.js";
import { registerScreenFlows } from "./routes/screen-flows.js";
import { ZodError } from "zod";
import { env } from "./env.js";
import { safeRequestLog, safeErrorLog } from "./security/logging.js";
import { registerRequestSecurity } from "./security/request-security.js";

export async function createApp({ google, account, providerReviewScope = 'live' }: { google?: NonNullable<Parameters<typeof registerFlowAuth>[1]>['google']; account?: NonNullable<Parameters<typeof registerAccountMethods>[1]>['account']; providerReviewScope?: string } = {}) {
  const trustedProxies = env.TRUSTED_PROXY_CIDRS.split(",").map(value => value.trim()).filter(Boolean);
  const app = Fastify({ trustProxy: trustedProxies.length ? trustedProxies : false, logger: { serializers: { req: safeRequestLog }, redact: ["req.headers.authorization", "req.headers.cookie"] } });
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 5, connectionTimeoutMillis: 3000, query_timeout: 3000 });
  pool.on("error", () => app.log.warn("Database health connection lost"));

  await app.register(cors, {
    origin: new URL(env.WEB_APP_URL).origin,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  });

  // Never persist identity, tenant data, OTP challenges or error bodies in HTTP caches.
  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("Cache-Control", "no-store");
    return payload;
  });

  registerRequestSecurity(app, env.WEB_APP_URL);
  await registerAuthRoutes(app);
  await registerProviderRoutes(app, { reviewScope: providerReviewScope });
  await registerBookingRoutes(app);
  await registerAccountMethods(app, account ? { account } : {});
  await registerFlowAuth(app, google ? { google } : {});
  await registerScreenFlows(app);
  await registerSavedProviders(app);

  app.get("/health/live", async () => ({ status: "ok" }));

  app.get("/health/ready", async (_request, reply) => {
    let database = "ok";
    let redisState = "ok";
    try {
      await pool.query("SELECT 1");
      const migrations = await pool.query<{ present: boolean }>(`SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS present`);
      if (!migrations.rows[0]?.present) database = "unavailable";
      else {
        const pending = await pool.query<{ count: string }>(`SELECT count(*) AS count FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL`);
        if (Number(pending.rows[0]?.count ?? 0) > 0) database = "unavailable";
      }
    } catch {
      database = "unavailable";
    }
    try {
      await ensureRedisReady();
      await redis.ping();
    } catch {
      redisState = "unavailable";
    }
    const ready = database === "ok" && redisState === "ok";
    reply.code(ready ? 200 : 503);
    return { status: ready ? "ready" : "not_ready", database, redis: redisState };
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) { reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "Review the submitted fields." } }); return; }
    if (error instanceof AppError) {
      reply.code(error.statusCode).send({ error: { code: error.code, message: error.message, ...(error.fields ? { fields: error.fields } : {}) } });
      return;
    }
    request.log.error(safeErrorLog(error), "request failed");
    reply.code(500).send({ error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" } });
  });

  app.addHook("onClose", async () => { await pool.end(); });
  return app;
}
