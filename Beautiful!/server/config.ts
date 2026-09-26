import "dotenv/config";

const nodeEnvironment = process.env.NODE_ENV ?? "development";
const production = nodeEnvironment === "production";

export const config = {
  nodeEnvironment,
  production,
  host: process.env.API_HOST ?? "0.0.0.0",
  port: Number(process.env.API_PORT ?? 4175),
  publicOrigin: process.env.PUBLIC_ORIGIN ?? "http://localhost:4174",
  privacyNoticeUrl: process.env.PRIVACY_NOTICE_URL ?? (production ? "" : "http://localhost:4174/privacy"),
  sessionHours: Number(process.env.SESSION_HOURS ?? 12),
  bookingUrl: process.env.BOOKING_URL ?? "",
  smtp: {
    host: process.env.SMTP_HOST ?? "",
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    user: process.env.SMTP_USER ?? "",
    password: process.env.SMTP_PASSWORD ?? "",
    from: process.env.SMTP_FROM ?? "e Gain Mission Control <mission-control@localhost>",
  },
};

export type AppConfig = typeof config;

/**
 * Vite's local handoff exposes the preview as `terminal.local` in Codex
 * desktop. It resolves to this machine during development, but has a
 * different Origin header from `localhost`, so it needs to be treated as a
 * local preview alias alongside the loopback hostnames.
 */
const LOCAL_PREVIEW_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "terminal.local"]);

/**
 * Production accepts only the configured canonical origin. Development also
 * treats the recognised local preview aliases as equivalent when protocol and
 * port match. This keeps the Codex browser handoff usable without weakening
 * the deployed Origin/CSRF boundary: production still accepts only the
 * configured canonical origin.
 */
export function isAllowedRequestOrigin(origin: string | undefined, appConfig: AppConfig): boolean {
  if (!origin) return false;
  if (origin === appConfig.publicOrigin) return true;
  if (appConfig.production) return false;
  try {
    const candidate = new URL(origin);
    const canonical = new URL(appConfig.publicOrigin);
    return candidate.protocol === canonical.protocol
      && candidate.port === canonical.port
      && LOCAL_PREVIEW_HOSTS.has(candidate.hostname)
      && LOCAL_PREVIEW_HOSTS.has(canonical.hostname);
  } catch {
    return false;
  }
}
