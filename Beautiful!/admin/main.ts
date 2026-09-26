import "@fontsource/manrope/400.css";
import "@fontsource/manrope/600.css";
import "@fontsource/manrope/700.css";
import "@fontsource/barlow-condensed/900.css";
import "./styles.css";
import { LEAD_PRIORITIES, LEAD_STATUSES, PLANET_LABELS, type LeadPriority, type LeadStatus } from "../shared/contracts.ts";
import { renderBriefText } from "../shared/brief.ts";

type Role = "ADMIN" | "SALES";
interface CurrentUser { id: string; email: string; name: string; role: Role; teamId: string | null; mustChangePassword: boolean }
interface LeadSummary {
  id: string; referenceCode: string; status: LeadStatus; priority: LeadPriority; primarySystem: keyof typeof PLANET_LABELS;
  selectedSystems: string[]; company: string; contactName: string; workEmail: string; timeline: string;
  assignedTeamId: string | null; assignedUserId: string | null; receivedAt: string; lastActivityAt: string; archivedAt: string | null; version: number;
}
interface SessionState { user: CurrentUser; csrfToken: string }

const root = document.querySelector<HTMLDivElement>("#admin-app")!;
let session: SessionState | null = null;
let activeView = location.hash.slice(1) || "overview";

function html(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" }[character]!));
}
function date(value: string | Date | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
function showToast(message: string, error = false): void {
  document.querySelector(".toast")?.remove();
  const toast = document.createElement("div");
  toast.className = `toast${error ? " error" : ""}`;
  toast.textContent = message;
  document.body.append(toast);
  setTimeout(() => toast.remove(), 4600);
}

class ApiError extends Error { constructor(message: string, readonly status: number, readonly body: Record<string, unknown>) { super(message); } }
async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  if (init.body) headers.set("content-type", "application/json");
  if (!["GET", "HEAD", "OPTIONS"].includes(method) && session?.csrfToken) headers.set("x-csrf-token", session.csrfToken);
  const response = await fetch(`/api/v1${path}`, { ...init, headers, credentials: "same-origin" });
  const body = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && !path.includes("/auth/login")) { session = null; renderLogin(); }
    throw new ApiError(String(body?.message ?? "Mission Control request failed."), response.status, body ?? {});
  }
  return body as T;
}

function renderLogin(message = ""): void {
  root.innerHTML = `<main class="auth-screen"><section class="auth-panel">
    <div class="auth-mark"><strong>e GAIN</strong><span class="eyebrow">SECURE INTERNAL SYSTEM</span></div>
    <div class="auth-copy"><span class="eyebrow">MISSION CONTROL / 01</span><h1>Operator Login</h1><p>Lead operations, routing and project intelligence.</p></div>
    <form class="auth-form" id="login-form">
      ${message ? `<div class="error-message">${html(message)}</div>` : ""}
      <label class="field"><span>Email</span><input name="email" type="email" autocomplete="username" value="admin@egain.local" required /></label>
      <label class="field"><span>Password</span><input name="password" type="password" autocomplete="current-password" value="1234" required /></label>
      <button class="button signal" type="submit">ESTABLISH SECURE LINK</button>
    </form>
    <a class="auth-return" href="/">RETURN TO PUBLIC EXPERIENCE</a>
  </section></main>`;
  document.querySelector<HTMLFormElement>("#login-form")!.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const button = form.querySelector<HTMLButtonElement>("button")!;
    button.disabled = true;
    try {
      const data = new FormData(form);
      session = await api<SessionState>("/auth/login", { method: "POST", body: JSON.stringify({ email: data.get("email"), password: data.get("password") }) });
      renderShell();
      await renderView();
    } catch (error) {
      renderLogin(error instanceof Error ? error.message : "Login failed.");
    }
  });
}

