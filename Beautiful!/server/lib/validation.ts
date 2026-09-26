import type { ZodError } from "zod";

const STEP_BY_ROOT: Record<string, number> = {
  systems: 1,
  primarySystem: 1,
  outcome: 1,
  currentState: 2,
  technicalSignals: 2,
  delivery: 2,
  contact: 3,
  consent: 3,
};

export function validationErrorBody(error: ZodError) {
  const issues = error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
  const firstStep = Math.min(...error.issues.map((issue) => STEP_BY_ROOT[String(issue.path[0])] ?? 1));
  return {
    error: "VALIDATION_FAILED",
    message: "Review the highlighted mission details.",
    issues,
    firstStep,
  };
}

const DISPOSABLE_DOMAINS = new Set([
  "10minutemail.com", "guerrillamail.com", "mailinator.com", "temp-mail.org", "tempmail.com", "yopmail.com",
]);
const PERSONAL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "hotmail.com", "outlook.com", "live.com", "icloud.com", "yahoo.com", "proton.me", "protonmail.com",
]);

export function inspectWorkEmail(email: string): { disposable: boolean; personal: boolean } {
  const domain = email.split("@").at(-1)?.toLowerCase() ?? "";
  return { disposable: DISPOSABLE_DOMAINS.has(domain), personal: PERSONAL_DOMAINS.has(domain) };
}
