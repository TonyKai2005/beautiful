import type { FastifyInstance } from "fastify";
import { and, asc, eq } from "drizzle-orm";
import { sha256 as sha } from "../lib/security.ts";
import {
  diagnosticDraftSchema,
  type CreateLeadResponse,
  type DiagnosticDraft,
} from "../../shared/contracts.ts";
import { calculatePriority, generateBrief } from "../../shared/brief.ts";
import type { AppConfig } from "../config.ts";
import type { AppDatabase } from "../db/database.ts";
import {
  bookingSettings,
  emailOutbox,
  idempotencyRecords,
  leadCapabilities,
  leads,
  notificationRecipients,
  systemSettings,
  teams,
  users,
} from "../db/schema.ts";
import { nextDigestTime } from "../email/outbox.ts";
import { addMonths, newId, referenceCode, stableStringify } from "../lib/security.ts";
import { inspectWorkEmail, validationErrorBody } from "../lib/validation.ts";

interface LeadRouteOptions { db: AppDatabase; config: AppConfig }

async function resolveBookingUrl(
  db: AppDatabase,
  assignedUserId: string | null,
  teamId: string | null,
): Promise<string | null> {
  if (assignedUserId) {
    const [owner] = await db.select({ bookingUrl: users.bookingUrl }).from(users).where(eq(users.id, assignedUserId)).limit(1);
    if (owner?.bookingUrl) return owner.bookingUrl;
    const [setting] = await db.select({ url: bookingSettings.url }).from(bookingSettings).where(and(
      eq(bookingSettings.scope, "OWNER"), eq(bookingSettings.scopeKey, assignedUserId), eq(bookingSettings.enabled, true),
    )).limit(1);
    if (setting) return setting.url;
  }
  if (teamId) {
    const [team] = await db.select({ bookingUrl: teams.bookingUrl }).from(teams).where(eq(teams.id, teamId)).limit(1);
    if (team?.bookingUrl) return team.bookingUrl;
    const [setting] = await db.select({ url: bookingSettings.url }).from(bookingSettings).where(and(
      eq(bookingSettings.scope, "TEAM"), eq(bookingSettings.scopeKey, teamId), eq(bookingSettings.enabled, true),
    )).limit(1);
    if (setting) return setting.url;
  }
  const [global] = await db.select({ url: bookingSettings.url }).from(bookingSettings).where(and(
    eq(bookingSettings.scope, "GLOBAL"), eq(bookingSettings.scopeKey, "global"), eq(bookingSettings.enabled, true),
  )).limit(1);
  return global?.url ?? null;
}

async function assignOwner(db: AppDatabase, primarySystem: string): Promise<{ teamId: string | null; userId: string | null }> {
  const [team] = await db.select().from(teams).where(and(eq(teams.capability, primarySystem), eq(teams.active, true))).limit(1);
  if (!team) return { teamId: null, userId: null };
  const sales = await db.select({ id: users.id }).from(users).where(and(
    eq(users.teamId, team.id), eq(users.role, "SALES"), eq(users.active, true),
  )).orderBy(asc(users.createdAt));
  if (!sales.length) return { teamId: team.id, userId: null };
  const owner = sales[team.roundRobinCursor % sales.length]!;
  await db.update(teams).set({ roundRobinCursor: team.roundRobinCursor + 1, updatedAt: new Date() }).where(eq(teams.id, team.id));
  return { teamId: team.id, userId: owner.id };
}

function createEmailPayload(draft: DiagnosticDraft, response: CreateLeadResponse): Record<string, unknown> {
  return {
    leadId: response.leadId,
    referenceCode: response.referenceCode,
    company: draft.contact.company,
    contact: draft.contact.fullName,
    priority: response.priority,
    summary: draft.outcome.executiveSummary,
  };
}

