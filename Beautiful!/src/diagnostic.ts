import {
  ORBIT_SERVICES,
  type PlanetId,
} from "./projectOrbitContent";
import type { CreateLeadRequest, CreateLeadResponse } from "../shared/contracts";

export const DIAGNOSTIC_DRAFT_VERSION = 2;
export const DIAGNOSTIC_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
export const DIAGNOSTIC_DRAFT_STORAGE_KEY = "egain.project-orbit.diagnostic.v2";
const LEGACY_DIAGNOSTIC_DRAFT_STORAGE_KEY = "egain.project-orbit.diagnostic.v1";

export type DiagnosticStep = 1 | 2 | 3;
export type BudgetCurrency = "GBP" | "USD" | "EUR";

export interface OutcomeData {
  objective: string;
  expectedOutcomes: string[];
  executiveSummary: string;
}

export interface CurrentStateData {
  initiativeStage: string;
  deliveryContext: string;
  impactScope: string;
  landscape: string;
  dependencies: string;
}

export interface TechnicalSignalsData {
  domains: string[];
  deploymentMode: string;
  regulatedData: string;
  complianceFrameworks: string[];
  systemAnswers: Partial<Record<PlanetId, string>>;
}

export interface DeliveryData {
  engagementModel: string;
  procurementState: string;
  timeline: string;
  targetDate: string;
  discloseBudget: boolean;
  budgetCurrency: BudgetCurrency | "";
  budgetBand: string;
}

export interface ContactData {
  fullName: string;
  jobTitle: string;
  company: string;
  workEmail: string;
  phone: string;
  country: string;
}

export interface DiagnosticData {
  systems: PlanetId[];
  primarySystem: PlanetId | null;
  outcome: OutcomeData;
  currentState: CurrentStateData;
  technicalSignals: TechnicalSignalsData;
  delivery: DeliveryData;
  contact: ContactData;
  contactConsent: boolean;
}

export interface DiagnosticDraft {
  version: typeof DIAGNOSTIC_DRAFT_VERSION;
  idempotencyKey: string;
  updatedAt: string;
  currentStep: DiagnosticStep;
  completedSteps: DiagnosticStep[];
  data: DiagnosticData;
}

export interface HelpMeChooseAnswers {
  goal: string;
  outcomes: string[];
  environment: string;
}

export interface SystemRecommendation {
  systems: PlanetId[];
  reasons: Partial<Record<PlanetId, string>>;
}

export interface ValidationResult {
  valid: boolean;
  errors: Record<string, string>;
}

export interface DraftLoadResult {
  draft: DiagnosticDraft | null;
  expired: boolean;
}

const PLANET_IDS = new Set<PlanetId>(ORBIT_SERVICES.map((service) => service.id));

const DISPOSABLE_EMAIL_DOMAINS = new Set([
  "10minutemail.com",
  "dispostable.com",
  "emailondeck.com",
  "fakeinbox.com",
  "getnada.com",
  "guerrillamail.com",
  "maildrop.cc",
  "mailinator.com",
  "minuteinbox.com",
  "mohmal.com",
  "sharklasers.com",
  "temp-mail.org",
  "tempmail.com",
  "throwawaymail.com",
  "yopmail.com",
]);

const PERSONAL_EMAIL_DOMAINS = new Set([
  "aol.com",
  "gmail.com",
  "googlemail.com",
  "hotmail.co.uk",
  "hotmail.com",
  "icloud.com",
  "live.co.uk",
  "live.com",
  "me.com",
  "outlook.com",
  "proton.me",
  "protonmail.com",
  "yahoo.co.uk",
  "yahoo.com",
]);

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;

function makeIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `orbit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function isDiagnosticStep(value: unknown): value is DiagnosticStep {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 3;
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function cleanStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function cleanSystems(value: unknown): PlanetId[] {
  const seen = new Set<string>();
  return cleanStringArray(value).filter((item): item is PlanetId => {
    if (!PLANET_IDS.has(item as PlanetId) || seen.has(item)) return false;
    seen.add(item);
    return true;
  }).slice(0, 3);
}

function cleanSystemAnswers(value: unknown): Partial<Record<PlanetId, string>> {
  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  const answers: Partial<Record<PlanetId, string>> = {};
  ORBIT_SERVICES.forEach((service) => {
    const answer = cleanString(record[service.id]);
    if (answer) answers[service.id] = answer;
  });
  return answers;
}

export function createInitialDiagnosticDraft(): DiagnosticDraft {
  return {
    version: DIAGNOSTIC_DRAFT_VERSION,
    idempotencyKey: makeIdempotencyKey(),
    updatedAt: new Date().toISOString(),
    currentStep: 1,
    completedSteps: [],
    data: {
      systems: [],
      primarySystem: null,
      outcome: {
        objective: "",
        expectedOutcomes: [],
        executiveSummary: "",
      },
      currentState: {
        initiativeStage: "",
        deliveryContext: "",
        impactScope: "",
        landscape: "",
        dependencies: "",
      },
      technicalSignals: {
        domains: [],
        deploymentMode: "",
        regulatedData: "",
        complianceFrameworks: [],
        systemAnswers: {},
      },
      delivery: {
        engagementModel: "",
        procurementState: "",
        timeline: "",
        targetDate: "",
        discloseBudget: false,
        budgetCurrency: "",
        budgetBand: "",
      },
      contact: {
        fullName: "",
        jobTitle: "",
        company: "",
        workEmail: "",
        phone: "",
        country: "",
      },
      contactConsent: false,
    },
  };
}

function hydrateDraft(candidate: unknown): DiagnosticDraft | null {
  if (!candidate || typeof candidate !== "object") return null;
  const record = candidate as Record<string, unknown>;
  if (record.version !== DIAGNOSTIC_DRAFT_VERSION || typeof record.idempotencyKey !== "string") return null;
  if (typeof record.updatedAt !== "string" || Number.isNaN(Date.parse(record.updatedAt))) return null;

  const initial = createInitialDiagnosticDraft();
  const rawData = record.data && typeof record.data === "object" ? record.data as Record<string, unknown> : {};
  const rawOutcome = rawData.outcome && typeof rawData.outcome === "object" ? rawData.outcome as Record<string, unknown> : {};
  const rawState = rawData.currentState && typeof rawData.currentState === "object" ? rawData.currentState as Record<string, unknown> : {};
  const rawSignals = rawData.technicalSignals && typeof rawData.technicalSignals === "object" ? rawData.technicalSignals as Record<string, unknown> : {};
  const rawDelivery = rawData.delivery && typeof rawData.delivery === "object" ? rawData.delivery as Record<string, unknown> : {};
  const rawContact = rawData.contact && typeof rawData.contact === "object" ? rawData.contact as Record<string, unknown> : {};
  const systems = cleanSystems(rawData.systems);
  const rawPrimary = cleanString(rawData.primarySystem);
  const primarySystem = systems.includes(rawPrimary as PlanetId) ? rawPrimary as PlanetId : systems.length === 1 ? systems[0] : null;
  const currency = cleanString(rawDelivery.budgetCurrency);

  return {
    ...initial,
    idempotencyKey: record.idempotencyKey,
    updatedAt: record.updatedAt,
    currentStep: isDiagnosticStep(record.currentStep) ? record.currentStep : 1,
    completedSteps: Array.isArray(record.completedSteps)
      ? record.completedSteps.filter(isDiagnosticStep)
      : [],
    data: {
      systems,
      primarySystem,
      outcome: {
        objective: cleanString(rawOutcome.objective),
        expectedOutcomes: cleanStringArray(rawOutcome.expectedOutcomes).slice(0, 3),
        executiveSummary: cleanString(rawOutcome.executiveSummary),
      },
      currentState: {
        initiativeStage: cleanString(rawState.initiativeStage),
        deliveryContext: cleanString(rawState.deliveryContext),
        impactScope: cleanString(rawState.impactScope),
        landscape: cleanString(rawState.landscape),
        dependencies: cleanString(rawState.dependencies),
      },
      technicalSignals: {
        domains: cleanStringArray(rawSignals.domains),
        deploymentMode: cleanString(rawSignals.deploymentMode),
        regulatedData: cleanString(rawSignals.regulatedData),
        complianceFrameworks: cleanStringArray(rawSignals.complianceFrameworks),
        systemAnswers: cleanSystemAnswers(rawSignals.systemAnswers),
      },
      delivery: {
        engagementModel: cleanString(rawDelivery.engagementModel),
        procurementState: cleanString(rawDelivery.procurementState),
        timeline: cleanString(rawDelivery.timeline),
        targetDate: cleanString(rawDelivery.targetDate),
        discloseBudget: rawDelivery.discloseBudget === true,
        budgetCurrency: currency === "GBP" || currency === "USD" || currency === "EUR" ? currency : "",
        budgetBand: cleanString(rawDelivery.budgetBand),
      },
      contact: {
        fullName: cleanString(rawContact.fullName),
        jobTitle: cleanString(rawContact.jobTitle),
        company: cleanString(rawContact.company),
        workEmail: cleanString(rawContact.workEmail),
        phone: cleanString(rawContact.phone),
        country: cleanString(rawContact.country),
      },
      contactConsent: false,
    },
  };
}

export function saveDiagnosticDraft(draft: DiagnosticDraft): boolean {
  if (typeof sessionStorage === "undefined") return false;
  const persisted: DiagnosticDraft = {
    ...draft,
    updatedAt: new Date().toISOString(),
    data: {
      ...draft.data,
      contactConsent: false,
    },
  };

  try {
    sessionStorage.setItem(DIAGNOSTIC_DRAFT_STORAGE_KEY, JSON.stringify(persisted));
    draft.updatedAt = persisted.updatedAt;
    return true;
  } catch {
    return false;
  }
}

export function loadDiagnosticDraft(): DraftLoadResult {
  if (typeof sessionStorage === "undefined") return { draft: null, expired: false };

  let raw: string | null = null;
  try {
    // The six-step draft cannot be resumed safely against the condensed flow.
    sessionStorage.removeItem(LEGACY_DIAGNOSTIC_DRAFT_STORAGE_KEY);
    raw = sessionStorage.getItem(DIAGNOSTIC_DRAFT_STORAGE_KEY);
  } catch {
    return { draft: null, expired: false };
  }
  if (!raw) return { draft: null, expired: false };

  try {
    const draft = hydrateDraft(JSON.parse(raw) as unknown);
    if (!draft) {
      clearDiagnosticDraft();
      return { draft: null, expired: false };
    }
    const expired = Date.now() - Date.parse(draft.updatedAt) > DIAGNOSTIC_DRAFT_TTL_MS;
    if (expired) {
      clearDiagnosticDraft();
      return { draft: null, expired: true };
    }
    return { draft, expired: false };
  } catch {
    clearDiagnosticDraft();
    return { draft: null, expired: false };
  }
}

export function clearDiagnosticDraft(): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(DIAGNOSTIC_DRAFT_STORAGE_KEY);
    sessionStorage.removeItem(LEGACY_DIAGNOSTIC_DRAFT_STORAGE_KEY);
  } catch {
    // Storage can be unavailable in privacy modes; the in-memory flow still works.
  }
}

function requireValue(errors: Record<string, string>, field: string, value: string, message: string): void {
  if (!value.trim()) errors[field] = message;
}

function requireLength(
  errors: Record<string, string>,
  field: string,
  value: string,
  minimum: number,
  maximum: number,
  label: string,
): void {
  const length = value.trim().length;
  if (length < minimum) errors[field] = `${label} must be at least ${minimum} characters.`;
  else if (length > maximum) errors[field] = `${label} must be no more than ${maximum} characters.`;
}

export function emailDomain(email: string): string {
  return email.trim().toLowerCase().split("@")[1] ?? "";
}

export function isDisposableEmail(email: string): boolean {
  const domain = emailDomain(email);
  return domain !== "" && DISPOSABLE_EMAIL_DOMAINS.has(domain);
}

export function isPersonalEmail(email: string): boolean {
  const domain = emailDomain(email);
  return domain !== "" && PERSONAL_EMAIL_DOMAINS.has(domain);
}

export function validateDiagnosticStep(
  step: DiagnosticStep,
  data: DiagnosticData,
  options: { requireConsent?: boolean } = {},
): ValidationResult {
  const errors: Record<string, string> = {};

  if (step === 1) {
    if (data.systems.length < 1 || data.systems.length > 3) {
      errors.systems = "Select between one and three systems.";
    }
    if (data.systems.length > 1 && !data.primarySystem) {
      errors.primarySystem = "Choose one primary system.";
    } else if (data.primarySystem && !data.systems.includes(data.primarySystem)) {
      errors.primarySystem = "The primary system must be part of your selection.";
    }
    requireValue(errors, "outcome.objective", data.outcome.objective, "Choose the main project objective.");
    if (data.outcome.expectedOutcomes.length < 1 || data.outcome.expectedOutcomes.length > 3) {
      errors["outcome.expectedOutcomes"] = "Choose between one and three expected outcomes.";
    }
    requireLength(errors, "outcome.executiveSummary", data.outcome.executiveSummary, 40, 800, "Executive summary");
  }

  if (step === 2) {
    requireValue(errors, "currentState.initiativeStage", data.currentState.initiativeStage, "Choose the initiative stage.");
    requireValue(errors, "currentState.deliveryContext", data.currentState.deliveryContext, "Choose the delivery context.");
    requireValue(errors, "currentState.impactScope", data.currentState.impactScope, "Choose the expected impact scope.");
    requireLength(errors, "currentState.landscape", data.currentState.landscape, 40, 1200, "Current landscape");
    if (data.currentState.dependencies.trim().length > 800) {
      errors["currentState.dependencies"] = "Known dependencies must be no more than 800 characters.";
    }
    requireValue(errors, "delivery.engagementModel", data.delivery.engagementModel, "Choose an engagement model.");
    requireValue(errors, "delivery.procurementState", data.delivery.procurementState, "Choose the procurement state.");
    requireValue(errors, "delivery.timeline", data.delivery.timeline, "Choose a delivery window.");
    if (data.delivery.timeline === "target-date") {
      requireValue(errors, "delivery.targetDate", data.delivery.targetDate, "Choose the target date.");
      if (data.delivery.targetDate) {
        const target = new Date(`${data.delivery.targetDate}T23:59:59`);
        if (Number.isNaN(target.valueOf()) || target.valueOf() < Date.now()) {
          errors["delivery.targetDate"] = "Choose a target date that has not passed.";
        }
      }
    }
    if (data.delivery.discloseBudget) {
      if (!data.delivery.budgetCurrency) errors["delivery.budgetCurrency"] = "Choose the budget currency.";
      requireValue(errors, "delivery.budgetBand", data.delivery.budgetBand, "Choose the estimated budget band.");
    }
  }

  if (step === 3) {
    requireValue(errors, "contact.fullName", data.contact.fullName, "Enter your full name.");
    requireValue(errors, "contact.jobTitle", data.contact.jobTitle, "Enter your role or job title.");
    requireValue(errors, "contact.company", data.contact.company, "Enter your organisation.");
    requireValue(errors, "contact.workEmail", data.contact.workEmail, "Enter your work email address.");
    if (data.contact.fullName && (data.contact.fullName.trim().length < 2 || data.contact.fullName.trim().length > 120)) {
      errors["contact.fullName"] = "Full name must be between 2 and 120 characters.";
    }
    if (data.contact.jobTitle && (data.contact.jobTitle.trim().length < 2 || data.contact.jobTitle.trim().length > 120)) {
      errors["contact.jobTitle"] = "Role or job title must be between 2 and 120 characters.";
    }
    if (data.contact.company && (data.contact.company.trim().length < 2 || data.contact.company.trim().length > 160)) {
      errors["contact.company"] = "Organisation must be between 2 and 160 characters.";
    }
    if (data.contact.workEmail.trim().length > 254) {
      errors["contact.workEmail"] = "Work email must be no more than 254 characters.";
    }
    if (data.contact.phone.trim().length > 40) {
      errors["contact.phone"] = "Phone must be no more than 40 characters.";
    }
    if (data.contact.country.trim().length > 100) {
      errors["contact.country"] = "Country or region must be no more than 100 characters.";
    }
    if (data.contact.workEmail && !EMAIL_PATTERN.test(data.contact.workEmail.trim())) {
      errors["contact.workEmail"] = "Enter a valid email address.";
    } else if (isDisposableEmail(data.contact.workEmail)) {
      errors["contact.workEmail"] = "Disposable email addresses cannot be used for a project brief.";
    }
    if (options.requireConsent && !data.contactConsent) {
      errors.contactConsent = "Confirm that e Gain may contact you about this project.";
    }
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

export function validateDiagnostic(data: DiagnosticData): { valid: boolean; step: DiagnosticStep; errors: Record<string, string> } {
  for (let step = 1 as DiagnosticStep; step <= 3; step = (step + 1) as DiagnosticStep) {
    const validation = validateDiagnosticStep(step, data, { requireConsent: step === 3 });
    if (!validation.valid) return { valid: false, step, errors: validation.errors };
  }
  return { valid: true, step: 3, errors: {} };
}

const GOAL_SCORES: Readonly<Record<string, readonly PlanetId[]>> = {
  "change-business": ["TRANSFORM", "BUILD", "OPERATE"],
  "create-product": ["EXPERIENCE", "BUILD", "TEST"],
  "improve-delivery": ["DEPLOY", "TEST", "BUILD"],
  "control-risk": ["PROTECT", "TEST", "TRANSFORM"],
  "use-data": ["OPERATE", "TRANSFORM", "DEPLOY"],
};

const OUTCOME_SCORES: Readonly<Record<string, readonly PlanetId[]>> = {
  "faster-delivery": ["DEPLOY", "BUILD", "TEST"],
  "better-experience": ["EXPERIENCE", "BUILD"],
  "lower-risk": ["PROTECT", "TEST", "TRANSFORM"],
  "greater-reliability": ["TEST", "DEPLOY", "BUILD"],
  "lower-cost": ["TRANSFORM", "DEPLOY"],
  "new-capability": ["BUILD", "EXPERIENCE", "OPERATE"],
  "trusted-insight": ["OPERATE", "PROTECT"],
};

const ENVIRONMENT_SCORES: Readonly<Record<string, readonly PlanetId[]>> = {
  legacy: ["TRANSFORM", "BUILD", "DEPLOY"],
  mixed: ["BUILD", "TRANSFORM", "PROTECT"],
  cloud: ["DEPLOY", "PROTECT", "TEST"],
  product: ["EXPERIENCE", "TEST", "BUILD"],
  data: ["OPERATE", "PROTECT", "TRANSFORM"],
  unknown: ["TRANSFORM", "BUILD"],
};

export function recommendSystems(answers: HelpMeChooseAnswers): SystemRecommendation {
  const scores = new Map<PlanetId, number>(ORBIT_SERVICES.map((service) => [service.id, 0]));
  const signals = new Map<PlanetId, string[]>();

  const add = (systems: readonly PlanetId[] | undefined, weight: number, reason: string): void => {
    systems?.forEach((system, index) => {
      scores.set(system, (scores.get(system) ?? 0) + Math.max(1, weight - index));
      const systemSignals = signals.get(system) ?? [];
      if (!systemSignals.includes(reason)) systemSignals.push(reason);
      signals.set(system, systemSignals);
    });
  };

  add(GOAL_SCORES[answers.goal], 5, "your primary goal");
  answers.outcomes.slice(0, 3).forEach((outcome) => add(OUTCOME_SCORES[outcome], 3, "the outcomes you prioritised"));
  add(ENVIRONMENT_SCORES[answers.environment], 3, "your current environment");

  const ranked = ORBIT_SERVICES
    .map((service) => ({ id: service.id, score: scores.get(service.id) ?? 0 }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const positiveCount = ranked.filter((item) => item.score > 0).length;
  const resultCount = Math.max(1, Math.min(3, positiveCount >= 3 ? 3 : positiveCount));
  const systems = ranked.slice(0, resultCount).map((item) => item.id);
  const reasons: Partial<Record<PlanetId, string>> = {};

  systems.forEach((system) => {
    const systemSignals = signals.get(system) ?? ["the information provided"];
    reasons[system] = `Recommended from ${systemSignals.slice(0, 2).join(" and ")}.`;
  });

  return { systems, reasons };
}

export function buildLeadSubmissionRequest(
  data: DiagnosticData,
  privacyVersion = "2026-07-18",
): CreateLeadRequest {
  if (!data.primarySystem) throw new Error("A primary system is required before submission.");
  if (!data.contactConsent) throw new Error("Contact consent is required before submission.");

  const dependencies = data.currentState.dependencies.trim();
  const targetDate = data.delivery.timeline === "target-date" ? data.delivery.targetDate : "";
  const phone = data.contact.phone.trim();
  const country = data.contact.country.trim();
  const deferredSystemAnswers = Object.fromEntries(
    data.systems.map((system) => [system, "not-sure"]),
  ) as Partial<Record<PlanetId, string>>;

  return {
    systems: [...data.systems],
    primarySystem: data.primarySystem,
    outcome: {
      objective: data.outcome.objective,
      expectedOutcomes: [...data.outcome.expectedOutcomes],
      executiveSummary: data.outcome.executiveSummary.trim(),
    },
    currentState: {
      initiativeStage: data.currentState.initiativeStage,
      deliveryContext: data.currentState.deliveryContext,
      impactScope: data.currentState.impactScope,
      landscape: data.currentState.landscape.trim(),
      dependencies,
    },
    technicalSignals: {
      domains: [],
      deploymentMode: "not-sure",
      regulatedData: "not-sure",
      complianceFrameworks: [],
      systemAnswers: deferredSystemAnswers,
    },
    delivery: {
      engagementModel: data.delivery.engagementModel,
      procurementState: data.delivery.procurementState,
      timeline: data.delivery.timeline,
      ...(targetDate ? { targetDate } : {}),
      ...(data.delivery.discloseBudget && data.delivery.budgetCurrency
        ? { budget: { currency: data.delivery.budgetCurrency, band: data.delivery.budgetBand } }
        : {}),
    },
    contact: {
      fullName: data.contact.fullName.trim(),
      jobTitle: data.contact.jobTitle.trim(),
      company: data.contact.company.trim(),
      workEmail: data.contact.workEmail.trim().toLowerCase(),
      phone,
      country,
    },
    consent: {
      contact: true,
      privacyVersion,
    },
  };
}

export function stepForApiPath(path: string): DiagnosticStep {
  if (path.startsWith("systems") || path.startsWith("primarySystem")) return 1;
  if (path.startsWith("outcome")) return 1;
  if (path.startsWith("currentState") || path.startsWith("delivery") || path.startsWith("technicalSignals")) return 2;
  return 3;
}

export function briefToText(brief: CreateLeadResponse["brief"]): string {
  return JSON.stringify(brief, null, 2);
}
