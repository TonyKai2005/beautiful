import type { FastifyReply, FastifyRequest } from "fastify";
import { and, eq, gt } from "drizzle-orm";
import type { UserRole } from "../shared/contracts.ts";
import { isAllowedRequestOrigin, type AppConfig } from "./config.ts";
import type { AppDatabase } from "./db/database.ts";
import { sessions, users } from "./db/schema.ts";
import { sha256 } from "./lib/security.ts";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  teamId: string | null;
  mustChangePassword: boolean;
}

declare module "fastify" {
  interface FastifyRequest {
    authUser?: AuthUser;
    authSessionId?: string;
    authCsrfToken?: string;
  }
}

export function createAuthGuards(db: AppDatabase, appConfig: AppConfig) {
  async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const token = request.cookies.egain_session;
    if (!token) {
      await reply.code(401).send({ error: "AUTH_REQUIRED", message: "Sign in to Mission Control." });
      return;
    }
    const [row] = await db.select({
      sessionId: sessions.id,
      csrfToken: sessions.csrfToken,
      userId: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      teamId: users.teamId,
      active: users.active,
      mustChangePassword: users.mustChangePassword,
    }).from(sessions).innerJoin(users, eq(users.id, sessions.userId)).where(and(
      eq(sessions.tokenHash, sha256(token)),
      gt(sessions.expiresAt, new Date()),
    )).limit(1);

    if (!row?.active || (appConfig.production && (row.email === "admin@egain.local" || row.mustChangePassword))) {
      reply.clearCookie("egain_session", { path: "/api/v1" });
      await reply.code(401).send({ error: "SESSION_INVALID", message: "Your session is no longer valid." });
      return;
    }
    request.authUser = {
      id: row.userId,
      email: row.email,
      name: row.name,
      role: row.role,
      teamId: row.teamId,
      mustChangePassword: row.mustChangePassword,
    };
    request.authSessionId = row.sessionId;
    request.authCsrfToken = row.csrfToken;
  }

  async function requireMutation(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    await requireAuth(request, reply);
    if (reply.sent) return;
    const origin = request.headers.origin;
    if (!isAllowedRequestOrigin(origin, appConfig)) {
      await reply.code(403).send({ error: "ORIGIN_REJECTED", message: "Request origin was rejected." });
      return;
    }
    if (request.headers["x-csrf-token"] !== request.authCsrfToken) {
      await reply.code(403).send({ error: "CSRF_REJECTED", message: "Refresh Mission Control and try again." });
    }
  }

  const requireRole = (role: UserRole, mutation = false) => async (request: FastifyRequest, reply: FastifyReply) => {
    await (mutation ? requireMutation(request, reply) : requireAuth(request, reply));
    if (reply.sent) return;
    if (request.authUser?.role !== role) {
      await reply.code(403).send({ error: "FORBIDDEN", message: "This action requires administrator access." });
    }
  };

  return { requireAuth, requireMutation, requireAdmin: requireRole("ADMIN"), requireAdminMutation: requireRole("ADMIN", true) };
}

export type AuthGuards = ReturnType<typeof createAuthGuards>;