function renderInvite(token: string): void {
  root.innerHTML = `<main class="auth-screen"><section class="auth-panel">
    <div class="auth-mark"><strong>e GAIN</strong><span class="eyebrow">INVITATION</span></div>
    <div class="auth-copy"><span class="eyebrow">MISSION CONTROL / ACCESS</span><h1>Activate Account</h1><p>Create your operator credentials. Use at least 12 characters.</p></div>
    <form class="auth-form" id="invite-form">
      <label class="field"><span>Your name</span><input name="name" autocomplete="name" required /></label>
      <label class="field"><span>New password</span><input name="password" type="password" minlength="12" autocomplete="new-password" required /></label>
      <button class="button signal" type="submit">ACTIVATE ACCESS</button>
    </form>
    <a class="auth-return" href="/">RETURN TO PUBLIC EXPERIENCE</a>
  </section></main>`;
  document.querySelector<HTMLFormElement>("#invite-form")!.addEventListener("submit", async (event) => {
    event.preventDefault(); const data = new FormData(event.currentTarget as HTMLFormElement);
    try {
      await api("/auth/accept-invite", { method: "POST", body: JSON.stringify({ token, name: data.get("name"), password: data.get("password") }) });
      history.replaceState({}, "", "/admin/"); renderLogin("Account activated. Sign in with your new password.");
    } catch (error) { showToast(error instanceof Error ? error.message : "Activation failed.", true); }
  });
}

const navItems = [
  ["overview", "Overview", "OPERATIONS"], ["pipeline", "Pipeline", "OPERATIONS"], ["leads", "Leads", "OPERATIONS"],
  ["notifications", "Notifications", "ADMIN"], ["booking", "Booking & Privacy", "ADMIN"], ["users", "Teams & Users", "ADMIN"], ["audit", "Audit Log", "ADMIN"],
] as const;

function renderShell(): void {
  if (!session) return renderLogin();
  const visible = navItems.filter(([, , group]) => group !== "ADMIN" || session!.user.role === "ADMIN");
  let previousGroup = "";
  const nav = visible.map(([id, label, group]) => {
    const heading = group !== previousGroup ? `<div class="nav-label">${group}</div>` : ""; previousGroup = group;
    return `${heading}<button data-view="${id}" class="${activeView === id ? "active" : ""}">${label.toUpperCase()}</button>`;
  }).join("");
  root.innerHTML = `<div class="shell"><aside class="sidebar">
    <div class="brand"><strong>e GAIN</strong><span>MISSION CONTROL</span></div><nav class="nav">${nav}</nav>
    <div class="sidebar-user"><strong>${html(session.user.name)}</strong><span>${html(session.user.email)} · ${session.user.role}</span><button class="button ghost small" id="logout">DISCONNECT</button></div>
  </aside><section class="workspace"><header class="topbar"><h1 id="view-title">${html(activeView)}</h1><div class="link-state">SYSTEM ONLINE</div></header><main class="content" id="view"><div class="loading">RETRIEVING MISSION DATA</div></main></section></div>`;
  document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((button) => button.addEventListener("click", () => {
    activeView = button.dataset.view!; location.hash = activeView; renderShell(); void renderView();
  }));
  document.querySelector<HTMLButtonElement>("#logout")!.addEventListener("click", async () => {
    try { await api("/auth/logout", { method: "POST" }); } finally { session = null; renderLogin(); }
  });
}

function pageHead(kicker: string, title: string, description: string, actions = ""): string {
  return `<header class="page-head"><div><span class="eyebrow">${html(kicker)}</span><h2>${html(title)}</h2><p>${html(description)}</p></div>${actions ? `<div class="actions">${actions}</div>` : ""}</header>`;
}

async function renderOverview(): Promise<void> {
  const data = await api<{ totals: Record<string, number>; byStatus: Record<LeadStatus, number>; byPriority: Record<LeadPriority, number>; recent: LeadSummary[] }>("/admin/overview");
  const max = Math.max(1, ...Object.values(data.byStatus));
  view().innerHTML = `${session!.user.mustChangePassword ? `<div class="notice"><span>The local demonstration password is active. Change it before using real lead data.</span><button class="button small" id="change-password">CHANGE PASSWORD</button></div>` : ""}
    ${pageHead("OPERATIONS / LIVE", "Mission Overview", "A current read of project intake, ownership and pipeline movement.")}
    <div class="grid metrics">
      <div class="metric signal"><span>Active leads</span><strong>${data.totals.active}</strong></div>
      <div class="metric"><span>New / 7 days</span><strong>${data.totals.newLast7Days}</strong></div>
      <div class="metric"><span>Unassigned</span><strong>${data.totals.unassigned}</strong></div>
      <div class="metric"><span>Retention due</span><strong>${data.totals.retentionDueSoon}</strong></div>
      <div class="metric"><span>Mail failures</span><strong>${data.totals.failedOutbox}</strong></div>
    </div><div class="split"><section class="panel"><div class="panel-title"><h3>Pipeline Signal</h3><span>ACTIVE LEADS</span></div><div class="pipeline-bars">
      ${LEAD_STATUSES.map((status) => `<div class="bar-row"><span>${status}</span><div class="bar-track"><div class="bar-fill" style="width:${(data.byStatus[status] / max) * 100}%"></div></div><strong>${data.byStatus[status]}</strong></div>`).join("")}
    </div></section><section class="panel"><div class="panel-title"><h3>Priority Load</h3></div><div class="metrics grid" style="grid-template-columns:1fr">
      ${LEAD_PRIORITIES.map((priority) => `<div class="recipient"><span class="badge ${priority}">${priority}</span><strong>${data.byPriority[priority]}</strong></div>`).join("")}
    </div></section></div><section class="panel"><div class="panel-title"><h3>Latest Transmissions</h3><button class="button small" data-open-view="leads">VIEW ALL</button></div>${leadTable(data.recent)}</section>`;
  bindLeadRows();
  document.querySelector("[data-open-view='leads']")?.addEventListener("click", () => { activeView = "leads"; location.hash = activeView; renderShell(); void renderView(); });
  document.querySelector("#change-password")?.addEventListener("click", renderPasswordForm);
}

