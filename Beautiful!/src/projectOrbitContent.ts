import type { PlanetId } from "../shared/contracts";

export type { PlanetId } from "../shared/contracts";

export interface OrbitService {
  id: PlanetId;
  /** Visual-only world code. Internal IDs remain stable for scene and lead contracts. */
  displayId?: string;
  index: string;
  name: string;
  /** Optional supporting line used beneath a world label in the system overview. */
  overviewDescription?: string;
  shortName: string;
  signal: string;
  description: string;
  destination: OrbitDestination;
}

export type OrbitDestinationKind =
  | "brief"
  | "tools"
  | "cases"
  | "reliability"
  | "method"
  | "governance"
  | "ai";

export interface OrbitDestinationItem {
  index: string;
  kicker: string;
  title: string;
  body: string;
  signal?: string;
  /** Stable local reading snapshot reference when the item has a full source page. */
  detailId?: string;
}

export interface OrbitDestination {
  kind: OrbitDestinationKind;
  label: string;
  eyebrow: string;
  title: string;
  summary: string;
  ctaLabel: string;
  sequence?: readonly string[];
  note?: string;
  items: readonly OrbitDestinationItem[];
}

export const ORBIT_SERVICES: readonly OrbitService[] = [
  {
    id: "TRANSFORM",
    index: "01",
    name: "Business Transformation",
    shortName: "Transform",
    signal: "Reconfigure",
    description: "Turn operating ambition into a practical programme of change.",
    destination: {
      kind: "brief",
      label: "Shape the Brief",
      eyebrow: "Mission Definition / Structured Handoff",
      title: "Turn intent into a brief engineering can act on.",
      summary: "Define the change, the operating pressure and the people responsible in one concise three-stage transmission.",
      ctaLabel: "Shape the Brief",
      sequence: ["VECTOR", "ENVELOPE", "TRANSMIT"],
      items: [
        { index: "01", kicker: "VECTOR", title: "Define the mission", body: "Select the services, objective and outcomes that matter most." },
        { index: "02", kicker: "ENVELOPE", title: "Map reality", body: "Capture the current estate, delivery pressure and timing." },
        { index: "03", kicker: "TRANSMIT", title: "Authorise the handoff", body: "Review the signal and send it securely to e Gain." },
      ],
    },
  },
  {
    id: "BUILD",
    displayId: "SERVICES",
    index: "02",
    name: "Services",
    overviewDescription: "Application, cloud, data and delivery capability.",
    shortName: "Services",
    signal: "Deliver",
    description: "Application, cloud, data and delivery capability.",
    destination: {
      kind: "tools",
      label: "Technology Services",
      eyebrow: "Services / Technology Delivery",
      title: "Technology services built around your business.",
      summary: "From custom applications and mobile products to cloud, data and intelligent automation, our teams help turn technology needs into practical delivery outcomes.",
      ctaLabel: "Add Services to Project Brief",
      note: "Service areas are shaped around your goals, existing systems and delivery priorities.",
      items: [
        { index: "01", kicker: "APPLICATION DEVELOPMENT", title: "Build the right digital foundation", body: "Create web, mobile and cloud applications that fit the way your organisation works.", signal: "DIGITAL PRODUCTS" },
        { index: "02", kicker: "MAINTENANCE & SUPPORT", title: "Keep critical applications moving", body: "Stabilise, support and continuously improve the systems your teams and customers rely on.", signal: "LIVE SYSTEMS" },
        { index: "03", kicker: "INDEPENDENT VALIDATION", title: "Make quality visible", body: "Use focused testing and quality assurance to make each release more dependable.", signal: "QUALITY ASSURANCE" },
        { index: "04", kicker: "MOBILE APP DEVELOPMENT", title: "Connect people on the move", body: "Design useful mobile experiences for customers, field teams and day-to-day operations.", signal: "MOBILE EXPERIENCE" },
        { index: "05", kicker: "ARTIFICIAL INTELLIGENCE", title: "Apply intelligence with purpose", body: "Use automation, machine learning and data-led insight where they create practical value.", signal: "APPLIED AI" },
        { index: "06", kicker: "CLOUD MIGRATION & DEVOPS", title: "Move and operate with control", body: "Plan, migrate and run systems through a repeatable, resilient delivery path.", signal: "CLOUD DELIVERY" },
        { index: "07", kicker: "BIG DATA ANALYTICS", title: "Turn data into clarity", body: "Bring complex information together to reveal performance, opportunity and the next decision.", signal: "DATA INSIGHT" },
        { index: "08", kicker: "CLOUD AUTOMATION & HOSTING", title: "Automate the operating layer", body: "Create dependable cloud environments with automation, hosting and practical operational ownership.", signal: "PLATFORM OPERATIONS" },
        { index: "09", kicker: "BUSINESS TRANSFORMATION", title: "Connect change to outcomes", body: "Align technology change with the operating improvements your organisation needs to make.", signal: "CHANGE PROGRAMME" },
        { index: "10", kicker: "DATA-LED DIGITAL TRANSFORMATION", title: "Modernise with evidence", body: "Use connected data, digital services and delivery insight to shape a stronger next stage.", signal: "DIGITAL CHANGE" },
      ],
    },
  },
  {
    id: "EXPERIENCE",
    index: "03",
    name: "Mobile & Digital Experience",
    shortName: "Experience",
    signal: "Adapt",
    description: "Create useful digital products across mobile, web and connected channels.",
    destination: {
      kind: "cases",
      label: "Representative Cases",
      eyebrow: "Illustrative Composite Scenarios",
      title: "See how complex briefs become coherent systems.",
      summary: "Three anonymised scenarios demonstrate the shape of the challenge, the engineering response and the intended operating outcome.",
      ctaLabel: "Add Experience to Brief",
      note: "Representative scenarios only. No client identity, partnership or measured result is claimed.",
      items: [
        { index: "01", kicker: "REGULATED PLATFORM", title: "Release Recovery", body: "Unstable releases become a controlled delivery path with traceable quality evidence and rollback ownership.", signal: "CONTROL RESTORED" },
        { index: "02", kicker: "PUBLIC SERVICE", title: "Self-Service Modernisation", body: "Fragmented forms and legacy workflows become one governed digital journey with clear integration boundaries.", signal: "JOURNEY UNIFIED" },
        { index: "03", kicker: "FIELD OPERATIONS", title: "Knowledge Copilot", body: "Scattered operational guidance becomes a governed, human-reviewed retrieval workflow embedded in daily work.", signal: "GUIDANCE CONNECTED" },
      ],
    },
  },
  {
    id: "TEST",
    index: "04",
    name: "Quality Engineering & Validation",
    shortName: "Test",
    signal: "Verify",
    description: "Build confidence with measurable quality, automation and validation.",
    destination: {
      kind: "reliability",
      label: "Reliability Proof",
      eyebrow: "Evidence Chain / Demonstration Data",
      title: "Confidence should leave an evidence trail.",
      summary: "Move through the five controls that connect design intent to observable, recoverable production behaviour.",
      ctaLabel: "Add Test to Brief",
      sequence: ["DESIGN", "BUILD", "VERIFY", "RELEASE", "OBSERVE"],
      note: "All status signals are illustrative. No live system or client performance metric is represented.",
      items: [
        { index: "01", kicker: "DESIGN", title: "Acceptance model", body: "Make critical behaviours, risks and evidence requirements explicit." },
        { index: "02", kicker: "BUILD", title: "Quality gates", body: "Apply automated checks where defects are cheapest to contain." },
        { index: "03", kicker: "VERIFY", title: "System evidence", body: "Test function, performance, accessibility and security together." },
        { index: "04", kicker: "RELEASE", title: "Controlled change", body: "Connect approval, deployment, rollback and audit evidence." },
        { index: "05", kicker: "OBSERVE", title: "Operational truth", body: "Monitor service health and turn production signals into action." },
      ],
    },
  },
  {
    id: "DEPLOY",
    index: "05",
    name: "Cloud & DevOps",
    shortName: "Deploy",
    signal: "Release",
    description: "Modernise cloud foundations and make delivery safer, faster and repeatable.",
    destination: {
      kind: "method",
      label: "Delivery Method",
      eyebrow: "Release Path / Operating Ownership",
      title: "A controlled path from ambiguity to operation.",
      summary: "The delivery model keeps architecture, engineering, validation and operational ownership connected from the first decision.",
      ctaLabel: "Add Deploy to Brief",
      sequence: ["DISCOVER", "ARCHITECT", "ENGINEER", "VALIDATE", "OPERATE"],
      items: [
        { index: "01", kicker: "DISCOVER", title: "Frame the system", body: "Align outcomes, constraints, stakeholders and decision rights." },
        { index: "02", kicker: "ARCHITECT", title: "Design the path", body: "Resolve boundaries, dependencies, controls and transition states." },
        { index: "03", kicker: "ENGINEER", title: "Build in evidence", body: "Deliver in vertical increments with automation and observable quality." },
        { index: "04", kicker: "VALIDATE", title: "Prove readiness", body: "Test behaviour, resilience, security and operational response." },
        { index: "05", kicker: "OPERATE", title: "Transfer control", body: "Make ownership, telemetry, support and improvement explicit." },
      ],
    },
  },
  {
    id: "PROTECT",
    index: "06",
    name: "Cybersecurity & Information Governance",
    shortName: "Protect",
    signal: "Govern",
    description: "Engineer security, privacy and governance through the whole environment.",
    destination: {
      kind: "governance",
      label: "Trust & Governance",
      eyebrow: "Control Framework / Evidence by Design",
      title: "Security becomes part of the environment.",
      summary: "Connect risk, privacy, identity, information and operational control without reducing governance to a final-stage checklist.",
      ctaLabel: "Add Protect to Brief",
      items: [
        { index: "C1", kicker: "THREAT", title: "Threat modelling", body: "Model trust boundaries, attack paths and material failure modes." },
        { index: "C2", kicker: "PRIVACY", title: "Privacy by design", body: "Limit data, define purpose and preserve accountable decisions." },
        { index: "C3", kicker: "ACCESS", title: "Identity & control", body: "Make privileges, segregation and review visible across the system." },
        { index: "C4", kicker: "EVIDENCE", title: "Audit readiness", body: "Connect policies and controls to verifiable operating evidence." },
        { index: "C5", kicker: "RESPONSE", title: "Incident readiness", body: "Prepare ownership, containment, recovery and learning before failure." },
      ],
    },
  },
  {
    id: "OPERATE",
    index: "07",
    name: "AI & Data",
    shortName: "Operate",
    signal: "Learn",
    description: "Connect trustworthy data and applied intelligence to real operations.",
    destination: {
      kind: "ai",
      label: "AI Enablement Lab",
      eyebrow: "Applied Intelligence / Governed Operation",
      title: "Move AI from demonstration to accountable work.",
      summary: "Start with valuable decisions, connect governed data and build human oversight, integration and monitoring into the operating model.",
      ctaLabel: "Add AI & Data to Brief",
      sequence: ["VALUE", "DATA", "GUARDRAILS", "INTEGRATION", "MONITORING"],
      note: "Capability pathway only. This interface is not an AI assessor and does not generate or summarise customer content.",
      items: [
        { index: "AI1", kicker: "KNOWLEDGE", title: "Knowledge assistants", body: "Retrieve governed operational knowledge with sources and escalation." },
        { index: "AI2", kicker: "WORKFLOW", title: "Workflow automation", body: "Route repetitive decisions while preserving human authority." },
        { index: "AI3", kicker: "DECISION", title: "Decision support", body: "Expose signals, uncertainty and evidence at the moment of action." },
        { index: "AI4", kicker: "QUALITY", title: "Intelligent quality", body: "Use evaluation and anomaly signals to strengthen engineering feedback." },
        { index: "AI5", kicker: "CONTROL", title: "Governed retrieval", body: "Connect access, data lineage and policy to retrieval behaviour." },
        { index: "AI6", kicker: "OVERSIGHT", title: "Human-in-the-loop", body: "Define approval, exception handling and lifecycle responsibility." },
      ],
    },
  },
] as const;

