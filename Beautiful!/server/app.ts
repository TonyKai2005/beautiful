import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { eq, lt } from "drizzle-orm";
import { createAuthGuards } from "./auth.ts";
import { config as defaultConfig, type AppConfig } from "./config.ts";
import { openDatabase } from "./db/database.ts";
import { idempotencyRecords, sessions, systemSettings } from "./db/schema.ts";
import { seedDatabase } from "./db/seed.ts";
import { createOutboxWorker } from "./email/outbox.ts";
import { registerAdminRoutes } from "./routes/admin.ts";
import { registerAuthRoutes } from "./routes/auth.ts";
import { registerLeadRoutes } from "./routes/leads.ts";
import { createRetentionWorker } from "./retention.ts";

interface BuildAppOptions {
  databaseUrl?: string;
  config?: Partial<AppConfig> & { smtp?: Partial<AppConfig["smtp"]> };
  logger?: boolean;
  startWorker?: boolean;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const appConfig: AppConfig = {
    ...defaultConfig,
    ...options.config,
    smtp: { ...defaultConfig.smtp, ...options.config?.smtp },
  };
  const database = await openDatabase(options.databaseUrl);
  await seedDatabase(database.db, appConfig);
  await database.db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
  await database.db.delete(idempotencyRecords).where(lt(idempotencyRecords.expiresAt, new Date()));

  const app = Fastify({
    logger: options.logger ?? true,
    trustProxy: true,
    bodyLimit: 64 * 1024,
  });
  await app.register(cookie);
  await app.register(rateLimit, { global: true, max: 300, timeWindow: "1 minute" });

  const guards = createAuthGuards(database.db, appConfig);
  const outbox = createOutboxWorker(database.db, appConfig);
  const retention = createRetentionWorker(database.db);

  app.get("/api/v1/health", async () => ({
    status: "ok",
    database: database.mode,
    outbox: outbox.simulated ? "local-simulation" : "smtp",
    timestamp: new Date().toISOString(),
  }));
  app.get("/api/v1/config", async () => {
    const [privacy] = await database.db.select({ value: systemSettings.value }).from(systemSettings).where(eq(systemSettings.key, "privacy_notice_url")).limit(1);
    return { privacyNoticeUrl: privacy?.value ?? null, submissionsEnabled: !appConfig.production || Boolean(privacy?.value) };
  });

  await registerAuthRoutes(app, { db: database.db, config: appConfig, guards });
  await registerLeadRoutes(app, { db: database.db, config: appConfig });
  await registerAdminRoutes(app, { db: database.db, config: appConfig, guards, outbox });

  app.setNotFoundHandler(async (_request, reply) => reply.code(404).send({ error: "NOT_FOUND", message: "API route was not found." }));
  app.setErrorHandler(async (error, request, reply) => {
    request.log.error({ error }, "request failed");
    if (reply.sent) return;
    const typedError = error as { statusCode?: number; message?: string };
    const status = typedError.statusCode && typedError.statusCode >= 400 ? typedError.statusCode : 500;
    if (status === 429) {
      const retryAfter = Number(reply.getHeader("retry-after") ?? 60);
      return reply.code(429).send({ error: "RATE_LIMITED", message: "Mission Control is receiving too many transmissions. Retry when the countdown ends.", retryAfterSeconds: retryAfter });
    }
    return reply.code(status).send({
      error: status >= 500 ? "INTERNAL_ERROR" : "REQUEST_FAILED",
      message: status >= 500 ? "Mission Control encountered an internal error." : (typedError.message ?? "Request failed."),
    });
  });

  app.addHook("onReady", async () => {
    if (options.startWorker !== false) {
      outbox.start();
      retention.start();
    }
  });
  app.addHook("onClose", async () => {
    outbox.stop();
    retention.stop();
    await database.close();
  });
  return app;
}
