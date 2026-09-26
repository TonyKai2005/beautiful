import { z } from "zod";

export const PLANET_IDS = [
  "TRANSFORM",
  "BUILD",
  "EXPERIENCE",
  "TEST",
  "DEPLOY",
  "PROTECT",
  "OPERATE",
] as const;

export type PlanetId = (typeof PLANET_IDS)[number];
export type SceneMode = "CINEMATIC" | "ORBIT_REVEAL" | "ORBIT_FOCUS" | "MISSION_DECK" | "RECEIVED";

export const PLANET_LABELS: Record<PlanetId, string> = {
  TRANSFORM: "Business Transformation",
  BUILD: "Application Engineering",
  EXPERIENCE: "Mobile & Digital Experience",
  TEST: "Quality Engineering & Validation",
  DEPLOY: "Cloud & DevOps",
  PROTECT: "Cybersecurity & Information Governance",
  OPERATE: "AI & Data",
};

export const LEAD_STATUSES = ["NEW", "CONTACTED", "DISCOVERY", "QUALIFIED", "PROPOSAL", "WON", "LOST"] as const;
export const LEAD_PRIORITIES = ["NORMAL", "HIGH", "URGENT"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export type LeadPriority = (typeof LEAD_PRIORITIES)[number];
export type UserRole = "ADMIN" | "SALES";

const shortChoice = z.string().trim().min(1).max(120);
const selectedSystemsSchema = z.array(z.enum(PLANET_IDS)).min(1).max(3).refine(
  (systems) => new Set(systems).size === systems.length,
  "Select each system only once.",
);

export const diagnosticDraftSchema = z.object({
  systems: selectedSystemsSchema,
  primarySystem: z.enum(PLANET_IDS),
  outcome: z.object({
    objective: shortChoice,
    expectedOutcomes: z.array(shortChoice).min(1).max(3),
    executiveSummary: z.string().trim().min(40).max(800),
  }).strict(),
  currentState: z.object({
    initiativeStage: shortChoice,
    deliveryContext: shortChoice,
    impactScope: shortChoice,
    landscape: z.string().trim().min(40).max(1200),
    dependencies: z.string().trim().max(800).optional().default(""),
  }).strict(),
  technicalSignals: z.object({
    domains: z.array(shortChoice).max(12).default([]),
    deploymentMode: shortChoice,
    regulatedData: shortChoice,
    complianceFrameworks: z.array(shortChoice).max(12).default([]),
    systemAnswers: z.partialRecord(z.enum(PLANET_IDS), z.string().trim().min(1).max(800)).default({}),
  }).strict(),
  delivery: z.object({
    engagementModel: shortChoice,
    procurementState: shortChoice,
    timeline: shortChoice,
    targetDate: z.string().date().optional(),
    budget: z.object({
      currency: z.enum(["GBP", "USD", "EUR"]),
      band: shortChoice,
    }).strict().optional(),
  }).strict(),
  contact: z.object({
    fullName: z.string().trim().min(2).max(120),
    jobTitle: z.string().trim().min(2).max(120),
    company: z.string().trim().min(2).max(160),
    workEmail: z.string().trim().toLowerCase().email().max(254),
    phone: z.string().trim().max(40).optional().default(""),
    country: z.string().trim().max(100).optional().default(""),
  }).strict(),
  consent: z.object({
    contact: z.literal(true),
    privacyVersion: z.string().trim().min(1).max(80),
  }).strict(),
}).strict().superRefine((draft, ctx) => {
  if (!draft.systems.includes(draft.primarySystem)) {
    ctx.addIssue({
      code: "custom",
      message: "Primary system must be one of the selected systems.",
      path: ["primarySystem"],
    });
  }
});

export type DiagnosticDraft = z.infer<typeof diagnosticDraftSchema>;
export type CreateLeadRequest = DiagnosticDraft;

export interface StructuredBrief {
  version: "RULES_V1";
  referenceCode: string;
  headline: string;
  systems: Array<{ id: PlanetId; label: string; primary: boolean }>;
  project: {
    goal: string;
    desiredOutcomes: string[];
    executiveSummary: string;
    initiativeStage: string;
    deliveryContext: string;
    impactScope: string;
    currentLandscape: string;
    dependencies: string;
  };
  technical: {
    domains: string[];
    deploymentMode: string;
    regulatedData: string;
    complianceFrameworks: string[];
    clarifications: string[];
  };
  delivery: {
    engagementModel: string;
    procurementState: string;
    timeframe: string;
    targetDate?: string;
    budget: string;
  };
  contact: { name: string; title: string; company: string; workEmail: string; phone: string; country: string };
  generatedAt: string;
}

export interface CreateLeadResponse {
  leadId: string;
  referenceCode: string;
  receivedAt: string;
  priority: LeadPriority;
  brief: StructuredBrief;
  bookingUrl: string | null;
  replayed: boolean;
  warnings: string[];
}

export interface OrbitPresentationState {
  mode: SceneMode;
  focusedPlanet: PlanetId | null;
  selectedPlanets: PlanetId[];
  primaryPlanet: PlanetId | null;
  completedSteps: number[];
}

export interface ApiErrorBody {
  error: string;
  message: string;
  issues?: Array<{ path: string; message: string }>;
  firstStep?: number;
  retryAfterSeconds?: number;
}