function leadTable(items: LeadSummary[]): string {
  if (!items.length) return `<div class="empty">NO LEADS MATCH THIS SIGNAL</div>`;
  return `<div class="table-wrap"><table><thead><tr><th>Reference</th><th>Company</th><th>System</th><th>Status</th><th>Priority</th><th>Timeline</th><th>Received</th></tr></thead><tbody>${items.map((lead) => `<tr data-lead-id="${lead.id}">
    <td class="ref">${html(lead.referenceCode)}</td><td><strong>${html(lead.company)}</strong><div class="muted">${html(lead.contactName)}</div></td>
    <td>${html(PLANET_LABELS[lead.primarySystem] ?? lead.primarySystem)}</td><td><span class="badge ${lead.status}">${lead.status}</span></td>
    <td><span class="badge ${lead.priority}">${lead.priority}</span></td><td>${html(lead.timeline)}</td><td>${date(lead.receivedAt)}</td></tr>`).join("")}</tbody></table></div>`;
}
function bindLeadRows(): void { document.querySelectorAll<HTMLElement>("[data-lead-id]").forEach((row) => row.addEventListener("click", () => void renderLeadDetail(row.dataset.leadId!))); }

async function fetchLeads(extra = ""): Promise<LeadSummary[]> {
  const response = await api<{ items: LeadSummary[] }>(`/admin/leads?pageSize=100${extra}`); return response.items;
}
async function renderLeads(): Promise<void> {
  const items = await fetchLeads();
  view().innerHTML = `${pageHead("PIPELINE / INDEX", "Lead Registry", "Search, triage and open a complete deterministic project brief.", session!.user.role === "ADMIN" ? `<a class="button" href="/api/v1/admin/leads/export.csv">EXPORT CSV</a>` : "")}
    <div class="filters"><input id="lead-search" placeholder="Reference, company or work email" /><select id="lead-status"><option value="">ALL STAGES</option>${LEAD_STATUSES.map((value) => `<option>${value}</option>`).join("")}</select><select id="lead-priority"><option value="">ALL PRIORITIES</option>${LEAD_PRIORITIES.map((value) => `<option>${value}</option>`).join("")}</select><button class="button" id="lead-filter">APPLY FILTER</button></div><div id="lead-results">${leadTable(items)}</div>`;
  bindLeadRows();
  document.querySelector("#lead-filter")!.addEventListener("click", async () => {
    const search = (document.querySelector<HTMLInputElement>("#lead-search")!).value;
    const status = (document.querySelector<HTMLSelectElement>("#lead-status")!).value;
    const priority = (document.querySelector<HTMLSelectElement>("#lead-priority")!).value;
    const filtered = await fetchLeads(`&search=${encodeURIComponent(search)}&status=${status}&priority=${priority}`);
    document.querySelector("#lead-results")!.innerHTML = leadTable(filtered); bindLeadRows();
  });
}

async function renderPipeline(): Promise<void> {
  const items = await fetchLeads();
  view().innerHTML = `${pageHead("PIPELINE / FLOW", "Opportunity Pipeline", "Stage is separate from assignment; open any visible lead to update it.")}
    <div class="kanban">${LEAD_STATUSES.map((status) => `<section class="kanban-column"><div class="kanban-head"><span>${status}</span><strong>${items.filter((lead) => lead.status === status).length}</strong></div><div class="kanban-list">${items.filter((lead) => lead.status === status).map((lead) => `<article class="lead-card" data-lead-id="${lead.id}"><span class="ref">${html(lead.referenceCode)}</span><strong>${html(lead.company)}</strong><span>${html(lead.timeline)} · ${lead.priority}</span></article>`).join("")}</div></section>`).join("")}</div>`;
  bindLeadRows();
}

