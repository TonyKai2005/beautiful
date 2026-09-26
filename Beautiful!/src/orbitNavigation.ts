import type { PlanetId } from "../shared/contracts";
import type { OrbitDestination, OrbitDestinationItem } from "./projectOrbitContent";

/**
 * Public-facing Orbit destinations. These are intentionally independent from
 * PlanetId: a navigation world is not automatically a lead capability.
 */
export const ORBIT_WORLD_IDS = [
  "about",
  "services",
  "solution",
  "work-flow",
  "technology-stack",
  "tools",
  "products",
  "clients",
  "why-axsai",
  "blog",
  "contact",
] as const;

export type OrbitWorldId = (typeof ORBIT_WORLD_IDS)[number];

/** The seven approved Blender asset families. No extra navigation GLBs are required. */
export const ORBIT_MODEL_FAMILIES = [
  "transform",
  "build",
  "experience",
  "test",
  "deploy",
  "protect",
  "operate",
] as const;

export type OrbitModelFamilyId = (typeof ORBIT_MODEL_FAMILIES)[number];
export type OrbitWorldAction = "browse" | "brief" | "contact";

export interface OrbitNavigationWorld {
  id: OrbitWorldId;
  index: string;
  label: string;
  subtitle: string;
  modelFamily: OrbitModelFamilyId;
  /** Only used when a world deliberately opens the existing lead flow. */
  leadSystem?: PlanetId;
  /** Full AXSAI source page used by worlds with no second-level navigation. */
  detailId?: string;
  action: OrbitWorldAction;
  destination: OrbitDestination;
}

const item = (
  index: string,
  kicker: string,
  title: string,
  body: string,
  signal?: string,
): OrbitDestinationItem => ({ index, kicker, title, body, signal });

