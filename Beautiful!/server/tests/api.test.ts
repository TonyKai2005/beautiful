import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.ts";
import { diagnosticDraftSchema, type DiagnosticDraft } from "../../shared/contracts.ts";
import { validationErrorBody } from "../lib/validation.ts";

const ORIGIN = "http://localhost:4174";
let app: FastifyInstance;

before(async () => {
  app = await buildApp({
    databaseUrl: "memory://",
    logger: false,
    startWorker: false,
    config: { production: false, nodeEnvironment: "test", publicOrigin: ORIGIN },
  });
  await app.ready();
});

after(async () => {
  await app.close();
});

function sampleLead(overrides: Partial<DiagnosticDraft> = {}): DiagnosticDraft {
  return {
    systems: ["BUILD", "DEPLOY"],
    primarySystem: "BUILD",
    outcome: {
      objective: "Modernise a critical customer platform",
      expectedOutcomes: ["Faster release cadence", "Improved resilience"],
      executiveSummary: "We need to replace a critical customer platform while preserving service continuity and measurable release control.",
    },
    currentState: {
      initiativeStage: "Delivery in progress",
      deliveryContext: "Modernise",
      impactScope: "Enterprise platform",
      landscape: "A live monolithic application serves several business units and relies on manual release and recovery processes.",
      dependencies: "Identity, payments and the existing reporting estate.",
    },
    technicalSignals: {
      domains: ["Web applications", "Platform engineering"],
      deploymentMode: "Hybrid cloud",
      regulatedData: "YES",
      complianceFrameworks: ["ISO 27001"],
      systemAnswers: { BUILD: "TypeScript and Java services", DEPLOY: "NOT_SURE" },
    },
    delivery: {
      engagementModel: "Delivery partner",
      procurementState: "Approved",
      timeline: "0–4 weeks",
      budget: { currency: "GBP", band: "150–500k" },
    },
    contact: {
      fullName: "Morgan Reed",
      jobTitle: "Technology Director",
      company: "Northstar Systems",
      workEmail: "morgan@northstar.example",
      phone: "+44 20 7946 0100",
      country: "United Kingdom",
    },
    consent: { contact: true, privacyVersion: "2026-07-18" },
    ...overrides,
  };
}

async function login(email = "admin@egain.local", password = "1234") {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    headers: { origin: ORIGIN },
    payload: { email, password },
  });
  assert.equal(response.statusCode, 200, response.body);
  const body = response.json();
  const cookie = response.headers["set-cookie"];
  assert.ok(cookie);
  return { cookie: String(cookie).split(";")[0]!, csrf: body.csrfToken as string, user: body.user };
}

test("health reports the local PGlite acceptance path", async () => {
  const response = await app.inject({ method: "GET", url: "/api/v1/health" });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().database, "pglite");
});

test("development accepts the equivalent 127.0.0.1 loopback preview origin", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    headers: { origin: "http://127.0.0.1:4174" },
    payload: { email: "admin@egain.local", password: "1234" },
  });
  assert.equal(response.statusCode, 200, response.body);
});

test("development accepts the Codex terminal.local preview origin", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    headers: { origin: "http://terminal.local:4174" },
    payload: { email: "admin@egain.local", password: "1234" },
  });
  assert.equal(response.statusCode, 200, response.body);
});

test("validation errors route every draft root to the three-step Mission Deck", () => {
  const valid = sampleLead();
  const cases: Array<{ label: string; payload: unknown; firstStep: number }> = [
    { label: "systems", payload: { ...valid, systems: [] }, firstStep: 1 },
    { label: "primary system", payload: { ...valid, primarySystem: "UNKNOWN" }, firstStep: 1 },
    {
      label: "outcome",
      payload: { ...valid, outcome: { ...valid.outcome, executiveSummary: "Too short" } },
      firstStep: 1,
    },
    {
      label: "current state",
      payload: { ...valid, currentState: { ...valid.currentState, landscape: "Too short" } },
      firstStep: 2,
    },
    {
      label: "technical signals",
      payload: { ...valid, technicalSignals: { ...valid.technicalSignals, deploymentMode: "" } },
      firstStep: 2,
    },
    {
      label: "delivery",
      payload: { ...valid, delivery: { ...valid.delivery, timeline: "" } },
      firstStep: 2,
    },
    {
      label: "contact",
      payload: { ...valid, contact: { ...valid.contact, workEmail: "not-an-email" } },
      firstStep: 3,
    },
    {
      label: "consent",
      payload: { ...valid, consent: { ...valid.consent, contact: false } },
      firstStep: 3,
    },
  ];

  for (const validationCase of cases) {
    const parsed = diagnosticDraftSchema.safeParse(validationCase.payload);
    assert.equal(parsed.success, false, `${validationCase.label} should fail validation`);
    if (parsed.success) continue;
    assert.equal(validationErrorBody(parsed.error).firstStep, validationCase.firstStep, validationCase.label);
  }
});