async function renderLeadDetail(id: string): Promise<void> {
  const data = await api<{ lead: LeadSummary & { payload: Record<string, any>; brief: Record<string, any>; objective: string; executiveSummary: string; contactTitle: string; country: string; phone: string; retentionDueAt: string }; notes: Array<{ id: string; body: string; author: string; createdAt: string }>; owner: { name: string; email: string } | null }>(`/admin/leads/${id}`);
  const lead = data.lead; const brief = lead.brief;
  let assignmentOptions = "";
  if (session!.user.role === "ADMIN") {
    const directory = await api<{ users: Array<{ id: string; name: string; role: Role; teamId: string | null; active: boolean }> }>("/admin/users");
    assignmentOptions = `<option value="">UNASSIGNED</option>${directory.users.filter((user) => user.role === "SALES" && user.active && user.teamId === lead.assignedTeamId).map((user) => `<option value="${user.id}" ${user.id === lead.assignedUserId ? "selected" : ""}>${html(user.name)}</option>`).join("")}`;
  }
  view().innerHTML = `${pageHead("LEAD / DETAIL", lead.referenceCode, `${lead.company} · received ${date(lead.receivedAt)}`, `<button class="button" id="back-leads">BACK TO LEADS</button><button class="button" id="download-brief">DOWNLOAD BRIEF</button>`)}
    <div class="detail-grid"><section>
      <div class="facts"><div class="fact"><span>Primary system</span><strong>${html(PLANET_LABELS[lead.primarySystem])}</strong></div><div class="fact"><span>Priority</span><strong>${lead.priority}</strong></div><div class="fact"><span>Contact</span><strong>${html(lead.contactName)} · ${html(lead.contactTitle)}</strong></div><div class="fact"><span>Work email</span><strong>${html(lead.workEmail)}</strong></div><div class="fact"><span>Owner</span><strong>${html(data.owner?.name ?? "Unassigned team queue")}</strong></div><div class="fact"><span>Retention review</span><strong>${date(lead.retentionDueAt)}</strong></div></div>
      <section class="panel" style="margin-top:14px"><div class="panel-title"><h3>RULES_V1 Project Brief</h3><span>NO AI INFERENCE</span></div>
        <div class="brief-section"><h4>${html(brief.headline)}</h4><p>${html(brief.project.executiveSummary)}</p></div>
        <div class="brief-section"><h4>Selected systems</h4><p>${brief.systems.map((system: any) => `${system.primary ? "PRIMARY — " : ""}${system.label}`).map(html).join("<br>")}</p></div>
        <div class="brief-section"><h4>Outcome and current state</h4><p><strong>${html(brief.project.goal)}</strong>\n${html(brief.project.desiredOutcomes.join(" · "))}\n\n${html(brief.project.currentLandscape)}</p></div>
        <div class="brief-section"><h4>Delivery parameters</h4><p>${html(`${brief.delivery.engagementModel} · ${brief.delivery.timeframe} · ${brief.delivery.budget}`)}</p></div>
        <div class="brief-section"><h4>Discovery clarifications</h4><p>${html(brief.technical.clarifications.join("\n") || "None recorded")}</p></div>
      </section></section><aside>
        <section class="panel"><div class="panel-title"><h3>Lead Controls</h3></div><div class="form-row">
          <label class="field"><span>Pipeline stage</span><select id="detail-status">${LEAD_STATUSES.map((status) => `<option ${status === lead.status ? "selected" : ""}>${status}</option>`).join("")}</select></label>
          ${session!.user.role === "ADMIN" ? `<label class="field"><span>Priority</span><select id="detail-priority">${LEAD_PRIORITIES.map((priority) => `<option ${priority === lead.priority ? "selected" : ""}>${priority}</option>`).join("")}</select></label>` : ""}
        </div>${session!.user.role === "ADMIN" ? `<label class="field" style="margin-top:10px"><span>Owner</span><select id="detail-owner">${assignmentOptions}</select></label>` : ""}
        <div class="actions" style="margin-top:12px"><button class="button signal" id="save-lead">SAVE CHANGES</button>${!lead.assignedUserId ? `<button class="button" id="claim-lead">CLAIM</button>` : ""}${session!.user.role === "ADMIN" ? `<button class="button danger" id="archive-lead">${lead.archivedAt ? "RESTORE" : "ARCHIVE"}</button>` : ""}</div>
        ${session!.user.role === "ADMIN" ? `<div class="brief-section"><h4>Merge duplicate</h4><label class="field"><span>Duplicate reference</span><input id="merge-reference" placeholder="EGN-YYYYMMDD-XXXXXX" /></label><button class="button small" id="merge-lead" style="margin-top:8px">MERGE INTO THIS LEAD</button></div>` : ""}</section>
        <section class="panel"><div class="panel-title"><h3>Internal Notes</h3><span>${data.notes.length}</span></div><form id="note-form"><textarea name="body" maxlength="4000" placeholder="Record discovery context, action or handoff…" required></textarea><button class="button signal" type="submit" style="margin-top:8px">ADD NOTE</button></form><div class="notes">${data.notes.map((note) => `<article class="note"><p>${html(note.body)}</p><span>${html(note.author)} · ${date(note.createdAt)}</span></article>`).join("")}</div></section>
      </aside></div>`;
  document.querySelector("#back-leads")!.addEventListener("click", () => { activeView = "leads"; location.hash = activeView; renderShell(); void renderView(); });
  document.querySelector("#download-brief")!.addEventListener("click", () => {
    const blob = new Blob([renderBriefText(brief as any)], { type: "text/plain;charset=utf-8" }); const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob); anchor.download = `${lead.referenceCode}-brief.txt`; anchor.click(); URL.revokeObjectURL(anchor.href);
  });
  document.querySelector("#save-lead")!.addEventListener("click", async () => {
    const update: Record<string, unknown> = { version: lead.version, status: (document.querySelector<HTMLSelectElement>("#detail-status")!).value };
    if (session!.user.role === "ADMIN") { update.priority = (document.querySelector<HTMLSelectElement>("#detail-priority")!).value; update.assignedUserId = (document.querySelector<HTMLSelectElement>("#detail-owner")!).value || null; }
    try { await api(`/admin/leads/${id}`, { method: "PATCH", body: JSON.stringify(update) }); showToast("Lead controls updated."); await renderLeadDetail(id); } catch (error) { showToast(error instanceof Error ? error.message : "Update failed.", true); }
  });
  document.querySelector("#claim-lead")?.addEventListener("click", async () => { try { await api(`/admin/leads/${id}/claim`, { method: "POST" }); showToast("Lead claimed."); await renderLeadDetail(id); } catch (error) { showToast(error instanceof Error ? error.message : "Claim failed.", true); } });
  document.querySelector("#archive-lead")?.addEventListener("click", async () => { try { await api(`/admin/leads/${id}`, { method: "PATCH", body: JSON.stringify({ version: lead.version, archived: !lead.archivedAt }) }); showToast(lead.archivedAt ? "Lead restored." : "Lead archived."); await renderLeadDetail(id); } catch (error) { showToast(error instanceof Error ? error.message : "Archive failed.", true); } });
  document.querySelector("#merge-lead")?.addEventListener("click", async () => { const duplicateReference = document.querySelector<HTMLInputElement>("#merge-reference")!.value; if (!duplicateReference) return showToast("Enter the duplicate lead reference.", true); try { await api(`/admin/leads/${id}/merge`, { method: "POST", body: JSON.stringify({ duplicateReference }) }); showToast(`Duplicate ${duplicateReference.toUpperCase()} merged.`); await renderLeadDetail(id); } catch (error) { showToast(error instanceof Error ? error.message : "Merge failed.", true); } });
  document.querySelector<HTMLFormElement>("#note-form")!.addEventListener("submit", async (event) => { event.preventDefault(); const form = event.currentTarget as HTMLFormElement; try { await api(`/admin/leads/${id}/notes`, { method: "POST", body: JSON.stringify({ body: new FormData(form).get("body") }) }); showToast("Internal note added."); await renderLeadDetail(id); } catch (error) { showToast(error instanceof Error ? error.message : "Note failed.", true); } });
}