export async function registerLeadRoutes(app: FastifyInstance, options: LeadRouteOptions): Promise<void> {
  const { db, config } = options;

  app.post("/api/v1/leads", {
    config: { rateLimit: { max: 12, timeWindow: "1 hour" } },
  }, async (request, reply) => {
    const idempotencyKey = String(request.headers["idempotency-key"] ?? "");
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(idempotencyKey)) {
      return reply.code(400).send({ error: "IDEMPOTENCY_KEY_REQUIRED", message: "A valid Idempotency-Key header is required." });
    }
    const parsed = diagnosticDraftSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(422).send(validationErrorBody(parsed.error));
    const draft = parsed.data;
    const emailInspection = inspectWorkEmail(draft.contact.workEmail);
    if (emailInspection.disposable) {
      return reply.code(422).send({
        error: "DISPOSABLE_EMAIL_REJECTED",
        message: "Use a permanent work email address.",
        issues: [{ path: "contact.workEmail", message: "Disposable email addresses cannot receive a project response." }],
        firstStep: 3,
      });
    }

    if (config.production) {
      const [privacy] = await db.select({ value: systemSettings.value }).from(systemSettings).where(eq(systemSettings.key, "privacy_notice_url")).limit(1);
      if (!privacy?.value) return reply.code(503).send({ error: "SUBMISSION_DISABLED", message: "Project intake is awaiting its published Privacy Notice." });
    }

    const requestHash = sha(stableStringify(draft));
    const [prior] = await db.select().from(idempotencyRecords).where(eq(idempotencyRecords.key, idempotencyKey)).limit(1);
    if (prior) {
      if (prior.requestHash !== requestHash) return reply.code(409).send({ error: "IDEMPOTENCY_CONFLICT", message: "This mission key was already used with different details." });
      return reply.code(200).send({ ...(prior.responseBody as unknown as CreateLeadResponse), replayed: true });
    }

    const now = new Date();
    const leadId = newId();
    const reference = referenceCode(now);
    const priority = calculatePriority(draft, now);
    const brief = generateBrief(draft, reference, now.toISOString());
    const warnings = emailInspection.personal ? ["A company email will help us route your request, but your mission was received."] : [];
    let response: CreateLeadResponse | undefined;

    try {
      response = await db.transaction(async (transaction) => {
        const transactionalDb = transaction as unknown as AppDatabase;
        const assignment = await assignOwner(transactionalDb, draft.primarySystem);
        const bookingUrl = await resolveBookingUrl(transactionalDb, assignment.userId, assignment.teamId);
        const committedResponse: CreateLeadResponse = {
          leadId,
          referenceCode: reference,
          receivedAt: now.toISOString(),
          priority,
          brief,
          bookingUrl,
          replayed: false,
          warnings,
        };
        await transaction.insert(leads).values({
          id: leadId,
          referenceCode: reference,
          idempotencyKey,
          status: "NEW",
          priority,
          primarySystem: draft.primarySystem,
          selectedSystems: draft.systems,
          assignedTeamId: assignment.teamId,
          assignedUserId: assignment.userId,
          contactName: draft.contact.fullName,
          contactTitle: draft.contact.jobTitle,
          company: draft.contact.company,
          workEmail: draft.contact.workEmail,
          phone: draft.contact.phone,
          country: draft.contact.country,
          objective: draft.outcome.objective,
          executiveSummary: draft.outcome.executiveSummary,
          initiativeStage: draft.currentState.initiativeStage,
          procurementState: draft.delivery.procurementState,
          timeline: draft.delivery.timeline,
          targetDate: draft.delivery.targetDate,
          payload: draft,
          brief,
          privacyVersion: draft.consent.privacyVersion,
          consentAt: now,
          receivedAt: now,
          lastActivityAt: now,
          retentionDueAt: addMonths(now, 12),
        });
        await transaction.insert(leadCapabilities).values(draft.systems.map((capability) => ({
          leadId, capability, primary: capability === draft.primarySystem,
        })));

        const recipients = await transaction.select({ email: notificationRecipients.email }).from(notificationRecipients)
          .where(eq(notificationRecipients.enabled, true));
        const emailPayload = createEmailPayload(draft, committedResponse);
        const outboxRows = recipients.flatMap(({ email }) => [
          ...(priority === "URGENT" || priority === "HIGH" ? [{
            id: newId(), kind: "LEAD_PRIORITY", recipient: email,
            subject: `[${priority}] ${reference} — ${draft.contact.company}`,
            payload: emailPayload, nextAttemptAt: now,
          }] : []),
          {
            id: newId(), kind: "DAILY_DIGEST_ITEM", recipient: email,
            subject: `Daily lead digest — ${reference}`,
            payload: emailPayload, nextAttemptAt: nextDigestTime(now),
          },
        ]);
        if (outboxRows.length) await transaction.insert(emailOutbox).values(outboxRows);
        await transaction.insert(idempotencyRecords).values({
          key: idempotencyKey,
          requestHash,
          responseStatus: 201,
          responseBody: committedResponse as unknown as Record<string, unknown>,
          expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        });
        return committedResponse;
      });
    } catch (error) {
      const [concurrent] = await db.select().from(idempotencyRecords).where(eq(idempotencyRecords.key, idempotencyKey)).limit(1);
      if (concurrent?.requestHash === requestHash) return reply.code(200).send({ ...(concurrent.responseBody as unknown as CreateLeadResponse), replayed: true });
      request.log.error({ error }, "lead transaction failed");
      return reply.code(503).send({ error: "TRANSMISSION_INTERRUPTED", message: "Mission Control could not store the project. Your answers are safe in this tab; retry with the same mission key." });
    }
    return reply.code(201).send(response!);
  });
}