export const ORBIT_NAVIGATION_WORLDS: readonly OrbitNavigationWorld[] = [
  {
    id: "about",
    index: "01",
    label: "About Us",
    subtitle: "Identity, values and the people behind the work.",
    modelFamily: "transform",
    action: "browse",
    destination: {
      kind: "brief",
      label: "About Us",
      eyebrow: "Identity / Operating Principles",
      title: "The people, standards and intent behind every engagement.",
      summary: "Explore the company story, its direction, the people involved and the quality principles used to keep work accountable.",
      ctaLabel: "Initiate A Project",
      items: [
        item("01", "ABOUT US", "Who we are", "A practical technology team shaped around business change, delivery clarity and long-term operating ownership."),
        item("02", "ABOUT US", "Vision and Values", "Keep decisions clear, make technology useful and connect delivery activity to the outcomes people can operate."),
        item("03", "ABOUT US", "Our People", "Bring product, engineering, quality, cloud, data and governance perspectives into one coordinated delivery conversation."),
        item("04", "ABOUT US", "Quality", "Use review, validation and clear ownership to ensure quality remains visible through the work."),
        item("05", "ABOUT US", "Our Clients", "See the client and industry view for approved information about the organisations and sectors represented here."),
      ],
    },
  },
  {
    id: "services",
    index: "02",
    label: "Services",
    subtitle: "Application, cloud, data and delivery capability.",
    modelFamily: "build",
    leadSystem: "BUILD",
    action: "brief",
    destination: {
      kind: "tools",
      label: "Technology Services",
      eyebrow: "Services / Technology Delivery",
      title: "Technology services built around your business.",
      summary: "From applications and mobile products to cloud, data, AI and operating improvement, choose the capability area that best frames the work ahead.",
      ctaLabel: "Add Services To Project Brief",
      note: "Technology names are capability references, not vendor partnership or certification claims.",
      items: [
        item("01", "SERVICES", "Application Development", "Create web, mobile and cloud applications that fit the way an organisation works.", "DIGITAL PRODUCTS"),
        item("02", "SERVICES", "Application Maintenance and Support", "Stabilise, support and continuously improve the systems teams and customers rely on.", "LIVE SYSTEMS"),
        item("03", "SERVICES", "Independent Validation & Testing", "Use focused testing and quality assurance to make releases more dependable.", "QUALITY ASSURANCE"),
        item("04", "SERVICES", "Mobile App Development", "Design useful mobile experiences for customers, field teams and day-to-day operations.", "MOBILE EXPERIENCE"),
        item("05", "SERVICES", "Artificial Intelligence", "Use automation, machine learning and data-led insight where they create practical value.", "APPLIED AI"),
        item("06", "SERVICES", "AWS Migration", "Plan migration, transition and operational readiness through a disciplined delivery path.", "CLOUD TRANSITION"),
        item("07", "SERVICES", "Dev-Ops", "Connect engineering, automation, release practices and operational ownership.", "DELIVERY SYSTEM"),
        item("08", "SERVICES", "Big Data Analytics", "Bring complex information together to reveal performance, opportunity and the next decision.", "DATA INSIGHT"),
        item("09", "SERVICES", "Cloud Automation and Hosting", "Create dependable environments through automation, hosting and practical operational ownership.", "PLATFORM OPERATIONS"),
        item("10", "SERVICES", "Business Transformation", "Align technology change with the operating improvements an organisation needs to make.", "CHANGE PROGRAMME"),
        item("11", "SERVICES", "Data-Led Digital Transformation", "Use connected data, digital services and delivery insight to shape the next stage.", "DIGITAL CHANGE"),
      ],
    },
  },
  {
    id: "solution",
    index: "03",
    label: "Solution",
    subtitle: "Focused digital solutions for operating needs.",
    modelFamily: "experience",
    action: "browse",
    destination: {
      kind: "cases",
      label: "Solutions",
      eyebrow: "Solution Portfolio / Product Thinking",
      title: "Focused systems for recurring operating problems.",
      summary: "Explore the named solution directions from the existing portfolio. Each is presented as a starting point for a discovery conversation, not a one-size-fits-all promise.",
      ctaLabel: "Discuss A Solution",
      items: [
        item("01", "SOLUTION", "Akin", "A direction for creating clearer digital journeys across customer-facing services and workflows."),
        item("02", "SOLUTION", "Nimos", "A direction for bringing operational requests, visibility and coordination into one purposeful system."),
        item("03", "SOLUTION", "Minerva 365", "A direction for improving the way teams organise work, information and accountable follow-through."),
      ],
    },
  },
  {
    id: "work-flow",
    index: "04",
    label: "Work Flow",
    subtitle: "Estimate, assign, communicate and track delivery.",
    modelFamily: "deploy",
    leadSystem: "DEPLOY",
    action: "brief",
    destination: {
      kind: "method",
      label: "Project Work Flow",
      eyebrow: "Delivery Control / Shared Visibility",
      title: "A transparent way to move work forward.",
      summary: "Make scope, ownership, communication and progress visible from the first estimate through to the next delivery decision.",
      ctaLabel: "Add Work Flow To Project Brief",
      items: [
        item("01", "WORK FLOW", "Estimate the Job", "Bring objectives, dependencies, delivery pressure and practical effort into one shared starting point."),
        item("02", "WORK FLOW", "Team assignment", "Connect the right delivery roles to the work and keep responsibility visible as it moves."),
        item("03", "WORK FLOW", "Communication within the team", "Create a structured route for decisions, questions, risks and hand-offs across the delivery team."),
        item("04", "WORK FLOW", "Track the Progress", "Make progress, blockers and the next operating decision visible without relying on disconnected status updates."),
      ],
    },
  },
  {
    id: "technology-stack",
    index: "05",
    label: "Technology Stack",
    subtitle: "Technology choices arranged around delivery needs.",
    modelFamily: "operate",
    action: "browse",
    destination: {
      kind: "ai",
      label: "Technology Stack",
      eyebrow: "Architecture / Engineering Ecosystem",
      title: "Choose technology in service of the operating system.",
      summary: "The stack is organised into capability groups rather than presented as a wall of logos or implied affiliations.",
      ctaLabel: "Discuss Your Technology Context",
      items: [
        item("01", "TECHNOLOGY STACK", "Mern", "Node, React JS and Express arranged as a modern JavaScript application delivery group."),
        item("02", "TECHNOLOGY STACK", "Node", "A server-side JavaScript reference within the Mern delivery group."),
        item("03", "TECHNOLOGY STACK", "React JS", "A frontend application reference within the Mern delivery group."),
        item("04", "TECHNOLOGY STACK", "Express", "A service-layer reference within the Mern delivery group."),
        item("05", "TECHNOLOGY STACK", "Php", "PHP, Symfony, WordPress and Magento for environments where those technologies are the right fit."),
        item("06", "TECHNOLOGY STACK", "Symfony", "A PHP framework reference for structured application delivery."),
        item("07", "TECHNOLOGY STACK", "WordPress", "A content platform reference for the appropriate operating context."),
        item("08", "TECHNOLOGY STACK", "Magento", "A commerce platform reference for the appropriate operating context."),
        item("09", "TECHNOLOGY STACK", "Mobile", "Swift, React Native and Kotlin for mobile experiences shaped around users, devices and service context."),
        item("10", "TECHNOLOGY STACK", "Swift", "A native iOS delivery reference."),
        item("11", "TECHNOLOGY STACK", "React Native", "A cross-platform mobile delivery reference."),
        item("12", "TECHNOLOGY STACK", "Kotlin", "A native Android delivery reference."),
        item("13", "TECHNOLOGY STACK", "DevOps", "Jenkins, cloud infrastructure, Docker and deployment automation as practical engineering references."),
        item("14", "TECHNOLOGY STACK", "Jenkins", "An automation and integration reference for delivery systems."),
        item("15", "TECHNOLOGY STACK", "Amazon Web Services", "A cloud infrastructure reference where it fits the technology context."),
        item("16", "TECHNOLOGY STACK", "Docker", "A containerisation reference for delivery environments."),
        item("17", "TECHNOLOGY STACK", "Vibrant", "An existing navigation label retained exactly as it appears in the source structure."),
      ],
    },
  },
  {
    id: "tools",
    index: "06",
    label: "Tools",
    subtitle: "Design, collaboration and engineering workspaces.",
    modelFamily: "test",
    action: "browse",
    destination: {
      kind: "reliability",
      label: "Delivery Tools",
      eyebrow: "Collaboration / Design / Engineering",
      title: "A practical toolchain for work that stays connected.",
      summary: "These are familiar workflow environments used to support communication, planning, design, engineering and knowledge-sharing. No partnership is implied.",
      ctaLabel: "Discuss Your Working Environment",
      items: [
        item("01", "TOOLS", "Slack", "A communication workspace reference for focused team coordination."),
        item("02", "TOOLS", "Jira Software", "A work-tracking reference for organising delivery, decisions and progress."),
        item("03", "TOOLS", "Zeplin", "A design handoff reference for connecting interface intent to implementation."),
        item("04", "TOOLS", "Figma", "A collaborative design reference for interface, prototype and system work."),
        item("05", "TOOLS", "Github", "A source-control reference for engineering collaboration and review."),
        item("06", "TOOLS", "Bitbucket", "A repository and delivery reference for teams working within that ecosystem."),
        item("07", "TOOLS", "Confluence", "A documentation reference for maintaining context, decisions and shared knowledge."),
      ],
    },
  },
  {
    id: "products",
    index: "07",
    label: "Our Products",
    subtitle: "Ready product directions for common operating needs.",
    modelFamily: "build",
    leadSystem: "BUILD",
    detailId: "products",
    action: "brief",
    destination: {
      kind: "tools",
      label: "Product Directions",
      eyebrow: "Ready Product / Configurable Foundation",
      title: "Starting points for systems that need to become operational quickly.",
      summary: "Product directions can accelerate discovery, but each still requires a clear fit with process, data, governance and operating context.",
      ctaLabel: "Discuss A Product Implementation",
      items: [
        item("01", "PEOPLE", "Recruitment CRM", "A recruitment and candidate-relationship direction for teams managing people pipelines."),
        item("02", "COMMERCE", "Multi-vendor commerce", "A commerce direction for environments coordinating multiple sellers, products and fulfilment paths."),
        item("03", "OPERATIONS", "Food and delivery", "A delivery and ordering direction for service operations with time-sensitive coordination."),
        item("04", "ENTERPRISE", "Industry ERP", "ERP directions for hospital, travel and education operating environments."),
        item("05", "ASSESSMENT", "Online examination", "A structured assessment direction for controlled digital examination journeys."),
        item("06", "LEARNING", "Learning management", "A learning direction for content, progress and learner administration."),
        item("07", "TRANSACTION", "Point of sale", "A point-of-sale direction for transaction and front-of-house operational workflows."),
        item("08", "PROPERTY", "Property listing", "A property direction for listing, enquiry and catalogue-style customer journeys."),
      ],
    },
  },
  {
    id: "clients",
    index: "08",
    label: "Our Clients",
    subtitle: "Industry context and approved relationship evidence.",
    modelFamily: "experience",
    detailId: "clients",
    action: "browse",
    destination: {
      kind: "cases",
      label: "Our Clients",
      eyebrow: "Relationship Evidence / Approved Information",
      title: "Client context should be represented with care.",
      summary: "This world is reserved for verified client and industry material. It does not fabricate client identities, logos, partnership claims or measured outcomes.",
      ctaLabel: "Start A Conversation",
      note: "Only approved source material is published here. Unverified material remains anonymous and non-quantified.",
      items: [
        item("01", "INDUSTRY", "Digital services", "A view of how product, platform and customer-facing services can be shaped around operating needs."),
        item("02", "INDUSTRY", "Operations", "A view of systems that connect field work, knowledge, coordination and visible follow-through."),
        item("03", "INDUSTRY", "Regulated environments", "A view of change where quality, traceability, privacy and controlled delivery matter."),
      ],
    },
  },
  {
    id: "why-axsai",
    index: "09",
    label: "Why Axsai",
    subtitle: "Strategic participation, quality and accountable delivery.",
    modelFamily: "protect",
    detailId: "why-axsai",
    action: "browse",
    destination: {
      kind: "governance",
      label: "Why Axsai",
      eyebrow: "Working Principles / Delivery Relationship",
      title: "Technology work is stronger when responsibility stays visible.",
      summary: "This world explains the working principles behind strategic engagement, quality, open communication and lasting delivery relationships.",
      ctaLabel: "Initiate A Project",
      items: [
        item("01", "STRATEGY", "Connect work to the operating question", "Start with what needs to change and keep decisions tied to practical outcomes."),
        item("02", "ENGAGEMENT", "Work as an accountable delivery partner", "Make ownership, communication and next decisions visible across the engagement."),
        item("03", "QUALITY", "Build evidence into the work", "Treat quality and validation as part of delivery rather than a late-stage promise."),
        item("04", "RELATIONSHIP", "Create a stronger long-term operating position", "Leave teams with clearer systems, knowledge and ownership than they started with."),
      ],
    },
  },
  {
    id: "blog",
    index: "10",
    label: "Blog",
    subtitle: "Technology and delivery insight.",
    modelFamily: "operate",
    detailId: "blog",
    action: "browse",
    destination: {
      kind: "ai",
      label: "Blog",
      eyebrow: "Knowledge Signal / Engineering Insight",
      title: "Practical insight for technology decisions in motion.",
      summary: "Browse the existing editorial directions around AI, cloud migration, mobile platforms and digital delivery. Articles remain content, not performance claims.",
      ctaLabel: "Start A Conversation",
      items: [
        item("01", "AI", "Applied intelligence", "How organisations can approach AI as a practical capability with human ownership and useful guardrails."),
        item("02", "CLOUD", "Migration with an operating plan", "How migration can connect discovery, transition, continuity and post-release responsibility."),
        item("03", "MOBILE", "Platforms that meet people where work happens", "How mobile technology can support customers, service teams and field operations."),
      ],
    },
  },
  {
    id: "contact",
    index: "11",
    label: "Contact Us",
    subtitle: "Open a clear route into the right conversation.",
    modelFamily: "transform",
    detailId: "contact",
    action: "contact",
    destination: {
      kind: "brief",
      label: "Contact Us",
      eyebrow: "Connection / Project Brief",
      title: "Start with the outcome you need to move.",
      summary: "Send a concise project brief, explain the current pressure and choose the right place to begin. Technical discovery can follow with the right people involved.",
      ctaLabel: "Open Project Brief",
      note: "Do not include passwords, API keys or sensitive personal information in the initial message.",
      items: [
        item("01", "PROJECT", "Tell us what needs to change", "Share the outcome, the current context and the practical timing that matters."),
        item("02", "CONNECTION", "Identify the right working conversation", "Provide your name, organisation and work contact details so the right team can respond."),
        item("03", "PRIVACY", "Keep the initial signal appropriate", "Contact consent and privacy information remain visible before a brief is transmitted."),
      ],
    },
  },
] as const;

export function getOrbitNavigationWorld(id: OrbitWorldId): OrbitNavigationWorld {
  return ORBIT_NAVIGATION_WORLDS.find((world) => world.id === id)!;
}