async function renderNotifications(): Promise<void> {
  const data = await api<{ recipients: Array<{ id: string; email: string; label: string; enabled: boolean }>; delivery: { configured: boolean; mode: string } }>("/admin/settings/notifications");
  view().innerHTML = `${pageHead("ADMIN / ROUTING", "Notification Settings", "Recipients are entered manually. SMTP credentials remain server-side and are never displayed.")}
    <section class="panel"><div class="panel-title"><h3>Add notification recipient</h3><span>${data.delivery.mode}</span></div><form id="recipient-form" class="settings-row"><label class="field"><span>Email</span><input name="email" type="email" placeholder="leads@company.com" required /></label><label class="field"><span>Label</span><input name="label" value="Lead notifications" required /></label><button class="button signal">ADD RECIPIENT</button></form></section>
    <section class="panel"><div class="panel-title"><h3>Routing list</h3><span>${data.recipients.length} RECIPIENTS</span></div>${data.recipients.length ? data.recipients.map((recipient) => `<div class="recipient" data-recipient="${recipient.id}"><div><strong>${html(recipient.email)}</strong><span>${html(recipient.label)}</span></div><div class="actions"><label class="toggle"><input type="checkbox" data-enable ${recipient.enabled ? "checked" : ""} /> ENABLED</label><button class="button small" data-test="${html(recipient.email)}">SEND TEST</button><button class="button small danger" data-remove>REMOVE</button></div></div>`).join("") : `<div class="empty">NO NOTIFICATION RECIPIENTS CONFIGURED</div>`}</section>`;
  document.querySelector<HTMLFormElement>("#recipient-form")!.addEventListener("submit", async (event) => { event.preventDefault(); const form = event.currentTarget as HTMLFormElement; const data = new FormData(form); try { await api("/admin/settings/notifications", { method: "POST", body: JSON.stringify({ email: data.get("email"), label: data.get("label") }) }); showToast("Notification recipient added."); await renderNotifications(); } catch (error) { showToast(error instanceof Error ? error.message : "Could not add recipient.", true); } });
  document.querySelectorAll<HTMLElement>("[data-recipient]").forEach((row) => {
    const id = row.dataset.recipient!;
    row.querySelector<HTMLInputElement>("[data-enable]")!.addEventListener("change", async (event) => { try { await api(`/admin/settings/notifications/${id}`, { method: "PATCH", body: JSON.stringify({ enabled: (event.currentTarget as HTMLInputElement).checked }) }); showToast("Routing state updated."); } catch (error) { showToast(error instanceof Error ? error.message : "Update failed.", true); } });
    row.querySelector("[data-remove]")!.addEventListener("click", async () => { try { await api(`/admin/settings/notifications/${id}`, { method: "DELETE" }); showToast("Recipient removed."); await renderNotifications(); } catch (error) { showToast(error instanceof Error ? error.message : "Remove failed.", true); } });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-test]").forEach((button) => button.addEventListener("click", async () => { button.disabled = true; try { const result = await api<{ status: string; simulated: boolean }>("/admin/settings/notifications/test", { method: "POST", body: JSON.stringify({ email: button.dataset.test }) }); showToast(result.simulated ? "Test processed by the local mail simulation." : `Test notification ${result.status.toLowerCase()}.`); } catch (error) { showToast(error instanceof Error ? error.message : "Test failed.", true); } finally { button.disabled = false; } }));
}

async function renderBooking(): Promise<void> {
  const data = await api<{ settings: Array<{ id: string; scope: string; scopeKey: string; url: string; enabled: boolean }>; privacyNoticeUrl: string }>("/admin/settings/booking");
  view().innerHTML = `${pageHead("ADMIN / DESTINATIONS", "Booking & Privacy", "Global booking URL with optional team and owner overrides. Production intake requires a published Privacy Notice.")}
    <section class="panel"><div class="panel-title"><h3>Booking destination</h3><span>OWNER → TEAM → GLOBAL</span></div><form id="booking-form" class="grid"><div class="form-row"><label class="field"><span>Scope</span><select name="scope"><option>GLOBAL</option><option>TEAM</option><option>OWNER</option></select></label><label class="field"><span>Scope key</span><input name="scopeKey" value="global" required /></label></div><label class="field"><span>External booking URL</span><input name="url" type="url" placeholder="https://calendar.example.com/discovery" required /></label><button class="button signal" style="justify-self:start">SAVE BOOKING ROUTE</button></form>${data.settings.map((setting) => `<div class="recipient"><div><strong>${html(setting.scope)} / ${html(setting.scopeKey)}</strong><span>${html(setting.url)}</span></div><span class="badge">${setting.enabled ? "ACTIVE" : "DISABLED"}</span></div>`).join("")}</section>
    <section class="panel"><div class="panel-title"><h3>Privacy Notice</h3><span>PUBLIC INTAKE GATE</span></div><form id="privacy-form" class="settings-row"><label class="field"><span>Published URL</span><input name="url" type="url" value="${html(data.privacyNoticeUrl)}" placeholder="https://company.com/privacy" required /></label><div></div><button class="button signal">SAVE NOTICE</button></form></section>`;
  document.querySelector<HTMLSelectElement>("[name='scope']")!.addEventListener("change", (event) => { const input = document.querySelector<HTMLInputElement>("[name='scopeKey']")!; if ((event.currentTarget as HTMLSelectElement).value === "GLOBAL") input.value = "global"; else if (input.value === "global") input.value = ""; });
  document.querySelector<HTMLFormElement>("#booking-form")!.addEventListener("submit", async (event) => { event.preventDefault(); const data = new FormData(event.currentTarget as HTMLFormElement); try { await api("/admin/settings/booking", { method: "PUT", body: JSON.stringify({ scope: data.get("scope"), scopeKey: data.get("scopeKey"), url: data.get("url"), enabled: true }) }); showToast("Booking route saved."); await renderBooking(); } catch (error) { showToast(error instanceof Error ? error.message : "Save failed.", true); } });
  document.querySelector<HTMLFormElement>("#privacy-form")!.addEventListener("submit", async (event) => { event.preventDefault(); const data = new FormData(event.currentTarget as HTMLFormElement); try { await api("/admin/settings/privacy", { method: "PUT", body: JSON.stringify({ url: data.get("url") }) }); showToast("Privacy Notice updated."); await renderBooking(); } catch (error) { showToast(error instanceof Error ? error.message : "Save failed.", true); } });
}

async function renderUsers(): Promise<void> {
  const data = await api<{ users: Array<{ id: string; name: string; email: string; role: Role; teamId: string | null; active: boolean; lastLoginAt: string | null }>; teams: Array<{ id: string; name: string }>; invitations: Array<{ id: string; email: string; role: Role; expiresAt: string; acceptedAt: string | null }> }>("/admin/users");
  view().innerHTML = `${pageHead("ADMIN / ACCESS", "Teams & Users", "Invite operators, place Sales users in capability teams and deactivate access.")}
    <section class="panel"><div class="panel-title"><h3>Invite operator</h3><span>72 HOUR TOKEN</span></div><form id="invite-user" class="settings-row"><label class="field"><span>Email</span><input name="email" type="email" required /></label><label class="field"><span>Role & team</span><select name="placement"><option value="ADMIN:">ADMIN</option>${data.teams.map((team) => `<option value="SALES:${team.id}">SALES — ${html(team.name)}</option>`).join("")}</select></label><button class="button signal">SEND INVITATION</button></form></section>
    <section class="panel"><div class="panel-title"><h3>Active directory</h3><span>${data.users.length} USERS</span></div>${data.users.map((user) => `<div class="recipient" data-user="${user.id}"><div><strong>${html(user.name)} · ${user.role}</strong><span>${html(user.email)} · ${html(user.teamId ?? "No team")} · Last login ${date(user.lastLoginAt)}</span></div><div class="actions"><span class="badge">${user.active ? "ACTIVE" : "INACTIVE"}</span>${user.id !== session!.user.id ? `<button class="button small ${user.active ? "danger" : ""}" data-toggle-user="${user.active ? "false" : "true"}">${user.active ? "DEACTIVATE" : "RESTORE"}</button>` : ""}</div></div>`).join("")}</section>
    <section class="panel"><div class="panel-title"><h3>Invitations</h3><span>${data.invitations.length}</span></div>${data.invitations.map((invite) => `<div class="recipient"><div><strong>${html(invite.email)} · ${invite.role}</strong><span>Expires ${date(invite.expiresAt)}</span></div><span class="badge">${invite.acceptedAt ? "ACCEPTED" : "PENDING"}</span></div>`).join("") || `<div class="empty">NO INVITATIONS</div>`}</section>`;
  document.querySelector<HTMLFormElement>("#invite-user")!.addEventListener("submit", async (event) => { event.preventDefault(); const data = new FormData(event.currentTarget as HTMLFormElement); const [role, teamId] = String(data.get("placement")).split(":"); try { const result = await api<{ localInviteUrl?: string }>("/admin/users/invitations", { method: "POST", body: JSON.stringify({ email: data.get("email"), role, teamId: teamId || null }) }); showToast(result.localInviteUrl ? `Invitation queued. Local activation link is in the API response.` : "Invitation queued."); await renderUsers(); } catch (error) { showToast(error instanceof Error ? error.message : "Invitation failed.", true); } });
  document.querySelectorAll<HTMLButtonElement>("[data-toggle-user]").forEach((button) => button.addEventListener("click", async () => { const id = button.closest<HTMLElement>("[data-user]")!.dataset.user; try { await api(`/admin/users/${id}`, { method: "PATCH", body: JSON.stringify({ active: button.dataset.toggleUser === "true" }) }); showToast("User access updated."); await renderUsers(); } catch (error) { showToast(error instanceof Error ? error.message : "Update failed.", true); } }));
}

async function renderAudit(): Promise<void> {
  const data = await api<{ events: Array<{ id: string; actorName: string | null; action: string; entityType: string; entityId: string; detail: Record<string, unknown>; createdAt: string }> }>("/admin/audit?limit=150");
  view().innerHTML = `${pageHead("ADMIN / EVIDENCE", "Audit Log", "Immutable operational events for login, routing, lead changes and configuration.")}
    <div class="table-wrap"><table><thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Entity</th><th>Detail</th></tr></thead><tbody>${data.events.map((event) => `<tr><td>${date(event.createdAt)}</td><td>${html(event.actorName ?? "System")}</td><td class="ref">${html(event.action)}</td><td>${html(event.entityType)} / ${html(event.entityId.slice(0, 12))}</td><td class="truncate">${html(JSON.stringify(event.detail))}</td></tr>`).join("")}</tbody></table></div>`;
}

function renderPasswordForm(): void {
  view().innerHTML = `${pageHead("SECURITY / CREDENTIALS", "Change Password", "Replace the local demonstration password with a private credential of at least 12 characters.")}
    <section class="panel" style="max-width:560px"><form id="password-form" class="grid"><label class="field"><span>Current password</span><input name="currentPassword" type="password" autocomplete="current-password" required /></label><label class="field"><span>New password</span><input name="newPassword" type="password" minlength="12" autocomplete="new-password" required /></label><button class="button signal" style="justify-self:start">UPDATE CREDENTIAL</button></form></section>`;
  document.querySelector<HTMLFormElement>("#password-form")!.addEventListener("submit", async (event) => { event.preventDefault(); const data = new FormData(event.currentTarget as HTMLFormElement); try { await api("/auth/change-password", { method: "POST", body: JSON.stringify({ currentPassword: data.get("currentPassword"), newPassword: data.get("newPassword") }) }); session!.user.mustChangePassword = false; showToast("Password updated."); await renderOverview(); } catch (error) { showToast(error instanceof Error ? error.message : "Password update failed.", true); } });
}

function view(): HTMLElement { return document.querySelector<HTMLElement>("#view")!; }
async function renderView(): Promise<void> {
  if (!session) return;
  const title = document.querySelector("#view-title"); if (title) title.textContent = activeView;
  try {
    if (activeView === "overview") await renderOverview();
    else if (activeView === "pipeline") await renderPipeline();
    else if (activeView === "leads") await renderLeads();
    else if (activeView === "notifications" && session.user.role === "ADMIN") await renderNotifications();
    else if (activeView === "booking" && session.user.role === "ADMIN") await renderBooking();
    else if (activeView === "users" && session.user.role === "ADMIN") await renderUsers();
    else if (activeView === "audit" && session.user.role === "ADMIN") await renderAudit();
    else { activeView = "overview"; renderShell(); await renderOverview(); }
  } catch (error) {
    if (session) view().innerHTML = `${pageHead("SYSTEM / ERROR", "Signal Interrupted", error instanceof Error ? error.message : "Mission Control could not load this view.")}<button class="button" id="retry">RETRY</button>`;
    document.querySelector("#retry")?.addEventListener("click", () => void renderView());
  }
}

window.addEventListener("hashchange", () => { if (!session) return; activeView = location.hash.slice(1) || "overview"; renderShell(); void renderView(); });

async function boot(): Promise<void> {
  const invite = new URLSearchParams(location.search).get("invite");
  if (invite) return renderInvite(invite);
  try { session = await api<SessionState>("/auth/me"); renderShell(); await renderView(); }
  catch { if (!session) renderLogin(); }
}
void boot();
