import nodemailer, { type Transporter } from "nodemailer";
import { and, asc, eq, inArray, lte } from "drizzle-orm";
import type { AppConfig } from "../config.ts";
import type { AppDatabase } from "../db/database.ts";
import { emailOutbox } from "../db/schema.ts";

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;",
  }[character]!));
}

function createTransport(appConfig: AppConfig): { transporter: Transporter; simulated: boolean } {
  if (!appConfig.smtp.host) return { transporter: nodemailer.createTransport({ jsonTransport: true }), simulated: true };
  return {
    transporter: nodemailer.createTransport({
      host: appConfig.smtp.host,
      port: appConfig.smtp.port,
      secure: appConfig.smtp.secure,
      auth: appConfig.smtp.user ? { user: appConfig.smtp.user, pass: appConfig.smtp.password } : undefined,
    }),
    simulated: false,
  };
}

export function nextDigestTime(now = new Date()): Date {
  const next = new Date(now);
  next.setUTCHours(8, 0, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

export function createOutboxWorker(db: AppDatabase, appConfig: AppConfig) {
  const { transporter, simulated } = createTransport(appConfig);
  let timer: NodeJS.Timeout | undefined;
  let processing = false;

  async function deliverSingle(row: typeof emailOutbox.$inferSelect): Promise<void> {
    if (!row.recipient) throw new Error("Email recipient is missing.");
    const reference = escapeHtml(row.payload.referenceCode ?? "Mission Control");
    const company = escapeHtml(row.payload.company ?? "e Gain");
    const summary = escapeHtml(row.payload.summary ?? "Notification test");
    await transporter.sendMail({
      from: appConfig.smtp.from,
      to: row.recipient,
      subject: row.subject,
      text: `${reference}\n${company}\n${summary}`,
      html: `<div style="font:14px/1.5 Arial,sans-serif;color:#101214"><p style="color:#f05a28;font-weight:700">e GAIN / MISSION CONTROL</p><h2>${reference}</h2><p><strong>${company}</strong></p><p>${summary}</p></div>`,
    });
  }

  async function processBatch(): Promise<{ processed: number; simulated: boolean }> {
    if (processing) return { processed: 0, simulated };
    processing = true;
    let processed = 0;
    try {
      const due = await db.select().from(emailOutbox).where(and(
        eq(emailOutbox.status, "PENDING"),
        lte(emailOutbox.nextAttemptAt, new Date()),
      )).orderBy(asc(emailOutbox.createdAt)).limit(50);

      const digestRows = due.filter((row) => row.kind === "DAILY_DIGEST_ITEM" && row.recipient);
      const digestByRecipient = new Map<string, typeof digestRows>();
      for (const row of digestRows) {
        const recipient = row.recipient!;
        digestByRecipient.set(recipient, [...(digestByRecipient.get(recipient) ?? []), row]);
      }
      for (const [recipient, rows] of digestByRecipient) {
        try {
          const items = rows.map((row) => `${row.payload.referenceCode ?? "Lead"} — ${row.payload.company ?? "Unknown company"}`).join("\n");
          await transporter.sendMail({
            from: appConfig.smtp.from,
            to: recipient,
            subject: `e Gain daily lead digest — ${rows.length} new`,
            text: `e GAIN / MISSION CONTROL\n\n${items}`,
            html: `<div style="font:14px/1.5 Arial,sans-serif;color:#101214"><p style="color:#f05a28;font-weight:700">e GAIN / DAILY LEAD DIGEST</p><h2>${rows.length} new lead${rows.length === 1 ? "" : "s"}</h2><ul>${rows.map((row) => `<li><strong>${escapeHtml(row.payload.referenceCode)}</strong> — ${escapeHtml(row.payload.company)}</li>`).join("")}</ul></div>`,
          });
          await db.update(emailOutbox).set({ status: "SENT", sentAt: new Date(), attempts: 1 }).where(inArray(emailOutbox.id, rows.map((row) => row.id)));
          processed += rows.length;
        } catch (error) {
          const message = error instanceof Error ? error.message.slice(0, 500) : "Email delivery failed";
          await db.update(emailOutbox).set({ status: "FAILED", lastError: message, attempts: 1 }).where(inArray(emailOutbox.id, rows.map((row) => row.id)));
        }
      }

      for (const row of due.filter((candidate) => candidate.kind !== "DAILY_DIGEST_ITEM")) {
        try {
          await deliverSingle(row);
          await db.update(emailOutbox).set({ status: "SENT", sentAt: new Date(), attempts: row.attempts + 1 }).where(eq(emailOutbox.id, row.id));
        } catch (error) {
          const attempts = row.attempts + 1;
          const message = error instanceof Error ? error.message.slice(0, 500) : "Email delivery failed";
          await db.update(emailOutbox).set({
            status: attempts >= 4 ? "FAILED" : "PENDING",
            attempts,
            lastError: message,
            nextAttemptAt: new Date(Date.now() + Math.min(60, 2 ** attempts) * 60_000),
          }).where(eq(emailOutbox.id, row.id));
        }
        processed += 1;
      }
    } finally {
      processing = false;
    }
    return { processed, simulated };
  }

  function start(): void {
    if (timer) return;
    timer = setInterval(() => void processBatch(), 15_000);
    timer.unref();
    setTimeout(() => void processBatch(), 1_500).unref();
  }

  function stop(): void {
    if (timer) clearInterval(timer);
    timer = undefined;
  }

  return { processBatch, start, stop, simulated };
}

export type OutboxWorker = ReturnType<typeof createOutboxWorker>;