test("public lead submission validates, commits, prioritises and replays idempotently", async () => {
  const invalid = await app.inject({
    method: "POST",
    url: "/api/v1/leads",
    headers: { "idempotency-key": "mission-invalid-001" },
    payload: { systems: [] },
  });
  assert.equal(invalid.statusCode, 422);
  assert.equal(invalid.json().firstStep, 1);

  const disposable = await app.inject({
    method: "POST",
    url: "/api/v1/leads",
    headers: { "idempotency-key": "mission-disposable-001" },
    payload: sampleLead({
      contact: { ...sampleLead().contact, workEmail: "morgan@mailinator.com" },
    }),
  });
  assert.equal(disposable.statusCode, 422);
  assert.equal(disposable.json().error, "DISPOSABLE_EMAIL_REJECTED");
  assert.equal(disposable.json().firstStep, 3);

  const payload = sampleLead();
  const first = await app.inject({
    method: "POST",
    url: "/api/v1/leads",
    headers: { "idempotency-key": "mission-test-001" },
    payload,
  });
  assert.equal(first.statusCode, 201, first.body);
  const created = first.json();
  assert.match(created.referenceCode, /^EGN-\d{8}-[A-F0-9]{6}$/);
  assert.equal(created.priority, "URGENT");
  assert.equal(created.brief.version, "RULES_V1");
  assert.equal(created.brief.systems.length, 2);
  assert.equal(created.replayed, false);

  const replay = await app.inject({
    method: "POST",
    url: "/api/v1/leads",
    headers: { "idempotency-key": "mission-test-001" },
    payload,
  });
  assert.equal(replay.statusCode, 200, replay.body);
  assert.equal(replay.json().leadId, created.leadId);
  assert.equal(replay.json().replayed, true);

  const conflict = await app.inject({
    method: "POST",
    url: "/api/v1/leads",
    headers: { "idempotency-key": "mission-test-001" },
    payload: sampleLead({ primarySystem: "DEPLOY" }),
  });
  assert.equal(conflict.statusCode, 409);
});

test("admin authentication, notification routing and test delivery are operational", async () => {
  const auth = await login();
  assert.equal(auth.user.mustChangePassword, true);
  const recipient = await app.inject({
    method: "POST",
    url: "/api/v1/admin/settings/notifications",
    headers: { origin: ORIGIN, cookie: auth.cookie, "x-csrf-token": auth.csrf },
    payload: { email: "opportunities@egain.example", label: "Commercial desk" },
  });
  assert.equal(recipient.statusCode, 201, recipient.body);

  const testSignal = await app.inject({
    method: "POST",
    url: "/api/v1/admin/settings/notifications/test",
    headers: { origin: ORIGIN, cookie: auth.cookie, "x-csrf-token": auth.csrf },
    payload: { email: "opportunities@egain.example" },
  });
  assert.equal(testSignal.statusCode, 200, testSignal.body);
  assert.equal(testSignal.json().status, "SENT");
  assert.equal(testSignal.json().simulated, true);

  const list = await app.inject({
    method: "GET",
    url: "/api/v1/admin/settings/notifications",
    headers: { cookie: auth.cookie },
  });
  assert.equal(list.statusCode, 200);
  assert.equal(list.json().recipients.length, 1);
});