export const PROJECT_OBJECTIVES = [
  { value: "launch", label: "Launch a new product or service" },
  { value: "modernise", label: "Modernise a critical system" },
  { value: "stabilise", label: "Stabilise delivery or quality" },
  { value: "secure", label: "Reduce security or governance risk" },
  { value: "scale", label: "Scale platforms and operations" },
  { value: "activate-data", label: "Put data or AI into operation" },
] as const;

export const EXPECTED_OUTCOMES = [
  { value: "faster-delivery", label: "Faster, safer delivery" },
  { value: "better-experience", label: "A stronger customer experience" },
  { value: "lower-risk", label: "Lower operational or regulatory risk" },
  { value: "greater-reliability", label: "Greater reliability and quality" },
  { value: "lower-cost", label: "Lower total cost of ownership" },
  { value: "new-capability", label: "A new digital capability" },
  { value: "trusted-insight", label: "Trusted data and decision support" },
] as const;

export const INITIATIVE_STAGES = [
  { value: "exploring", label: "Exploring the opportunity" },
  { value: "business-case", label: "Building the business case" },
  { value: "approved", label: "Approved and preparing to start" },
  { value: "rfp", label: "Formal procurement or RFP" },
  { value: "delivery", label: "Already in delivery" },
  { value: "live-improvement", label: "Improving a live system" },
] as const;

