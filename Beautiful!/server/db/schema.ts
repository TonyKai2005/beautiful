import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { DiagnosticDraft, LeadPriority, LeadStatus, StructuredBrief, UserRole } from "../../shared/contracts.ts";

const auditColumns = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const teams = pgTable("teams", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  capability: text("capability").notNull().unique(),
  bookingUrl: text("booking_url"),
  roundRobinCursor: integer("round_robin_cursor").notNull().default(0),
  active: boolean("active").notNull().default(true),
  ...auditColumns,
});

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").$type<UserRole>().notNull(),
  teamId: text("team_id").references(() => teams.id),
  bookingUrl: text("booking_url"),
  active: boolean("active").notNull().default(true),
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  ...auditColumns,
}, (table) => [uniqueIndex("users_email_lower_unique").on(table.email)]);

export const invitations = pgTable("invitations", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  role: text("role").$type<UserRole>().notNull(),
  teamId: text("team_id").references(() => teams.id),
  tokenHash: text("token_hash").notNull().unique(),
  invitedBy: text("invited_by").notNull().references(() => users.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  csrfToken: text("csrf_token").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
});

export const leads = pgTable("leads", {
  id: text("id").primaryKey(),
  referenceCode: text("reference_code").notNull().unique(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  status: text("status").$type<LeadStatus>().notNull().default("NEW"),
  priority: text("priority").$type<LeadPriority>().notNull().default("NORMAL"),
  primarySystem: text("primary_system").notNull(),
  selectedSystems: jsonb("selected_systems").$type<string[]>().notNull(),
  assignedTeamId: text("assigned_team_id").references(() => teams.id),
  assignedUserId: text("assigned_user_id").references(() => users.id),
  contactName: text("contact_name").notNull(),
  contactTitle: text("contact_title").notNull(),
  company: text("company").notNull(),
  workEmail: text("work_email").notNull(),
  phone: text("phone").notNull().default(""),
  country: text("country").notNull().default(""),
  objective: text("objective").notNull(),
  executiveSummary: text("executive_summary").notNull(),
  initiativeStage: text("initiative_stage").notNull(),
  procurementState: text("procurement_state").notNull(),
  timeline: text("timeline").notNull(),
  targetDate: text("target_date"),
  payload: jsonb("payload").$type<DiagnosticDraft>().notNull(),
  brief: jsonb("brief").$type<StructuredBrief>().notNull(),
  privacyVersion: text("privacy_version").notNull(),
  consentAt: timestamp("consent_at", { withTimezone: true }).notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
  lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull(),
  retentionDueAt: timestamp("retention_due_at", { withTimezone: true }).notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  anonymizedAt: timestamp("anonymized_at", { withTimezone: true }),
  mergedIntoLeadId: text("merged_into_lead_id"),
  version: integer("version").notNull().default(1),
  ...auditColumns,
}, (table) => [
  index("leads_pipeline_idx").on(table.status, table.priority, table.receivedAt),
  index("leads_assignment_idx").on(table.assignedTeamId, table.assignedUserId),
  index("leads_retention_idx").on(table.retentionDueAt),
]);

export const leadCapabilities = pgTable("lead_capabilities", {
  leadId: text("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  capability: text("capability").notNull(),
  primary: boolean("primary").notNull().default(false),
}, (table) => [primaryKey({ columns: [table.leadId, table.capability] })]);

export const leadNotes = pgTable("lead_notes", {
  id: text("id").primaryKey(),
  leadId: text("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  authorId: text("author_id").notNull().references(() => users.id),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditEvents = pgTable("audit_events", {
  id: text("id").primaryKey(),
  actorId: text("actor_id").references(() => users.id),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  action: text("action").notNull(),
  detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("audit_entity_idx").on(table.entityType, table.entityId, table.createdAt)]);

export const emailOutbox = pgTable("email_outbox", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  recipient: text("recipient"),
  subject: text("subject").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  status: text("status").notNull().default("PENDING"),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("outbox_due_idx").on(table.status, table.nextAttemptAt)]);

export const notificationRecipients = pgTable("notification_recipients", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  label: text("label").notNull().default("Lead notifications"),
  enabled: boolean("enabled").notNull().default(true),
  createdBy: text("created_by").notNull().references(() => users.id),
  ...auditColumns,
});

export const bookingSettings = pgTable("booking_settings", {
  id: text("id").primaryKey(),
  scope: text("scope").notNull(),
  scopeKey: text("scope_key").notNull(),
  url: text("url").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  updatedBy: text("updated_by").references(() => users.id),
  ...auditColumns,
}, (table) => [uniqueIndex("booking_scope_unique").on(table.scope, table.scopeKey)]);

export const systemSettings = pgTable("system_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedBy: text("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const idempotencyRecords = pgTable("idempotency_records", {
  key: text("key").primaryKey(),
  requestHash: text("request_hash").notNull(),
  responseStatus: integer("response_status").notNull(),
  responseBody: jsonb("response_body").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export type UserRow = typeof users.$inferSelect;
export type LeadRow = typeof leads.$inferSelect;
