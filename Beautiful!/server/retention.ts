import { and, eq, isNull, lte, ne } from "drizzle-orm";
import type { AppDatabase } from "./db/database.ts";
import { auditEvents, emailOutbox, idempotencyRecords, leadNotes, leads } from "./db/schema.ts";
import { newId, sha256 } from "./lib/security.ts";

export function createRetentionWorker(db: AppDatabase) {
  let timer: NodeJS.Timeout | undefined;
  let running = false;

  async function sweep(now = new Date()): Promise<number> {
    if (running) return 0;
    running = true;
    let anonymized = 0;
    try {
      const due = await db.select().from(leads).where(and(
        lte(leads.retentionDueAt, now),
        ne(leads.status, "WON"),
        isNull(leads.anonymizedAt),
      ));
      for (const lead of due) {
        const anonymousAddress = `anonymous-${sha256(lead.workEmail).slice(0, 14)}@invalid.local`;
        const aggregatePayload = {
          anonymized: true,
          systems: lead.selectedSystems,
          primarySystem: lead.primarySystem,
          status: lead.status,
          priority: lead.priority,
          timeline: lead.timeline,
        };
        const aggregateBrief = {
          anonymized: true,
          version: "RULES_V1",
          referenceCode: lead.referenceCode,
          systems: lead.selectedSystems,
          primarySystem: lead.primarySystem,
          timeline: lead.timeline,
        };
        await db.transaction(async (transaction) => {
          await transaction.delete(leadNotes).where(eq(leadNotes.leadId, lead.id));
          await transaction.delete(idempotencyRecords).where(eq(idempotencyRecords.key, lead.idempotencyKey));
          const outboxRows = await transaction.select({ id: emailOutbox.id, payload: emailOutbox.payload }).from(emailOutbox);
          for (const row of outboxRows.filter((entry) => entry.payload.leadId === lead.id)) {
            await transaction.update(emailOutbox).set({ payload: { leadId: lead.id, referenceCode: lead.referenceCode, anonymized: true } }).where(eq(emailOutbox.id, row.id));
          }
          await transaction.update(leads).set({
            contactName: "ANONYMISED",
            contactTitle: "",
            company: "ANONYMISED",
            workEmail: anonymousAddress,
            phone: "",
            country: "",
            objective: "ANONYMISED",
            executiveSummary: "",
            payload: aggregatePayload as unknown as typeof lead.payload,
            brief: aggregateBrief as unknown as typeof lead.brief,
            privacyVersion: "ANONYMISED",
            archivedAt: lead.archivedAt ?? now,
            anonymizedAt: now,
            updatedAt: now,
            version: lead.version + 1,
          }).where(eq(leads.id, lead.id));
          await transaction.insert(auditEvents).values({
            id: newId(), entityType: "LEAD", entityId: lead.id, action: "RETENTION_ANONYMISED",
            detail: { referenceCode: lead.referenceCode, status: lead.status, priority: lead.priority },
          });
        });
        anonymized += 1;
      }
    } finally {
      running = false;
    }
    return anonymized;
  }

  function start(): void {
    if (timer) return;
    timer = setInterval(() => void sweep(), 24 * 60 * 60 * 1000);
    timer.unref();
    setTimeout(() => void sweep(), 10_000).unref();
  }
  function stop(): void { if (timer) clearInterval(timer); timer = undefined; }
  return { sweep, start, stop };
}