export const DELIVERY_CONTEXTS = [
  { value: "greenfield", label: "Greenfield build" },
  { value: "modernise", label: "Modernise an existing system" },
  { value: "replace", label: "Replace a legacy system" },
  { value: "integrate", label: "Integrate existing systems" },
  { value: "recover", label: "Recover or stabilise delivery" },
] as const;

export const IMPACT_SCOPES = [
  { value: "team", label: "One team or function" },
  { value: "department", label: "Multiple teams or a department" },
  { value: "enterprise", label: "Enterprise-wide" },
  { value: "customer", label: "Customer-facing or public service" },
  { value: "ecosystem", label: "Partners or a wider ecosystem" },
] as const;

export const TECHNICAL_DOMAINS = [
  { value: "web", label: "Web applications" },
  { value: "mobile", label: "Mobile applications" },
  { value: "apis", label: "APIs & integration" },
  { value: "data", label: "Data platforms" },
  { value: "ai", label: "AI / machine learning" },
  { value: "cloud", label: "Cloud infrastructure" },
  { value: "security", label: "Identity & security" },
  { value: "legacy", label: "Legacy / on-premise systems" },
] as const;

export const DEPLOYMENT_MODES = [
  { value: "cloud", label: "Public cloud" },
  { value: "hybrid", label: "Hybrid cloud" },
  { value: "on-premise", label: "On-premise" },
  { value: "multi-cloud", label: "Multi-cloud" },
  { value: "undecided", label: "Not decided" },
  { value: "not-sure", label: "Not sure" },
] as const;

