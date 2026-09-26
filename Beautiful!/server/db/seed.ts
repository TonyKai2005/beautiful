import { and, eq } from "drizzle-orm";
import { PLANET_IDS, PLANET_LABELS } from "../../shared/contracts.ts";
import type { AppConfig } from "../config.ts";
import { hashPassword, newId } from "../lib/security.ts";
import type { AppDatabase } from "./database.ts";
import { bookingSettings, systemSettings, teams, users } from "./schema.ts";

export async function seedDatabase(db: AppDatabase, appConfig: AppConfig): Promise<void> {
  for (const capability of PLANET_IDS) {
    await db.insert(teams).values({
      id: capability.toLowerCase(),
      name: PLANET_LABELS[capability],
      capability,
    }).onConflictDoNothing();
  }

  if (appConfig.privacyNoticeUrl) {
    await db.insert(systemSettings).values({ key: "privacy_notice_url", value: appConfig.privacyNoticeUrl })
      .onConflictDoNothing();
  }
  if (appConfig.bookingUrl) {
    await db.insert(bookingSettings).values({
      id: newId(), scope: "GLOBAL", scopeKey: "global", url: appConfig.bookingUrl, enabled: true,
    }).onConflictDoNothing();
  }

  if (!appConfig.production) {
    const [demo] = await db.select({ id: users.id }).from(users).where(eq(users.email, "admin@egain.local")).limit(1);
    if (!demo) {
      await db.insert(users).values({
        id: newId(),
        email: "admin@egain.local",
        name: "Local Administrator",
        passwordHash: await hashPassword("1234"),
        role: "ADMIN",
        mustChangePassword: true,
      });
    }
    return;
  }

  const bootstrapEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const bootstrapPassword = process.env.ADMIN_PASSWORD;
  if (!bootstrapEmail || !bootstrapPassword) return;
  if (bootstrapEmail === "admin@egain.local" || bootstrapPassword === "1234" || bootstrapPassword.length < 12) {
    throw new Error("Production bootstrap refused: configure a non-demo ADMIN_EMAIL and an ADMIN_PASSWORD of at least 12 characters.");
  }
  const [existing] = await db.select({ id: users.id }).from(users)
    .where(and(eq(users.email, bootstrapEmail), eq(users.role, "ADMIN"))).limit(1);
  if (!existing) {
    await db.insert(users).values({
      id: newId(),
      email: bootstrapEmail,
      name: "Mission Control Administrator",
      passwordHash: await hashPassword(bootstrapPassword),
      role: "ADMIN",
      mustChangePassword: false,
    });
  }
}