test("Sales RBAC limits settings while exposing its team queue", async () => {
  const admin = await login();
  const invite = await app.inject({
    method: "POST",
    url: "/api/v1/admin/users/invitations",
    headers: { origin: ORIGIN, cookie: admin.cookie, "x-csrf-token": admin.csrf },
    payload: { email: "sales@egain.example", role: "SALES", teamId: "build" },
  });
  assert.equal(invite.statusCode, 201, invite.body);
  const localInviteUrl = new URL(invite.json().localInviteUrl);
  const token = localInviteUrl.searchParams.get("invite");
  assert.ok(token);
  const accepted = await app.inject({
    method: "POST",
    url: "/api/v1/auth/accept-invite",
    headers: { origin: ORIGIN },
    payload: { token, name: "Build Sales", password: "A-secure-demo-password" },
  });
  assert.equal(accepted.statusCode, 201, accepted.body);
  const sales = await login("sales@egain.example", "A-secure-demo-password");

  const forbidden = await app.inject({
    method: "GET",
    url: "/api/v1/admin/settings/notifications",
    headers: { cookie: sales.cookie },
  });
  assert.equal(forbidden.statusCode, 403);

  const lead = await app.inject({
    method: "POST",
    url: "/api/v1/leads",
    headers: { "idempotency-key": "mission-sales-queue-001" },
    payload: sampleLead({
      contact: { ...sampleLead().contact, workEmail: "technology@second.example", company: "Second Systems" },
    }),
  });
  assert.equal(lead.statusCode, 201, lead.body);
  const visible = await app.inject({
    method: "GET",
    url: "/api/v1/admin/leads?pageSize=100",
    headers: { cookie: sales.cookie },
  });
  assert.equal(visible.statusCode, 200, visible.body);
  assert.ok(visible.json().items.some((item: { id: string }) => item.id === lead.json().leadId));
});

test("Admin can merge a duplicate while retaining a traceable survivor", async () => {
  const admin = await login();
  const registry = await app.inject({
    method: "GET",
    url: "/api/v1/admin/leads?pageSize=100",
    headers: { cookie: admin.cookie },
  });
  assert.equal(registry.statusCode, 200);
  const items = registry.json().items as Array<{ id: string; referenceCode: string; company: string }>;
  const survivor = items.find((item) => item.company === "Northstar Systems");
  const duplicate = items.find((item) => item.company === "Second Systems");
  assert.ok(survivor && duplicate);

  const merged = await app.inject({
    method: "POST",
    url: `/api/v1/admin/leads/${survivor.id}/merge`,
    headers: { origin: ORIGIN, cookie: admin.cookie, "x-csrf-token": admin.csrf },
    payload: { duplicateReference: duplicate.referenceCode },
  });
  assert.equal(merged.statusCode, 200, merged.body);
  assert.equal(merged.json().merged, true);

  const survivorDetail = await app.inject({
    method: "GET",
    url: `/api/v1/admin/leads/${survivor.id}`,
    headers: { cookie: admin.cookie },
  });
  assert.equal(survivorDetail.statusCode, 200);
  assert.ok(survivorDetail.json().notes.some((note: { body: string }) => note.body.includes(duplicate.referenceCode)));
});

test("production refuses the local demo credential and disables intake without a Privacy Notice", async () => {
  const productionApp = await buildApp({
    databaseUrl: "memory://",
    logger: false,
    startWorker: false,
    config: {
      production: true,
      nodeEnvironment: "production",
      publicOrigin: ORIGIN,
      privacyNoticeUrl: "",
    },
  });
  await productionApp.ready();
  try {
    const login = await productionApp.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { origin: ORIGIN },
      payload: { email: "admin@egain.local", password: "1234" },
    });
    assert.equal(login.statusCode, 401);

    const alternateOrigin = await productionApp.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { origin: "http://127.0.0.1:4174" },
      payload: { email: "admin@egain.local", password: "1234" },
    });
    assert.equal(alternateOrigin.statusCode, 403);

    const lead = await productionApp.inject({
      method: "POST",
      url: "/api/v1/leads",
      headers: { "idempotency-key": "production-privacy-gate-001" },
      payload: sampleLead(),
    });
    assert.equal(lead.statusCode, 503);
    assert.equal(lead.json().error, "SUBMISSION_DISABLED");
  } finally {
    await productionApp.close();
  }
});