export const COMPLIANCE_FRAMEWORKS = [
  { value: "uk-gdpr", label: "UK GDPR / EU GDPR" },
  { value: "iso-27001", label: "ISO 27001" },
  { value: "soc-2", label: "SOC 2" },
  { value: "pci-dss", label: "PCI DSS" },
  { value: "hipaa", label: "HIPAA" },
  { value: "fca", label: "FCA / financial services" },
  { value: "other", label: "Other or sector-specific" },
] as const;

export const ENGAGEMENT_MODELS = [
  { value: "discovery", label: "Discovery and definition" },
  { value: "project", label: "Defined project delivery" },
  { value: "team", label: "Embedded product or engineering team" },
  { value: "advisory", label: "Specialist advisory" },
  { value: "managed", label: "Managed service" },
  { value: "not-sure", label: "Not sure yet" },
] as const;

export const PROCUREMENT_STATES = [
  { value: "informal", label: "Informal market conversation" },
  { value: "approved", label: "Budget or sponsor approved" },
  { value: "quotes", label: "Gathering proposals or quotations" },
  { value: "rfp", label: "Formal RFP / tender" },
  { value: "framework", label: "Existing supplier framework" },
  { value: "not-sure", label: "Not sure" },
] as const;

export const TIMELINES = [
  { value: "0-4-weeks", label: "0–4 weeks" },
  { value: "1-3-months", label: "1–3 months" },
  { value: "3-6-months", label: "3–6 months" },
  { value: "6-12-months", label: "6–12 months" },
  { value: "12-plus-months", label: "More than 12 months" },
  { value: "target-date", label: "Specific target date" },
] as const;

export const BUDGET_BANDS = [
  { value: "under-50k", label: "Under 50k" },
  { value: "50-150k", label: "50–150k" },
  { value: "150-500k", label: "150–500k" },
  { value: "500k-1m", label: "500k–1m" },
  { value: "1m-plus", label: "1m+" },
] as const;

export const TECHNICAL_QUESTIONS: Readonly<Record<PlanetId, string>> = {
  TRANSFORM: "Is there an agreed target operating model?",
  BUILD: "Are the target architecture and core integrations understood?",
  EXPERIENCE: "Do you already have user research or a validated product proposition?",
  TEST: "Is automated quality assurance part of the current delivery pipeline?",
  DEPLOY: "Is an approved cloud landing zone already available?",
  PROTECT: "Has a recent security or information-governance assessment been completed?",
  OPERATE: "Are the required data sources accessible and governed?",
};

export const TECHNICAL_ANSWER_OPTIONS = [
  { value: "yes", label: "Yes" },
  { value: "partly", label: "Partly" },
  { value: "no", label: "No" },
  { value: "not-sure", label: "Not sure" },
] as const;

export const HELP_GOALS = [
  { value: "change-business", label: "Change how the business operates" },
  { value: "create-product", label: "Create or replace a digital product" },
  { value: "improve-delivery", label: "Improve engineering delivery" },
  { value: "control-risk", label: "Control risk and strengthen governance" },
  { value: "use-data", label: "Use data and AI more effectively" },
] as const;

export const HELP_ENVIRONMENTS = [
  { value: "legacy", label: "Legacy systems dominate" },
  { value: "mixed", label: "Mixed estate with many integrations" },
  { value: "cloud", label: "Mostly cloud-native" },
  { value: "product", label: "Customer-facing digital products" },
  { value: "data", label: "Data-rich but fragmented" },
  { value: "unknown", label: "Not sure yet" },
] as const;

export function getOrbitService(id: PlanetId): OrbitService {
  return ORBIT_SERVICES.find((service) => service.id === id)!;
}

export function getChoiceLabel(
  choices: readonly { value: string; label: string }[],
  value: string,
): string {
  return choices.find((choice) => choice.value === value)?.label ?? value;
}
