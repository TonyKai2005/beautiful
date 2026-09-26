import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, asc, desc, eq, gt, ilike, isNull, or, type SQL } from "drizzle-orm";
import { z } from "zod";
import { LEAD_PRIORITIES, LEAD_STATUSES } from "../../shared/contracts.ts";
import type { AuthGuards } from "../auth.ts";
import type { AppConfig } from "../config.ts";
import type { AppDatabase } from "../db/database.ts";
import {
  auditEvents,
  bookingSettings,
  emailOutbox,
  invitations,
  leadCapabilities,
  leadNotes,
  leads,
  notificationRecipients,
  systemSettings,
  teams,
  users,
} from "../db/schema.ts";
import type { OutboxWorker } from "../email/outbox.ts";
import { newId, newOpaqueToken, sha256 } from "../lib/security.ts";

interface AdminRouteOptions {
  db: AppDatabase;
  config: AppConfig;
  guards: AuthGuards;
  outbox: OutboxWorker;
}

function visibilityCondition(request: FastifyRequest): SQL | undefined {
  const user = request.authUser!;
  if (user.role === "ADMIN") return undefined;
  if (!user.teamId) return eq(leads.assignedUserId, user.id);
  return or(
    eq(leads.assignedUserId, user.id),
    and(eq(leads.assignedTeamId, user.teamId), isNull(leads.assignedUserId)),
  );
}

async function findVisibleLead(db: AppDatabase, request: FastifyRequest, id: string) {
  const visibility = visibilityCondition(request);
  const [lead] = await db.select().from(leads).where(visibility ? and(eq(leads.id, id), visibility) : eq(leads.id, id)).limit(1);
  return lead;
}

async function audit(
  db: AppDatabase,
  request: FastifyRequest,
  entityType: string,
  entityId: string,
  action: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  await db.insert(auditEvents).values({
    id: newId(), actorId: request.authUser!.id, entityType, entityId, action, detail, ipAddress: request.ip,
  });
}

