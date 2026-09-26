import type { FastifyInstance } from "fastify";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { AuthGuards } from "../auth.ts";
import { isAllowedRequestOrigin, type AppConfig } from "../config.ts";
import type { AppDatabase } from "../db/database.ts";
import { auditEvents, invitations, sessions, users } from "../db/schema.ts";
import { hashPassword, newId, newOpaqueToken, sha256, verifyPassword } from "../lib/security.ts";

interface AuthRouteOptions {
  db: AppDatabase;
  config: AppConfig;
  guards: AuthGuards;
}

const credentialsSchema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(256) }).strict();

export async function registerAuthRoutes(app: FastifyInstance, options: AuthRouteOptions): Promise<void> {
  const { db, config, guards } = options;

  app.post("/api/v1/auth/login", {
    config: { rateLimit: { max: 8, timeWindow: "15 minutes" } },
  }, async (request, reply) => {
    if (!isAllowedRequestOrigin(request.headers.origin, config)) {
      return reply.code(403).send({ error: "ORIGIN_REJECTED", message: "Request origin was rejected." });
    }
    const parsed = credentialsSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(422).send({ error: "INVALID_CREDENTIALS", message: "Enter a valid email and password." });

    const [user] = await db.select().from(users).where(eq(users.email, parsed.data.email)).limit(1);
    const passwordValid = user ? await verifyPassword(user.passwordHash, parsed.data.password) : false;
    const productionDefaultBlocked = config.production && user && (user.email === "admin@egain.local" || user.mustChangePassword);
    if (!user || !user.active || !passwordValid || productionDefaultBlocked) {
      return reply.code(401).send({ error: "INVALID_CREDENTIALS", message: "Email or password is incorrect." });
    }

    const token = newOpaqueToken();
    const csrfToken = newOpaqueToken(24);
    const expiresAt = new Date(Date.now() + config.sessionHours * 60 * 60 * 1000);
    await db.transaction(async (transaction) => {
      await transaction.insert(sessions).values({
        id: newId(), userId: user.id, tokenHash: sha256(token), csrfToken, expiresAt,
      });
      await transaction.update(users).set({ lastLoginAt: new Date(), updatedAt: new Date() }).where(eq(users.id, user.id));
      await transaction.insert(auditEvents).values({
        id: newId(), actorId: user.id, entityType: "SESSION", entityId: user.id, action: "LOGIN",
        detail: {}, ipAddress: request.ip,
      });
    });
    reply.setCookie("egain_session", token, {
      path: "/api/v1",
      httpOnly: true,
      secure: config.production,
      sameSite: "strict",
      expires: expiresAt,
    });
    return {
      user: { id: user.id, email: user.email, name: user.name, role: user.role, teamId: user.teamId, mustChangePassword: user.mustChangePassword },
      csrfToken,
    };
  });

  app.get("/api/v1/auth/me", { preHandler: guards.requireAuth }, async (request) => ({
    user: request.authUser,
    csrfToken: request.authCsrfToken,
  }));

  app.post("/api/v1/auth/logout", { preHandler: guards.requireMutation }, async (request, reply) => {
    if (request.authSessionId) await db.delete(sessions).where(eq(sessions.id, request.authSessionId));
    reply.clearCookie("egain_session", { path: "/api/v1" });
    return reply.code(204).send();
  });

  app.post("/api/v1/auth/change-password", { preHandler: guards.requireMutation }, async (request, reply) => {
    const parsed = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(12).max(256) }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(422).send({ error: "INVALID_PASSWORD", message: "New password must contain at least 12 characters." });
    const [user] = await db.select().from(users).where(eq(users.id, request.authUser!.id)).limit(1);
    if (!user || !(await verifyPassword(user.passwordHash, parsed.data.currentPassword))) {
      return reply.code(422).send({ error: "INVALID_PASSWORD", message: "Current password is incorrect." });
    }
    if (parsed.data.newPassword === "1234") return reply.code(422).send({ error: "INVALID_PASSWORD", message: "Choose a non-default password." });
    await db.transaction(async (transaction) => {
      await transaction.update(users).set({
        passwordHash: await hashPassword(parsed.data.newPassword), mustChangePassword: false, updatedAt: new Date(),
      }).where(eq(users.id, user.id));
      await transaction.insert(auditEvents).values({
        id: newId(), actorId: user.id, entityType: "USER", entityId: user.id, action: "PASSWORD_CHANGED", detail: {},
      });
    });
    return { changed: true };
  });

  app.post("/api/v1/auth/accept-invite", async (request, reply) => {
    if (!isAllowedRequestOrigin(request.headers.origin, config)) return reply.code(403).send({ error: "ORIGIN_REJECTED", message: "Request origin was rejected." });
    const parsed = z.object({ token: z.string().min(20), name: z.string().trim().min(2).max(120), password: z.string().min(12).max(256) }).strict().safeParse(request.body);
    if (!parsed.success || parsed.data.password === "1234") return reply.code(422).send({ error: "INVALID_INVITE", message: "Invitation or password is invalid." });
    const [invite] = await db.select().from(invitations).where(and(
      eq(invitations.tokenHash, sha256(parsed.data.token)),
      isNull(invitations.acceptedAt),
    )).limit(1);
    if (!invite || invite.expiresAt < new Date()) return reply.code(410).send({ error: "INVITE_EXPIRED", message: "This invitation has expired." });
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, invite.email)).limit(1);
    if (existing) return reply.code(409).send({ error: "ACCOUNT_EXISTS", message: "An account already exists for this email." });
    const userId = newId();
    await db.transaction(async (transaction) => {
      await transaction.insert(users).values({
        id: userId, email: invite.email, name: parsed.data.name, passwordHash: await hashPassword(parsed.data.password),
        role: invite.role, teamId: invite.teamId, active: true,
      });
      await transaction.update(invitations).set({ acceptedAt: new Date() }).where(eq(invitations.id, invite.id));
      await transaction.insert(auditEvents).values({
        id: newId(), actorId: userId, entityType: "USER", entityId: userId, action: "INVITE_ACCEPTED", detail: {},
      });
    });
    return reply.code(201).send({ accepted: true });
  });
}
