import Fastify from "fastify";
import cors from "@fastify/cors";
import { Pool } from "pg";
import { AppError } from "./http/errors.js";
import { ensureRedisReady, redis } from "./infra/redis.js";
import { prisma } from "./db/client.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerProviderRoutes } from "./routes/providers.js";
import { registerBookingRoutes } from "./routes/bookings.js";
import { registerFlowAuth } from "./routes/flow-auth.js";
import { registerScreenFlows } from "./routes/screen-flows.js";
import { ZodError } from "zod";
import { env } from "./env.js";
import { registerRequestSecurity } from "./security/request-security.js";

const trustedProxies = env.TRUSTED_PROXY_CIDRS.split(",").map(value => value.trim()).filter(Boolean);
const app = Fastify({ trustProxy: trustedProxies.length ? trustedProxies : false, logger: { redact: ["req.headers.authorization", "req.headers.cookie"] } });
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
await registerProviderRoutes(app);
await registerBookingRoutes(app);
await registerFlowAuth(app);
await registerScreenFlows(app);

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

app.setErrorHandler((error, _request, reply) => {
  if (error instanceof ZodError) { reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "Review the submitted fields." } }); return; }
  if (error instanceof AppError) {
    reply.code(error.statusCode).send({ error: { code: error.code, message: error.message, ...(error.fields ? { fields: error.fields } : {}) } });
    return;
  }
  app.log.error({ err: error }, "request failed");
  reply.code(500).send({ error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" } });
});

const close = async () => {
  await app.close();
  await Promise.allSettled([pool.end(), redis.quit(), prisma.$disconnect()]);
};
process.once("SIGINT", () => void close().then(() => process.exit(0)));
process.once("SIGTERM", () => void close().then(() => process.exit(0)));

await app.listen({ host: env.API_HOST, port: env.API_PORT });