function cleanCsvCell(value: unknown): string {
  const text = String(value ?? "");
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export async function registerAdminRoutes(app: FastifyInstance, options: AdminRouteOptions): Promise<void> {
  const { db, config, guards, outbox } = options;

  app.get("/api/v1/admin/overview", { preHandler: guards.requireAuth }, async (request) => {
    const visibility = visibilityCondition(request);
    const rows = await db.select({
      status: leads.status,
      priority: leads.priority,
      receivedAt: leads.receivedAt,
      assignedUserId: leads.assignedUserId,
      retentionDueAt: leads.retentionDueAt,
      archivedAt: leads.archivedAt,
    }).from(leads).where(visibility).orderBy(desc(leads.receivedAt));
    const active = rows.filter((lead) => !lead.archivedAt);
    const byStatus = Object.fromEntries(LEAD_STATUSES.map((status) => [status, active.filter((lead) => lead.status === status).length]));
    const byPriority = Object.fromEntries(LEAD_PRIORITIES.map((priority) => [priority, active.filter((lead) => lead.priority === priority).length]));
    const recentThreshold = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const retentionThreshold = Date.now() + 14 * 24 * 60 * 60 * 1000;
    const failedOutbox = request.authUser!.role === "ADMIN"
      ? (await db.select({ id: emailOutbox.id }).from(emailOutbox).where(eq(emailOutbox.status, "FAILED"))).length
      : 0;
    return {
      totals: {
        active: active.length,
        newLast7Days: active.filter((lead) => lead.receivedAt.getTime() >= recentThreshold).length,
        unassigned: active.filter((lead) => !lead.assignedUserId).length,
        retentionDueSoon: active.filter((lead) => lead.retentionDueAt.getTime() <= retentionThreshold).length,
        failedOutbox,
      },
      byStatus,
      byPriority,
      recent: active.slice(0, 8),
    };
  });

  app.get("/api/v1/admin/leads", { preHandler: guards.requireAuth }, async (request, reply) => {
    const parsed = z.object({
      status: z.enum(LEAD_STATUSES).optional(),
      priority: z.enum(LEAD_PRIORITIES).optional(),
      search: z.string().trim().max(120).optional(),
      archived: z.enum(["true", "false"]).default("false"),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(30),
    }).safeParse(request.query);
    if (!parsed.success) return reply.code(422).send({ error: "INVALID_FILTERS", message: "Lead filters are invalid." });
    const filter = parsed.data;
    const conditions: SQL[] = [];
    const visibility = visibilityCondition(request);
    if (visibility) conditions.push(visibility);
    if (filter.status) conditions.push(eq(leads.status, filter.status));
    if (filter.priority) conditions.push(eq(leads.priority, filter.priority));
    conditions.push(filter.archived === "true" ? gt(leads.archivedAt, new Date(0)) : isNull(leads.archivedAt));
    if (filter.search) {
      const search = `%${filter.search}%`;
      conditions.push(or(ilike(leads.referenceCode, search), ilike(leads.company, search), ilike(leads.workEmail, search))!);
    }
    const all = await db.select({
      id: leads.id,
      referenceCode: leads.referenceCode,
      status: leads.status,
      priority: leads.priority,
      primarySystem: leads.primarySystem,
      selectedSystems: leads.selectedSystems,
      company: leads.company,
      contactName: leads.contactName,
      workEmail: leads.workEmail,
      timeline: leads.timeline,
      assignedTeamId: leads.assignedTeamId,
      assignedUserId: leads.assignedUserId,
      receivedAt: leads.receivedAt,
      lastActivityAt: leads.lastActivityAt,
      archivedAt: leads.archivedAt,
      version: leads.version,
    }).from(leads).where(and(...conditions)).orderBy(desc(leads.receivedAt));
    const start = (filter.page - 1) * filter.pageSize;
    return { items: all.slice(start, start + filter.pageSize), total: all.length, page: filter.page, pageSize: filter.pageSize };
  });

  app.get("/api/v1/admin/leads/export.csv", { preHandler: guards.requireAdmin }, async (_request, reply) => {
    const rows = await db.select().from(leads).where(isNull(leads.anonymizedAt)).orderBy(desc(leads.receivedAt));
    const header = ["Reference", "Status", "Priority", "Primary system", "Company", "Contact", "Work email", "Timeline", "Received"];
    const body = rows.map((lead) => [
      lead.referenceCode, lead.status, lead.priority, lead.primarySystem, lead.company, lead.contactName,
      lead.workEmail, lead.timeline, lead.receivedAt.toISOString(),
    ].map(cleanCsvCell).join(","));
    reply.header("content-type", "text/csv; charset=utf-8");
    reply.header("content-disposition", `attachment; filename="egain-leads-${new Date().toISOString().slice(0, 10)}.csv"`);
    return [header.map(cleanCsvCell).join(","), ...body].join("\n");
  });

  app.get("/api/v1/admin/leads/:id", { preHandler: guards.requireAuth }, async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const lead = await findVisibleLead(db, request, id);
    if (!lead) return reply.code(404).send({ error: "LEAD_NOT_FOUND", message: "Lead was not found in your queue." });
    const [capabilities, notes, owner] = await Promise.all([
      db.select().from(leadCapabilities).where(eq(leadCapabilities.leadId, id)),
      db.select({
        id: leadNotes.id, body: leadNotes.body, createdAt: leadNotes.createdAt,
        author: users.name, authorId: leadNotes.authorId,
      }).from(leadNotes).innerJoin(users, eq(users.id, leadNotes.authorId)).where(eq(leadNotes.leadId, id)).orderBy(desc(leadNotes.createdAt)),
      lead.assignedUserId ? db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(users.id, lead.assignedUserId)).limit(1) : Promise.resolve([]),
    ]);
    return { lead, capabilities, notes, owner: owner[0] ?? null };
  });

  app.post("/api/v1/admin/leads/:id/claim", { preHandler: guards.requireMutation }, async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const lead = await findVisibleLead(db, request, id);
    if (!lead || lead.archivedAt) return reply.code(404).send({ error: "LEAD_NOT_FOUND", message: "Lead is not available to claim." });
    if (lead.assignedUserId && lead.assignedUserId !== request.authUser!.id) return reply.code(409).send({ error: "ALREADY_ASSIGNED", message: "Another owner already claimed this lead." });
    if (request.authUser!.role === "SALES" && lead.assignedTeamId !== request.authUser!.teamId) return reply.code(403).send({ error: "FORBIDDEN", message: "Lead belongs to another team." });
    await db.update(leads).set({ assignedUserId: request.authUser!.id, lastActivityAt: new Date(), updatedAt: new Date(), version: lead.version + 1 }).where(and(eq(leads.id, id), eq(leads.version, lead.version)));
    await audit(db, request, "LEAD", id, "CLAIMED", { previousOwner: lead.assignedUserId });
    return { claimed: true, ownerId: request.authUser!.id };
  });

  app.patch("/api/v1/admin/leads/:id", { preHandler: guards.requireMutation }, async (request, reply) => {
    const parsed = z.object({
      version: z.number().int().positive(),
      status: z.enum(LEAD_STATUSES).optional(),
      priority: z.enum(LEAD_PRIORITIES).optional(),
      assignedUserId: z.string().uuid().nullable().optional(),
      archived: z.boolean().optional(),
    }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(422).send({ error: "INVALID_UPDATE", message: "Lead update is invalid." });
    const id = (request.params as { id: string }).id;
    const lead = await findVisibleLead(db, request, id);
    if (!lead) return reply.code(404).send({ error: "LEAD_NOT_FOUND", message: "Lead was not found." });
    if (lead.version !== parsed.data.version) return reply.code(409).send({ error: "VERSION_CONFLICT", message: "This lead changed in another session. Refresh before saving." });
    if (request.authUser!.role !== "ADMIN" && (parsed.data.priority || parsed.data.assignedUserId !== undefined || parsed.data.archived !== undefined)) {
      return reply.code(403).send({ error: "FORBIDDEN", message: "Sales users may update pipeline stage only." });
    }
    if (parsed.data.assignedUserId) {
      const [owner] = await db.select().from(users).where(and(eq(users.id, parsed.data.assignedUserId), eq(users.active, true))).limit(1);
      if (!owner || owner.role !== "SALES" || owner.teamId !== lead.assignedTeamId) {
        return reply.code(422).send({ error: "INVALID_ASSIGNEE", message: "Assign an active salesperson from the lead team." });
      }
    }
    const changes = {
      ...(parsed.data.status ? { status: parsed.data.status } : {}),
      ...(parsed.data.priority ? { priority: parsed.data.priority } : {}),
      ...(parsed.data.assignedUserId !== undefined ? { assignedUserId: parsed.data.assignedUserId } : {}),
      ...(parsed.data.archived !== undefined ? { archivedAt: parsed.data.archived ? new Date() : null } : {}),
      lastActivityAt: new Date(),
      updatedAt: new Date(),
      version: lead.version + 1,
    };
    const updated = await db.update(leads).set(changes).where(and(eq(leads.id, id), eq(leads.version, lead.version))).returning();
    if (!updated.length) return reply.code(409).send({ error: "VERSION_CONFLICT", message: "Lead changed before the update completed." });
    await audit(db, request, "LEAD", id, "UPDATED", { before: { status: lead.status, priority: lead.priority, assignedUserId: lead.assignedUserId, archived: Boolean(lead.archivedAt) }, after: parsed.data });
    return { lead: updated[0] };
  });

  app.post("/api/v1/admin/leads/:id/notes", { preHandler: guards.requireMutation }, async (request, reply) => {
    const parsed = z.object({ body: z.string().trim().min(2).max(4000) }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(422).send({ error: "INVALID_NOTE", message: "Note must contain 2–4,000 characters." });
    const id = (request.params as { id: string }).id;
    const lead = await findVisibleLead(db, request, id);
    if (!lead) return reply.code(404).send({ error: "LEAD_NOT_FOUND", message: "Lead was not found." });
    const note = { id: newId(), leadId: id, authorId: request.authUser!.id, body: parsed.data.body, createdAt: new Date() };
    await db.transaction(async (transaction) => {
      await transaction.insert(leadNotes).values(note);
      await transaction.update(leads).set({ lastActivityAt: new Date(), updatedAt: new Date(), version: lead.version + 1 }).where(eq(leads.id, id));
      await transaction.insert(auditEvents).values({ id: newId(), actorId: request.authUser!.id, entityType: "LEAD", entityId: id, action: "NOTE_ADDED", detail: {} });
    });
    return reply.code(201).send({ note: { ...note, author: request.authUser!.name } });
  });

  app.post("/api/v1/admin/leads/:id/merge", { preHandler: guards.requireAdminMutation }, async (request, reply) => {
    const parsed = z.object({ duplicateReference: z.string().trim().min(6).max(80) }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(422).send({ error: "INVALID_MERGE", message: "Enter the duplicate lead reference." });
    const survivorId = (request.params as { id: string }).id;
    const [survivor] = await db.select().from(leads).where(eq(leads.id, survivorId)).limit(1);
    const [duplicate] = await db.select().from(leads).where(eq(leads.referenceCode, parsed.data.duplicateReference.toUpperCase())).limit(1);
    if (!survivor || !duplicate) return reply.code(404).send({ error: "LEAD_NOT_FOUND", message: "Surviving or duplicate lead was not found." });
    if (survivor.id === duplicate.id) return reply.code(422).send({ error: "INVALID_MERGE", message: "A lead cannot be merged into itself." });
    if (survivor.anonymizedAt || duplicate.anonymizedAt || duplicate.mergedIntoLeadId) {
      return reply.code(409).send({ error: "MERGE_CONFLICT", message: "Anonymised or previously merged leads cannot be merged." });
    }
    const combinedSystems = [...new Set([...survivor.selectedSystems, ...duplicate.selectedSystems])];
    await db.transaction(async (transaction) => {
      const duplicateCapabilities = await transaction.select().from(leadCapabilities).where(eq(leadCapabilities.leadId, duplicate.id));
      if (duplicateCapabilities.length) {
        await transaction.insert(leadCapabilities).values(duplicateCapabilities.map((capability) => ({
          leadId: survivor.id,
          capability: capability.capability,
          primary: capability.capability === survivor.primarySystem,
        }))).onConflictDoNothing();
      }
      await transaction.update(leadNotes).set({ leadId: survivor.id }).where(eq(leadNotes.leadId, duplicate.id));
      await transaction.insert(leadNotes).values({
        id: newId(), leadId: survivor.id, authorId: request.authUser!.id,
        body: `Merged duplicate ${duplicate.referenceCode} into this lead.`,
      });
      await transaction.update(leads).set({
        selectedSystems: combinedSystems,
        lastActivityAt: new Date(),
        updatedAt: new Date(),
        version: survivor.version + 1,
      }).where(eq(leads.id, survivor.id));
      await transaction.update(leads).set({
        archivedAt: new Date(),
        mergedIntoLeadId: survivor.id,
        lastActivityAt: new Date(),
        updatedAt: new Date(),
        version: duplicate.version + 1,
      }).where(eq(leads.id, duplicate.id));
      await transaction.insert(auditEvents).values([
        { id: newId(), actorId: request.authUser!.id, entityType: "LEAD", entityId: survivor.id, action: "DUPLICATE_MERGED", detail: { duplicateId: duplicate.id, duplicateReference: duplicate.referenceCode } },
        { id: newId(), actorId: request.authUser!.id, entityType: "LEAD", entityId: duplicate.id, action: "MERGED_INTO", detail: { survivorId: survivor.id, survivorReference: survivor.referenceCode } },
      ]);
    });
    return { merged: true, survivorId: survivor.id, duplicateId: duplicate.id };
  });

  app.get("/api/v1/admin/settings/notifications", { preHandler: guards.requireAdmin }, async () => ({
    recipients: await db.select().from(notificationRecipients).orderBy(asc(notificationRecipients.createdAt)),
    delivery: { configured: Boolean(config.smtp.host), mode: outbox.simulated ? "LOCAL_SIMULATION" : "SMTP" },
  }));

  app.post("/api/v1/admin/settings/notifications", { preHandler: guards.requireAdminMutation }, async (request, reply) => {
    const parsed = z.object({ email: z.string().trim().toLowerCase().email().max(254), label: z.string().trim().min(1).max(80).default("Lead notifications") }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(422).send({ error: "INVALID_RECIPIENT", message: "Enter a valid notification email." });
    const [duplicate] = await db.select({ id: notificationRecipients.id }).from(notificationRecipients).where(eq(notificationRecipients.email, parsed.data.email)).limit(1);
    if (duplicate) return reply.code(409).send({ error: "RECIPIENT_EXISTS", message: "This email is already in the notification list." });
    const [recipient] = await db.insert(notificationRecipients).values({ id: newId(), ...parsed.data, createdBy: request.authUser!.id }).returning();
    await audit(db, request, "NOTIFICATION_RECIPIENT", recipient!.id, "CREATED", { email: recipient!.email });
    return reply.code(201).send({ recipient });
  });

  app.patch("/api/v1/admin/settings/notifications/:id", { preHandler: guards.requireAdminMutation }, async (request, reply) => {
    const parsed = z.object({ email: z.string().trim().toLowerCase().email().max(254).optional(), label: z.string().trim().min(1).max(80).optional(), enabled: z.boolean().optional() }).strict().safeParse(request.body);
    if (!parsed.success || !Object.keys(parsed.data).length) return reply.code(422).send({ error: "INVALID_RECIPIENT", message: "Notification recipient update is invalid." });
    const id = (request.params as { id: string }).id;
    const [recipient] = await db.update(notificationRecipients).set({ ...parsed.data, updatedAt: new Date() }).where(eq(notificationRecipients.id, id)).returning();
    if (!recipient) return reply.code(404).send({ error: "RECIPIENT_NOT_FOUND", message: "Notification recipient was not found." });
    await audit(db, request, "NOTIFICATION_RECIPIENT", id, "UPDATED", parsed.data);
    return { recipient };
  });

  app.delete("/api/v1/admin/settings/notifications/:id", { preHandler: guards.requireAdminMutation }, async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const [recipient] = await db.delete(notificationRecipients).where(eq(notificationRecipients.id, id)).returning();
    if (!recipient) return reply.code(404).send({ error: "RECIPIENT_NOT_FOUND", message: "Notification recipient was not found." });
    await audit(db, request, "NOTIFICATION_RECIPIENT", id, "REMOVED", { email: recipient.email });
    return reply.code(204).send();
  });

  app.post("/api/v1/admin/settings/notifications/test", { preHandler: guards.requireAdminMutation }, async (request, reply) => {
    const parsed = z.object({ email: z.string().trim().toLowerCase().email() }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(422).send({ error: "INVALID_RECIPIENT", message: "Choose a valid test recipient." });
    const id = newId();
    await db.insert(emailOutbox).values({
      id, kind: "TEST", recipient: parsed.data.email, subject: "e Gain Mission Control — test notification",
      payload: { referenceCode: "TEST-SIGNAL", company: "Mission Control", summary: "Notification routing is operational." }, nextAttemptAt: new Date(),
    });
    const delivery = await outbox.processBatch();
    const [row] = await db.select({ status: emailOutbox.status, lastError: emailOutbox.lastError }).from(emailOutbox).where(eq(emailOutbox.id, id)).limit(1);
    await audit(db, request, "EMAIL_OUTBOX", id, "TEST_SENT", { email: parsed.data.email, simulated: delivery.simulated, status: row?.status });
    return { queued: true, status: row?.status ?? "PENDING", simulated: delivery.simulated, error: row?.lastError ?? null };
  });

  app.get("/api/v1/admin/settings/booking", { preHandler: guards.requireAdmin }, async () => {
    const [settings, privacy] = await Promise.all([
      db.select().from(bookingSettings).orderBy(asc(bookingSettings.scope), asc(bookingSettings.scopeKey)),
      db.select({ value: systemSettings.value }).from(systemSettings).where(eq(systemSettings.key, "privacy_notice_url")).limit(1),
    ]);
    return { settings, privacyNoticeUrl: privacy[0]?.value ?? "" };
  });

  app.put("/api/v1/admin/settings/booking", { preHandler: guards.requireAdminMutation }, async (request, reply) => {
    const parsed = z.object({
      scope: z.enum(["GLOBAL", "TEAM", "OWNER"]),
      scopeKey: z.string().trim().min(1).max(80),
      url: z.string().url().refine((url) => url.startsWith("https://") || (!config.production && url.startsWith("http://")), "Use an HTTPS booking URL."),
      enabled: z.boolean().default(true),
    }).strict().safeParse(request.body);
    if (!parsed.success || (parsed.data.scope === "GLOBAL" && parsed.data.scopeKey !== "global")) return reply.code(422).send({ error: "INVALID_BOOKING_URL", message: "Booking setting is invalid." });
    const [existing] = await db.select({ id: bookingSettings.id }).from(bookingSettings).where(and(eq(bookingSettings.scope, parsed.data.scope), eq(bookingSettings.scopeKey, parsed.data.scopeKey))).limit(1);
    const id = existing?.id ?? newId();
    const [setting] = await db.insert(bookingSettings).values({ id, ...parsed.data, updatedBy: request.authUser!.id }).onConflictDoUpdate({
      target: [bookingSettings.scope, bookingSettings.scopeKey],
      set: { url: parsed.data.url, enabled: parsed.data.enabled, updatedBy: request.authUser!.id, updatedAt: new Date() },
    }).returning();
    await audit(db, request, "BOOKING_SETTING", id, existing ? "UPDATED" : "CREATED", { scope: parsed.data.scope, scopeKey: parsed.data.scopeKey });
    return { setting };
  });

  app.put("/api/v1/admin/settings/privacy", { preHandler: guards.requireAdminMutation }, async (request, reply) => {
    const parsed = z.object({ url: z.string().url().refine((url) => url.startsWith("https://") || (!config.production && url.startsWith("http://"))) }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(422).send({ error: "INVALID_PRIVACY_URL", message: "Use the published HTTPS Privacy Notice URL." });
    await db.insert(systemSettings).values({ key: "privacy_notice_url", value: parsed.data.url, updatedBy: request.authUser!.id }).onConflictDoUpdate({
      target: systemSettings.key,
      set: { value: parsed.data.url, updatedBy: request.authUser!.id, updatedAt: new Date() },
    });
    await audit(db, request, "SYSTEM_SETTING", "privacy_notice_url", "UPDATED", {});
    return { privacyNoticeUrl: parsed.data.url };
  });

  app.get("/api/v1/admin/users", { preHandler: guards.requireAdmin }, async () => ({
    users: await db.select({
      id: users.id, email: users.email, name: users.name, role: users.role, teamId: users.teamId,
      active: users.active, mustChangePassword: users.mustChangePassword, lastLoginAt: users.lastLoginAt, createdAt: users.createdAt,
    }).from(users).orderBy(asc(users.name)),
    teams: await db.select().from(teams).orderBy(asc(teams.name)),
    invitations: await db.select({ id: invitations.id, email: invitations.email, role: invitations.role, teamId: invitations.teamId, expiresAt: invitations.expiresAt, acceptedAt: invitations.acceptedAt, createdAt: invitations.createdAt }).from(invitations).orderBy(desc(invitations.createdAt)),
  }));

  app.post("/api/v1/admin/users/invitations", { preHandler: guards.requireAdminMutation }, async (request, reply) => {
    const parsed = z.object({ email: z.string().trim().toLowerCase().email(), role: z.enum(["ADMIN", "SALES"]), teamId: z.string().nullable().default(null) }).strict().safeParse(request.body);
    if (!parsed.success || (parsed.data.role === "SALES" && !parsed.data.teamId)) return reply.code(422).send({ error: "INVALID_INVITATION", message: "Sales invitations require a team." });
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, parsed.data.email)).limit(1);
    if (existing) return reply.code(409).send({ error: "ACCOUNT_EXISTS", message: "An account already exists for this email." });
    if (parsed.data.teamId) {
      const [team] = await db.select({ id: teams.id }).from(teams).where(eq(teams.id, parsed.data.teamId)).limit(1);
      if (!team) return reply.code(422).send({ error: "INVALID_TEAM", message: "Selected team does not exist." });
    }
    const token = newOpaqueToken();
    const invitation = { id: newId(), ...parsed.data, tokenHash: sha256(token), invitedBy: request.authUser!.id, expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000) };
    await db.transaction(async (transaction) => {
      await transaction.insert(invitations).values(invitation);
      await transaction.insert(emailOutbox).values({
        id: newId(), kind: "INVITATION", recipient: parsed.data.email, subject: "You are invited to e Gain Mission Control",
        payload: { referenceCode: "MISSION-CONTROL-INVITE", company: "e Gain Technologies", summary: `${config.publicOrigin}/admin/?invite=${token}` }, nextAttemptAt: new Date(),
      });
    });
    await audit(db, request, "INVITATION", invitation.id, "CREATED", { email: parsed.data.email, role: parsed.data.role, teamId: parsed.data.teamId });
    return reply.code(201).send({ invitation: { id: invitation.id, email: invitation.email, role: invitation.role, teamId: invitation.teamId, expiresAt: invitation.expiresAt }, ...(config.production ? {} : { localInviteUrl: `${config.publicOrigin}/admin/?invite=${token}` }) });
  });

  app.patch("/api/v1/admin/users/:id", { preHandler: guards.requireAdminMutation }, async (request, reply) => {
    const parsed = z.object({ active: z.boolean().optional(), teamId: z.string().nullable().optional(), bookingUrl: z.string().url().nullable().optional() }).strict().safeParse(request.body);
    if (!parsed.success || !Object.keys(parsed.data).length) return reply.code(422).send({ error: "INVALID_USER_UPDATE", message: "User update is invalid." });
    const id = (request.params as { id: string }).id;
    if (id === request.authUser!.id && parsed.data.active === false) return reply.code(422).send({ error: "SELF_DEACTIVATION", message: "You cannot deactivate your own account." });
    const [user] = await db.update(users).set({ ...parsed.data, updatedAt: new Date() }).where(eq(users.id, id)).returning();
    if (!user) return reply.code(404).send({ error: "USER_NOT_FOUND", message: "User was not found." });
    await audit(db, request, "USER", id, "UPDATED", parsed.data);
    return { user: { id: user.id, name: user.name, email: user.email, role: user.role, teamId: user.teamId, active: user.active, bookingUrl: user.bookingUrl } };
  });

  app.get("/api/v1/admin/audit", { preHandler: guards.requireAdmin }, async (request, reply) => {
    const parsed = z.object({ limit: z.coerce.number().int().min(1).max(200).default(100) }).safeParse(request.query);
    if (!parsed.success) return reply.code(422).send({ error: "INVALID_LIMIT", message: "Audit limit is invalid." });
    const events = await db.select({
      id: auditEvents.id, entityType: auditEvents.entityType, entityId: auditEvents.entityId,
      action: auditEvents.action, detail: auditEvents.detail, ipAddress: auditEvents.ipAddress,
      createdAt: auditEvents.createdAt, actorId: auditEvents.actorId, actorName: users.name,
    }).from(auditEvents).leftJoin(users, eq(users.id, auditEvents.actorId)).orderBy(desc(auditEvents.createdAt)).limit(parsed.data.limit);
    return { events };
  });

  app.post("/api/v1/admin/retention/:id/extend", { preHandler: guards.requireAdminMutation }, async (request, reply) => {
    const parsed = z.object({ months: z.number().int().min(1).max(12), reason: z.string().trim().min(10).max(500) }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(422).send({ error: "INVALID_EXTENSION", message: "Provide a reason and an extension of 1–12 months." });
    const id = (request.params as { id: string }).id;
    const [lead] = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
    if (!lead) return reply.code(404).send({ error: "LEAD_NOT_FOUND", message: "Lead was not found." });
    const dueAt = new Date(lead.retentionDueAt);
    dueAt.setUTCMonth(dueAt.getUTCMonth() + parsed.data.months);
    await db.update(leads).set({ retentionDueAt: dueAt, updatedAt: new Date(), version: lead.version + 1 }).where(eq(leads.id, id));
    await audit(db, request, "LEAD", id, "RETENTION_EXTENDED", { months: parsed.data.months, reason: parsed.data.reason, dueAt: dueAt.toISOString() });
    return { retentionDueAt: dueAt };
  });
}
