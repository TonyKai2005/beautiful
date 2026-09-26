import "./project-orbit.css";

import type {
  ApiErrorBody,
  CreateLeadResponse,
  OrbitPresentationState,
  SceneMode,
} from "../shared/contracts";
import {
  BUDGET_BANDS,
  DELIVERY_CONTEXTS,
  ENGAGEMENT_MODELS,
  EXPECTED_OUTCOMES,
  HELP_ENVIRONMENTS,
  HELP_GOALS,
  IMPACT_SCOPES,
  INITIATIVE_STAGES,
  ORBIT_SERVICES,
  PROCUREMENT_STATES,
  PROJECT_OBJECTIVES,
  TIMELINES,
  getChoiceLabel,
  getOrbitService,
  type PlanetId,
} from "./projectOrbitContent";
import {
  briefToText,
  buildLeadSubmissionRequest,
  clearDiagnosticDraft,
  createInitialDiagnosticDraft,
  isPersonalEmail,
  loadDiagnosticDraft,
  recommendSystems,
  saveDiagnosticDraft,
  stepForApiPath,
  validateDiagnostic,
  validateDiagnosticStep,
  type DiagnosticDraft,
  type DiagnosticStep,
  type HelpMeChooseAnswers,
  type SystemRecommendation,
} from "./diagnostic";

export type { OrbitPresentationState } from "../shared/contracts";
export type { PlanetId } from "./projectOrbitContent";

export interface ProjectOrbitFlowOpenOptions {
  selectedSystems?: PlanetId[];
  primarySystem?: PlanetId | null;
}

export interface ProjectOrbitFlowOptions {
  mount: HTMLElement;
  apiBaseUrl?: string;
  privacyNoticeUrl?: string;
  privacyVersion?: string;
  fallbackBookingUrl?: string;
  onPresentationStateChange?: (state: OrbitPresentationState) => void;
  onOpen?: () => void;
  onClose?: () => void;
}

const STEP_TITLES: Readonly<Record<DiagnosticStep, { label: string; title: string; hint: string }>> = {
  1: {
    label: "Vector",
    title: "Define the mission vector.",
    hint: "Lock the right systems, the outcome and one concise project signal.",
  },
  2: {
    label: "Envelope",
    title: "Set the reality around it.",
    hint: "Give us enough operating and delivery context to make the first conversation useful.",
  },
  3: {
    label: "Transmit",
    title: "Identify. Review. Transmit.",
    hint: "Confirm the project signal and tell us who should lead the conversation.",
  },
};

const MAX_ARRAY_SELECTIONS: Readonly<Record<string, number>> = {
  "outcome.expectedOutcomes": 3,
};

const DIAGNOSTIC_STEPS: readonly DiagnosticStep[] = [1, 2, 3];

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function selectedAttribute(selected: boolean): string {
  return selected ? " selected" : "";
}

function checkedAttribute(checked: boolean): string {
  return checked ? " checked" : "";
}

function disabledAttribute(disabled: boolean): string {
  return disabled ? " disabled" : "";
}

function renderOptions(
  options: readonly { value: string; label: string }[],
  selected: string,
  placeholder = "Select one",
): string {
  return [
    `<option value="">${escapeHtml(placeholder)}</option>`,
    ...options.map(
      (option) => `<option value="${escapeHtml(option.value)}"${selectedAttribute(option.value === selected)}>${escapeHtml(option.label)}</option>`,
    ),
  ].join("");
}

function listLabels(values: string[], choices: readonly { value: string; label: string }[]): string {
  return values.length ? values.map((value) => getChoiceLabel(choices, value)).join(", ") : "Not provided";
}

function safeLink(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, window.location.origin);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

function parseRetrySeconds(response: Response, body: ApiErrorBody | null): number {
  const retryAfter = response.headers.get("Retry-After");
  const headerSeconds = retryAfter ? Number.parseInt(retryAfter, 10) : Number.NaN;
  if (Number.isFinite(headerSeconds) && headerSeconds > 0) return headerSeconds;
  if (body?.retryAfterSeconds && body.retryAfterSeconds > 0) return body.retryAfterSeconds;
  return 30;
}

export class ProjectOrbitFlow {
  readonly element: HTMLElement;

  private readonly options: ProjectOrbitFlowOptions;
  private draft: DiagnosticDraft = createInitialDiagnosticDraft();
  private recoveryDraft: DiagnosticDraft | null = null;
  private errors: Record<string, string> = {};
  private dirty = false;
  private opened = false;
  private submitting = false;
  private submitMessage = "";
  private receipt: CreateLeadResponse | null = null;
  private saveTimer: number | null = null;
  private retryTimer: number | null = null;
  private retryUntil = 0;
  private activeRequest: AbortController | null = null;
  private helpOpen = false;
  private helpAnswers: HelpMeChooseAnswers = { goal: "", outcomes: [], environment: "" };
  private recommendation: SystemRecommendation | null = null;
  private helpError = "";
  private previousBodyOverflow = "";
  private previousBodyOverscroll = "";
  private triggerElement: HTMLElement | null = null;
  private initialOpenOptions: ProjectOrbitFlowOpenOptions = {};
  private editReturnFromStep: DiagnosticStep | null = null;
  private focusedSystem: PlanetId | null = null;

  constructor(options: ProjectOrbitFlowOptions) {
    this.options = options;
    this.element = document.createElement("section");
    this.element.className = "project-orbit-flow";
    this.element.hidden = true;
    this.element.dataset.open = "false";
    this.element.setAttribute("aria-label", "Project Orbit diagnostic");
    options.mount.append(this.element);
    this.renderShell();
    this.element.addEventListener("click", this.handleClick);
    this.element.addEventListener("input", this.handleInput);
    this.element.addEventListener("change", this.handleChange);
    this.element.addEventListener("keydown", this.handleKeydown);
  }

  get isOpen(): boolean {
    return this.opened;
  }

  getPresentationState(mode: SceneMode = this.receipt ? "RECEIVED" : "MISSION_DECK"): OrbitPresentationState {
    return {
      mode,
      focusedPlanet: this.focusedSystem ?? this.draft.data.primarySystem ?? this.draft.data.systems[0] ?? null,
      selectedPlanets: [...this.draft.data.systems],
      primaryPlanet: this.draft.data.primarySystem,
      completedSteps: [...this.draft.completedSteps],
    };
  }

  open(openOptions: ProjectOrbitFlowOpenOptions = {}): void {
    if (this.opened) return;

    this.triggerElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.receipt = null;
    this.submitMessage = "";
    this.errors = {};
    this.editReturnFromStep = null;
    this.initialOpenOptions = {
      selectedSystems: openOptions.selectedSystems ? [...openOptions.selectedSystems] : undefined,
      primarySystem: openOptions.primarySystem,
    };
    const stored = loadDiagnosticDraft();
    this.recoveryDraft = stored.draft;
    this.draft = createInitialDiagnosticDraft();
    this.applyInitialSystems(openOptions);
    this.dirty = false;
    this.opened = true;
    this.element.hidden = false;
    this.element.dataset.open = "true";
    this.element.dataset.view = "deck";
    this.previousBodyOverflow = document.body.style.overflow;
    this.previousBodyOverscroll = document.body.style.overscrollBehavior;
    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";
    this.renderStep();

    if (this.recoveryDraft) {
      this.renderRecoveryDialog();
    } else {
      this.closeModal();
      this.focusHeading();
    }

    if (stored.expired) this.announce("The previous mission draft expired after 24 hours. A new mission has started.");
    this.emitPresentationState("MISSION_DECK");
    this.options.onOpen?.();
  }

  close(force = false): boolean {
    if (!this.opened) return true;
    if (!force && this.dirty && !this.receipt) {
      this.renderExitDialog();
      return false;
    }
    this.finishClose();
    return true;
  }

  setSelectedSystems(systems: PlanetId[], primarySystem: PlanetId | null = null): void {
    const allowed = systems.filter((system, index) => ORBIT_SERVICES.some((service) => service.id === system) && systems.indexOf(system) === index).slice(0, 3);
    this.draft.data.systems = allowed;
    this.draft.data.primarySystem = primarySystem && allowed.includes(primarySystem)
      ? primarySystem
      : allowed.length === 1
        ? allowed[0]
        : null;
    this.focusedSystem = this.draft.data.primarySystem ?? allowed[0] ?? null;
    this.markDirty();
    if (this.opened && this.draft.currentStep === 1) this.renderStep();
    this.emitPresentationState("MISSION_DECK");
  }

  focusSystem(system: PlanetId | null): void {
    if (system !== null && !ORBIT_SERVICES.some((service) => service.id === system)) return;
    this.focusedSystem = system;
    this.emitPresentationState(this.receipt ? "RECEIVED" : this.opened ? "MISSION_DECK" : "ORBIT_FOCUS");
  }

  async submitMission(): Promise<void> {
    await this.submit();
  }

  destroy(): void {
    this.activeRequest?.abort();
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    if (this.retryTimer !== null) window.clearInterval(this.retryTimer);
    if (this.opened) this.finishClose();
    this.element.removeEventListener("click", this.handleClick);
    this.element.removeEventListener("input", this.handleInput);
    this.element.removeEventListener("change", this.handleChange);
    this.element.removeEventListener("keydown", this.handleKeydown);
    this.element.remove();
  }

  private applyInitialSystems(openOptions: ProjectOrbitFlowOpenOptions): void {
    const systems = openOptions.selectedSystems?.filter(
      (system, index, values) => ORBIT_SERVICES.some((service) => service.id === system) && values.indexOf(system) === index,
    ).slice(0, 3) ?? [];
    this.draft.data.systems = systems;
    this.draft.data.primarySystem = openOptions.primarySystem && systems.includes(openOptions.primarySystem)
      ? openOptions.primarySystem
      : systems.length === 1
        ? systems[0]
        : null;
    this.focusedSystem = this.draft.data.primarySystem ?? systems[0] ?? null;
  }

  private renderShell(): void {
    this.element.innerHTML = `
      <div class="orbit-deck" role="dialog" aria-modal="true" aria-labelledby="orbit-step-title">
        <div class="orbit-deck__signal" aria-hidden="true"></div>
        <header class="orbit-deck__header">
          <div class="orbit-deck__brand">
            <span class="orbit-deck__brand-mark">e</span>
            <span><strong>PROJECT ORBIT</strong><small>ENTERPRISE MISSION DECK</small></span>
          </div>
          <div class="orbit-deck__telemetry" aria-hidden="true">
            <span>LINK / SECURE</span><span>SYS / 07</span><span class="orbit-deck__pulse">LIVE</span>
          </div>
          <button class="orbit-icon-button" type="button" data-action="close" aria-label="Exit Project Orbit">
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <nav class="orbit-progress" aria-label="Diagnostic progress" data-progress></nav>
        <main class="orbit-deck__main" data-step-content></main>
        <footer class="orbit-deck__footer" data-footer></footer>
        <div class="orbit-live-region sr-only" aria-live="polite" data-live></div>
      </div>
      <div class="orbit-modal-layer" data-modal-layer hidden></div>
    `;
  }

  private renderStep(): void {
    if (this.receipt) {
      this.renderReceipt();
      return;
    }

    this.element.dataset.view = "deck";
    this.renderProgress();
    const content = this.element.querySelector<HTMLElement>("[data-step-content]");
    if (!content) return;
    const meta = STEP_TITLES[this.draft.currentStep];
    content.innerHTML = `
      <div class="orbit-step orbit-step--${meta.label.toLowerCase()}">
        <div class="orbit-step__intro">
          <p class="orbit-eyebrow">0${this.draft.currentStep} / 03 &nbsp;·&nbsp; ${escapeHtml(meta.label)}</p>
          <h1 id="orbit-step-title">${escapeHtml(meta.title)}</h1>
          <p>${escapeHtml(meta.hint)}</p>
        </div>
        <div class="orbit-step__body">
          ${this.renderCurrentStepBody()}
        </div>
      </div>
    `;
    this.renderFooter();
    this.updateSubmissionControls();
  }

  private renderProgress(): void {
    const progress = this.element.querySelector<HTMLElement>("[data-progress]");
    if (!progress) return;
    progress.innerHTML = DIAGNOSTIC_STEPS.map((step) => {
      const current = this.draft.currentStep === step;
      const complete = this.draft.completedSteps.includes(step);
      const reachable = step < this.draft.currentStep || complete;
      return `
        <button
          class="orbit-progress__step${current ? " is-current" : ""}${complete ? " is-complete" : ""}"
          type="button"
          data-action="go-step"
          data-step="${step}"
          aria-current="${current ? "step" : "false"}"
          ${disabledAttribute(!reachable || current)}
        >
          <span class="orbit-progress__index">${complete ? "✓" : `0${step}`}</span>
          <span class="orbit-progress__copy">
            <strong>${escapeHtml(STEP_TITLES[step].label)}</strong>
            <small>${step === 1 ? "Need + outcome" : step === 2 ? "Reality + timing" : "Contact + review"}</small>
          </span>
        </button>
      `;
    }).join("");
  }

  private renderCurrentStepBody(): string {
    switch (this.draft.currentStep) {
      case 1: return this.renderVectorStep();
      case 2: return this.renderEnvelopeStep();
      case 3: return this.renderContactStep();
    }
  }

  private renderVectorStep(): string {
    return `
      <div class="orbit-bay-stack orbit-vector-layout">
        <section class="orbit-bay orbit-bay--systems">
          <header class="orbit-bay__header">
            <span>01A / SYSTEM LOCK</span>
            <p>Select 1–3 services. If more than one is selected, nominate the lead system.</p>
          </header>
          ${this.renderSystemsStep()}
        </section>
        <section class="orbit-bay orbit-bay--warm orbit-bay--outcome">
          <header class="orbit-bay__header">
            <span>01B / OUTCOME SIGNAL</span>
            <p>One objective, up to three outcomes, and the reason this matters now.</p>
          </header>
          ${this.renderOutcomeStep()}
        </section>
      </div>
      ${this.helpOpen ? this.renderHelpPanel() : ""}
    `;
  }

  private renderEnvelopeStep(): string {
    return `
      <div class="orbit-bay-stack orbit-envelope-layout">
        <section class="orbit-bay orbit-bay--warm orbit-bay--reality">
          <header class="orbit-bay__header">
            <span>02A / CURRENT REALITY</span>
            <p>Where the initiative stands and the landscape the work must enter.</p>
          </header>
          ${this.renderCurrentStateStep()}
        </section>
        <section class="orbit-bay orbit-bay--delivery">
          <header class="orbit-bay__header">
            <span>02B / DELIVERY WINDOW</span>
            <p>Timing and procurement signals used to route the mission correctly.</p>
          </header>
          ${this.renderDeliveryStep()}
        </section>
        <aside class="orbit-discovery-deferred">
          <span aria-hidden="true">03</span>
          <div><strong>TECHNICAL DISCOVERY / DEFERRED</strong><p>Architecture, data exposure and service-specific readiness will be established during discovery.</p></div>
          <small>NO ASSUMPTIONS RECORDED</small>
        </aside>
      </div>
    `;
  }

  private renderSystemsStep(): string {
    const selected = this.draft.data.systems;
    const primary = this.draft.data.primarySystem;
    const serviceMarkup = ORBIT_SERVICES.map((service) => {
      const isSelected = selected.includes(service.id);
      return `
        <button
          class="orbit-system${isSelected ? " is-selected" : ""} orbit-system--${service.id.toLowerCase()}"
          type="button"
          data-action="toggle-system"
          data-system="${service.id}"
          aria-pressed="${isSelected}"
        >
          <span class="orbit-system__index">${service.index}</span>
          <span class="orbit-system__core" aria-hidden="true"><i></i><i></i><i></i></span>
          <span class="orbit-system__copy">
            <strong>${service.id}</strong>
            <small>${escapeHtml(service.name)}</small>
          </span>
          <span class="orbit-system__state">${isSelected ? "LOCKED" : service.signal.toUpperCase()}</span>
        </button>
      `;
    }).join("");

    const primaryMarkup = selected.length > 1
      ? `
        <fieldset class="orbit-fieldset orbit-primary-select">
          <legend>Primary system <span>Required</span></legend>
          <p class="orbit-fieldset__hint">Which system should lead the mission?</p>
          <div class="orbit-choice-grid orbit-choice-grid--compact">
            ${selected.map((system) => {
              const service = getOrbitService(system);
              return `
                <label class="orbit-choice${primary === system ? " is-selected" : ""}">
                  <input type="radio" name="primary-system" value="${system}" data-field="primarySystem"${checkedAttribute(primary === system)} />
                  <span><strong>${system}</strong><small>${escapeHtml(service.name)}</small></span>
                </label>
              `;
            }).join("")}
          </div>
          ${this.renderError("primarySystem")}
        </fieldset>
      `
      : selected.length === 1
        ? `<p class="orbit-selection-note"><span>PRIMARY SYSTEM</span>${selected[0]} is automatically leading this mission.</p>`
        : "";

    return `
      <div class="orbit-systems-layout">
        <div>
          <div class="orbit-system-toolbar">
            <span><strong>${selected.length}</strong> / 3 SYSTEMS LOCKED</span>
            <button class="orbit-text-button" type="button" data-action="open-help">
              HELP ME CHOOSE <span aria-hidden="true">↗</span>
            </button>
          </div>
          <div class="orbit-system-grid">${serviceMarkup}</div>
          ${this.renderError("systems")}
          ${primaryMarkup}
        </div>
        <div class="orbit-selection-rail" aria-label="Selection brief">
          <span class="orbit-kicker">VECTOR STATUS</span>
          <strong>${selected.length ? `${selected.length} SYSTEM${selected.length === 1 ? "" : "S"} LOCKED` : "AWAITING SYSTEM LOCK"}</strong>
          <ol>
            ${selected.length
              ? selected.map((system) => `<li class="${primary === system ? "is-primary" : ""}"><span>${getOrbitService(system).index}</span>${system}${primary === system ? " / PRIMARY" : ""}</li>`).join("")
              : "<li><span>—</span>NO SYSTEMS SELECTED</li>"}
          </ol>
        </div>
      </div>
    `;
  }

  private renderHelpPanel(): string {
    const recommendation = this.recommendation;
    return `
      <section class="orbit-help-panel" aria-labelledby="orbit-help-title">
        <div class="orbit-help-panel__header">
          <div>
            <p class="orbit-eyebrow">RULE-BASED SYSTEM SELECTOR</p>
            <h2 id="orbit-help-title">Help me choose</h2>
          </div>
          <button class="orbit-icon-button" type="button" data-action="close-help" aria-label="Close system selector">×</button>
        </div>
        <div class="orbit-help-panel__questions">
          <label class="orbit-field">
            <span>01 / Primary goal</span>
            <select data-help-field="goal">
              ${renderOptions(HELP_GOALS, this.helpAnswers.goal, "Choose the closest goal")}
            </select>
          </label>
          <fieldset class="orbit-fieldset">
            <legend>02 / Expected outcomes <span>Choose 1–3</span></legend>
            <div class="orbit-check-grid">
              ${EXPECTED_OUTCOMES.map((outcome) => `
                <label class="orbit-check${this.helpAnswers.outcomes.includes(outcome.value) ? " is-selected" : ""}">
                  <input type="checkbox" value="${outcome.value}" data-help-array="outcomes"${checkedAttribute(this.helpAnswers.outcomes.includes(outcome.value))} />
                  <span>${escapeHtml(outcome.label)}</span>
                </label>
              `).join("")}
            </div>
          </fieldset>
          <label class="orbit-field">
            <span>03 / Current environment</span>
            <select data-help-field="environment">
              ${renderOptions(HELP_ENVIRONMENTS, this.helpAnswers.environment, "Choose the closest environment")}
            </select>
          </label>
        </div>
        ${this.helpError ? `<p class="orbit-alert orbit-alert--error" role="alert">${escapeHtml(this.helpError)}</p>` : ""}
        ${recommendation ? this.renderRecommendation(recommendation) : ""}
        <div class="orbit-help-panel__actions">
          <button class="orbit-button orbit-button--ghost" type="button" data-action="close-help">CANCEL</button>
          <button class="orbit-button orbit-button--signal" type="button" data-action="recommend-systems">
            ${recommendation ? "RECALCULATE SYSTEMS" : "CALCULATE SYSTEMS"} <span aria-hidden="true">→</span>
          </button>
        </div>
      </section>
    `;
  }

  private renderRecommendation(recommendation: SystemRecommendation): string {
    return `
      <div class="orbit-recommendation">
        <div class="orbit-recommendation__heading">
          <div><span>WHY THESE SYSTEMS</span><strong>${recommendation.systems.length} SYSTEM MATCH</strong></div>
          <button class="orbit-button orbit-button--small" type="button" data-action="apply-recommendation">
            ${this.draft.data.systems.length ? "CONFIRM & REPLACE" : "CONFIRM SELECTION"}
          </button>
        </div>
        <div class="orbit-recommendation__systems">
          ${recommendation.systems.map((system, index) => {
            const service = getOrbitService(system);
            return `
              <article>
                <span>0${index + 1}</span>
                <div><strong>${system}</strong><small>${escapeHtml(service.name)}</small></div>
                <p>${escapeHtml(recommendation.reasons[system] ?? "Recommended from the supplied mission signals.")}</p>
              </article>
            `;
          }).join("")}
        </div>
        <p class="orbit-recommendation__note">This is a transparent rules match, not an AI assessment. Confirming applies it; you can still modify the selection.</p>
      </div>
    `;
  }

  private renderOutcomeStep(): string {
    const data = this.draft.data.outcome;
    return `
      <div class="orbit-form-grid">
        <fieldset class="orbit-fieldset orbit-fieldset--wide">
          <legend>Main project objective <span>Choose one</span></legend>
          <div class="orbit-choice-grid">
            ${this.renderRadioChoices("outcome.objective", PROJECT_OBJECTIVES, data.objective)}
          </div>
          ${this.renderError("outcome.objective")}
        </fieldset>
        <fieldset class="orbit-fieldset orbit-fieldset--wide">
          <legend>Expected outcomes <span>Choose 1–3</span></legend>
          <div class="orbit-check-grid orbit-check-grid--three">
            ${this.renderCheckboxChoices("outcome.expectedOutcomes", EXPECTED_OUTCOMES, data.expectedOutcomes)}
          </div>
          ${this.renderError("outcome.expectedOutcomes")}
        </fieldset>
        <label class="orbit-field orbit-field--wide">
          <span>Executive summary <em>Required / 40–800 characters</em></span>
          <textarea rows="7" minlength="40" maxlength="800" data-field="outcome.executiveSummary" placeholder="What are you trying to change, why now, and what would a successful outcome look like?"${this.invalidAttribute("outcome.executiveSummary")}>${escapeHtml(data.executiveSummary)}</textarea>
          <small class="orbit-field__meta"><span>Do not include passwords, secret keys or sensitive personal information.</span><strong data-count-for="outcome.executiveSummary">${data.executiveSummary.length} / 800</strong></small>
          ${this.renderError("outcome.executiveSummary")}
        </label>
      </div>
    `;
  }

  private renderCurrentStateStep(): string {
    const data = this.draft.data.currentState;
    return `
      <div class="orbit-form-grid">
        ${this.renderSelectField("currentState.initiativeStage", "Initiative stage", INITIATIVE_STAGES, data.initiativeStage)}
        ${this.renderSelectField("currentState.deliveryContext", "Delivery context", DELIVERY_CONTEXTS, data.deliveryContext)}
        ${this.renderSelectField("currentState.impactScope", "Impact scope", IMPACT_SCOPES, data.impactScope)}
        <label class="orbit-field orbit-field--wide">
          <span>Current landscape <em>Required / 40–1200 characters</em></span>
          <textarea rows="8" minlength="40" maxlength="1200" data-field="currentState.landscape" placeholder="Describe the current systems, constraints, teams and material problems we should understand."${this.invalidAttribute("currentState.landscape")}>${escapeHtml(data.landscape)}</textarea>
          <small class="orbit-field__meta"><span>Keep credentials and sensitive personal information out of this field.</span><strong data-count-for="currentState.landscape">${data.landscape.length} / 1200</strong></small>
          ${this.renderError("currentState.landscape")}
        </label>
        <label class="orbit-field orbit-field--wide">
          <span>Known dependencies <em>Optional</em></span>
          <textarea rows="4" maxlength="800" data-field="currentState.dependencies" placeholder="Key suppliers, programmes, deadlines, systems or approvals that may affect delivery."${this.invalidAttribute("currentState.dependencies")}>${escapeHtml(data.dependencies)}</textarea>
          <small class="orbit-field__meta"><span>List only what is useful for an initial discovery conversation.</span><strong data-count-for="currentState.dependencies">${data.dependencies.length} / 800</strong></small>
          ${this.renderError("currentState.dependencies")}
        </label>
      </div>
    `;
  }

  private renderDeliveryStep(): string {
    const data = this.draft.data.delivery;
    return `
      <div class="orbit-form-grid">
        ${this.renderSelectField("delivery.engagementModel", "Engagement model", ENGAGEMENT_MODELS, data.engagementModel)}
        ${this.renderSelectField("delivery.procurementState", "Procurement state", PROCUREMENT_STATES, data.procurementState)}
        ${this.renderSelectField("delivery.timeline", "Delivery window", TIMELINES, data.timeline)}
        ${data.timeline === "target-date" ? `
          <label class="orbit-field">
            <span>Target date</span>
            <input type="date" data-field="delivery.targetDate" value="${escapeHtml(data.targetDate)}" min="${new Date().toISOString().slice(0, 10)}"${this.invalidAttribute("delivery.targetDate")} />
            ${this.renderError("delivery.targetDate")}
          </label>
        ` : ""}
        <fieldset class="orbit-fieldset orbit-fieldset--wide orbit-budget">
          <legend>Budget signal <span>Optional</span></legend>
          <label class="orbit-switch">
            <input type="checkbox" data-field="delivery.discloseBudget"${checkedAttribute(data.discloseBudget)} />
            <span aria-hidden="true"><i></i></span>
            <strong>I want to share an estimated budget band</strong>
          </label>
          ${data.discloseBudget ? `
            <div class="orbit-budget__fields">
              <label class="orbit-field">
                <span>Currency</span>
                <select data-field="delivery.budgetCurrency"${this.invalidAttribute("delivery.budgetCurrency")}>
                  ${renderOptions([
                    { value: "GBP", label: "GBP · British pound" },
                    { value: "USD", label: "USD · US dollar" },
                    { value: "EUR", label: "EUR · Euro" },
                  ], data.budgetCurrency)}
                </select>
                ${this.renderError("delivery.budgetCurrency")}
              </label>
              <label class="orbit-field">
                <span>Estimated band</span>
                <select data-field="delivery.budgetBand"${this.invalidAttribute("delivery.budgetBand")}>
                  ${renderOptions(BUDGET_BANDS, data.budgetBand)}
                </select>
                ${this.renderError("delivery.budgetBand")}
              </label>
            </div>
            <p class="orbit-budget__note">The band is recorded in the selected currency. No exchange-rate conversion is applied.</p>
          ` : `<p class="orbit-budget__note">You can continue without disclosing a budget.</p>`}
        </fieldset>
      </div>
    `;
  }

  private renderContactStep(): string {
    const data = this.draft.data.contact;
    const personalWarning = data.workEmail && isPersonalEmail(data.workEmail)
      ? `<p class="orbit-field__warning" data-email-warning>That looks like a personal address. A work email helps us route the mission, but you can still submit.</p>`
      : `<p class="orbit-field__warning" data-email-warning hidden></p>`;
    return `
      <div class="orbit-identify-layout">
        <section class="orbit-contact-panel orbit-bay orbit-bay--contact">
          <header class="orbit-bay__header">
            <span>03A / MISSION OWNER</span>
            <p>Who should lead the first engineering conversation?</p>
          </header>
          <div class="orbit-form-grid">
            ${this.renderTextField("contact.fullName", "Full name", data.fullName, "text", "Ada Lovelace", "name")}
            ${this.renderTextField("contact.jobTitle", "Role / job title", data.jobTitle, "text", "Director of Engineering", "organization-title")}
            ${this.renderTextField("contact.company", "Organisation", data.company, "text", "Company name", "organization")}
            <label class="orbit-field">
              <span>Work email</span>
              <input type="email" data-field="contact.workEmail" value="${escapeHtml(data.workEmail)}" placeholder="name@company.com" autocomplete="email"${this.invalidAttribute("contact.workEmail")} />
              ${personalWarning}
              ${this.renderError("contact.workEmail")}
            </label>
            ${this.renderTextField("contact.phone", "Phone", data.phone, "tel", "+44 ...", "tel", true)}
            ${this.renderTextField("contact.country", "Country / region", data.country, "text", "United Kingdom", "country-name", true)}
          </div>
        </section>
        <section class="orbit-review-panel orbit-bay orbit-bay--brief-paper">
          <div class="orbit-review-panel__header">
            <div><p class="orbit-kicker">03B / STRUCTURED REVIEW</p><h2>Mission signal</h2></div>
            <span>${this.draft.data.systems.length} SYSTEMS / 2 SIGNAL BAYS</span>
          </div>
          ${this.renderReview()}
        </section>
      </div>
      <div class="orbit-consent-panel">
        <label class="orbit-consent${this.errors.contactConsent ? " has-error" : ""}">
          <input type="checkbox" data-field="contactConsent"${checkedAttribute(this.draft.data.contactConsent)} />
          <span aria-hidden="true"></span>
          <strong>I agree that e Gain Technologies Ltd. may contact me about this project brief.</strong>
        </label>
        <p>Required for transmission and deliberately not saved in your session draft. Read the <a href="${escapeHtml(this.options.privacyNoticeUrl ?? "/privacy")}" target="_blank" rel="noopener noreferrer">Privacy Notice</a>.</p>
        ${this.renderError("contactConsent")}
      </div>
      ${this.submitMessage ? `<div class="orbit-alert orbit-alert--${this.submitMessage.startsWith("TRANSMISSION") ? "error" : "info"}" role="alert" data-submit-message>${escapeHtml(this.submitMessage)}</div>` : `<div data-submit-message></div>`}
    `;
  }

  private renderReview(): string {
    const data = this.draft.data;
    const primary = data.primarySystem ? getOrbitService(data.primarySystem) : null;
    const budget = data.delivery.discloseBudget && data.delivery.budgetCurrency
      ? `${data.delivery.budgetCurrency} · ${getChoiceLabel(BUDGET_BANDS, data.delivery.budgetBand)}`
      : "Not disclosed";
    const groups: Array<{ step: DiagnosticStep; title: string; rows: Array<[string, string]> }> = [
      {
        step: 1,
        title: "Vector",
        rows: [
          ["Selected", data.systems.map((system) => getOrbitService(system).name).join(", ")],
          ["Primary", primary ? primary.name : "Not selected"],
          ["Objective", getChoiceLabel(PROJECT_OBJECTIVES, data.outcome.objective)],
          ["Expected", listLabels(data.outcome.expectedOutcomes, EXPECTED_OUTCOMES)],
          ["Summary", data.outcome.executiveSummary],
        ],
      },
      {
        step: 2,
        title: "Envelope",
        rows: [
          ["Stage", getChoiceLabel(INITIATIVE_STAGES, data.currentState.initiativeStage)],
          ["Context", getChoiceLabel(DELIVERY_CONTEXTS, data.currentState.deliveryContext)],
          ["Scope", getChoiceLabel(IMPACT_SCOPES, data.currentState.impactScope)],
          ["Landscape", data.currentState.landscape],
          ["Dependencies", data.currentState.dependencies || "None provided"],
          ["Model", getChoiceLabel(ENGAGEMENT_MODELS, data.delivery.engagementModel)],
          ["Procurement", getChoiceLabel(PROCUREMENT_STATES, data.delivery.procurementState)],
          ["Window", getChoiceLabel(TIMELINES, data.delivery.timeline)],
          ["Target date", data.delivery.targetDate || "Not specified"],
          ["Budget", budget],
          ["Technical", "Deferred to engineering discovery"],
        ],
      },
    ];

    return groups.map((group) => `
      <section class="orbit-review-group">
        <header><strong>${escapeHtml(group.title)}</strong><button type="button" data-action="edit-step" data-step="${group.step}">EDIT BAY 0${group.step}</button></header>
        <dl>
          ${group.rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value || "Not provided")}</dd></div>`).join("")}
        </dl>
      </section>
    `).join("");
  }

  private renderRadioChoices(
    field: string,
    choices: readonly { value: string; label: string }[],
    selected: string,
  ): string {
    return choices.map((choice) => `
      <label class="orbit-choice${selected === choice.value ? " is-selected" : ""}">
        <input type="radio" name="${escapeHtml(field)}" value="${escapeHtml(choice.value)}" data-field="${escapeHtml(field)}"${checkedAttribute(selected === choice.value)} />
        <span>${escapeHtml(choice.label)}</span>
      </label>
    `).join("");
  }

  private renderCheckboxChoices(
    field: string,
    choices: readonly { value: string; label: string }[],
    selected: string[],
  ): string {
    const maximum = MAX_ARRAY_SELECTIONS[field];
    return choices.map((choice) => {
      const checked = selected.includes(choice.value);
      const disabled = maximum !== undefined && selected.length >= maximum && !checked;
      return `
        <label class="orbit-check${checked ? " is-selected" : ""}${disabled ? " is-disabled" : ""}">
          <input type="checkbox" value="${escapeHtml(choice.value)}" data-array-field="${escapeHtml(field)}"${checkedAttribute(checked)}${disabledAttribute(disabled)} />
          <span>${escapeHtml(choice.label)}</span>
        </label>
      `;
    }).join("");
  }

  private renderSelectField(
    field: string,
    label: string,
    choices: readonly { value: string; label: string }[],
    value: string,
  ): string {
    return `
      <label class="orbit-field">
        <span>${escapeHtml(label)}</span>
        <select data-field="${escapeHtml(field)}"${this.invalidAttribute(field)}>${renderOptions(choices, value)}</select>
        ${this.renderError(field)}
      </label>
    `;
  }

  private renderTextField(
    field: string,
    label: string,
    value: string,
    type: string,
    placeholder: string,
    autocomplete: string,
    optional = false,
  ): string {
    return `
      <label class="orbit-field">
        <span>${escapeHtml(label)}${optional ? " <em>Optional</em>" : ""}</span>
        <input type="${escapeHtml(type)}" data-field="${escapeHtml(field)}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" autocomplete="${escapeHtml(autocomplete)}"${this.invalidAttribute(field)} />
        ${this.renderError(field)}
      </label>
    `;
  }

  private renderError(field: string): string {
    const error = this.errors[field];
    return error ? `<small class="orbit-field__error" role="alert" data-error-for="${escapeHtml(field)}">${escapeHtml(error)}</small>` : "";
  }

  private invalidAttribute(field: string): string {
    return this.errors[field] ? ' aria-invalid="true"' : "";
  }

  private renderFooter(): void {
    const footer = this.element.querySelector<HTMLElement>("[data-footer]");
    if (!footer) return;
    const step = this.draft.currentStep;
    const retrySeconds = this.retryUntil > Date.now() ? Math.ceil((this.retryUntil - Date.now()) / 1000) : 0;
    footer.innerHTML = `
      <div class="orbit-deck__footer-meta">
        <span>MISSION ${this.draft.idempotencyKey.slice(0, 8).toUpperCase()}</span>
        <span>${this.dirty ? "DRAFT STORED IN THIS TAB" : "LOCAL SESSION READY"}</span>
      </div>
      <div class="orbit-deck__footer-actions">
        ${step > 1 ? `<button class="orbit-button orbit-button--ghost" type="button" data-action="back"><span aria-hidden="true">←</span> BACK</button>` : ""}
        ${step < 3
          ? `<button class="orbit-button orbit-button--signal" type="button" data-action="next">LOCK ${STEP_TITLES[step].label.toUpperCase()} <span aria-hidden="true">→</span></button>`
          : `<button class="orbit-button orbit-button--signal orbit-button--transmit" type="button" data-action="submit"${disabledAttribute(this.submitting || retrySeconds > 0)}>
               <span data-submit-label>${this.submitting ? "TRANSMITTING…" : retrySeconds > 0 ? `RETRY IN ${retrySeconds}S` : "TRANSMIT MISSION"}</span>
               <span aria-hidden="true">↗</span>
             </button>`}
      </div>
    `;
  }

  private renderRecoveryDialog(): void {
    const draft = this.recoveryDraft;
    if (!draft) return;
    const modal = this.element.querySelector<HTMLElement>("[data-modal-layer]");
    if (!modal) return;
    const selected = draft.data.systems.length
      ? draft.data.systems.join(" / ")
      : "No systems locked";
    modal.hidden = false;
    modal.innerHTML = `
      <div class="orbit-dialog" role="alertdialog" aria-modal="true" aria-labelledby="orbit-recovery-title" aria-describedby="orbit-recovery-copy">
        <p class="orbit-eyebrow">SESSION SIGNAL DETECTED</p>
        <h2 id="orbit-recovery-title">Resume mission?</h2>
        <p id="orbit-recovery-copy">A Project Orbit draft from this browser tab is available. Contact consent was not stored and must be confirmed again.</p>
        <dl>
          <div><dt>Last signal</dt><dd>${escapeHtml(new Date(draft.updatedAt).toLocaleString())}</dd></div>
          <div><dt>Progress</dt><dd>Bay 0${draft.currentStep} / 03</dd></div>
          <div><dt>Systems</dt><dd>${escapeHtml(selected)}</dd></div>
        </dl>
        <div class="orbit-dialog__actions">
          <button class="orbit-button orbit-button--ghost" type="button" data-action="start-over">START OVER</button>
          <button class="orbit-button orbit-button--signal" type="button" data-action="resume">RESUME MISSION <span aria-hidden="true">→</span></button>
        </div>
      </div>
    `;
    window.setTimeout(() => modal.querySelector<HTMLElement>("[data-action='resume']")?.focus(), 0);
  }

  private renderExitDialog(): void {
    const modal = this.element.querySelector<HTMLElement>("[data-modal-layer]");
    if (!modal) return;
    modal.hidden = false;
    modal.innerHTML = `
      <div class="orbit-dialog" role="alertdialog" aria-modal="true" aria-labelledby="orbit-exit-title" aria-describedby="orbit-exit-copy">
        <p class="orbit-eyebrow">UNSENT MISSION SIGNAL</p>
        <h2 id="orbit-exit-title">Exit Project Orbit?</h2>
        <p id="orbit-exit-copy">Keep the draft in this browser tab for up to 24 hours, or discard it permanently.</p>
        <div class="orbit-dialog__actions orbit-dialog__actions--stacked">
          <button class="orbit-button orbit-button--signal" type="button" data-action="keep-exit">KEEP DRAFT &amp; EXIT</button>
          <button class="orbit-button orbit-button--danger" type="button" data-action="discard-exit">DISCARD</button>
          <button class="orbit-button orbit-button--ghost" type="button" data-action="continue">CONTINUE MISSION</button>
        </div>
      </div>
    `;
    window.setTimeout(() => modal.querySelector<HTMLElement>("[data-action='continue']")?.focus(), 0);
  }

  private closeModal(): void {
    const modal = this.element.querySelector<HTMLElement>("[data-modal-layer]");
    if (!modal) return;
    modal.hidden = true;
    modal.innerHTML = "";
  }

  private renderReceipt(): void {
    const receipt = this.receipt;
    if (!receipt) return;
    this.element.dataset.view = "received";
    const bookingUrl = safeLink(receipt.bookingUrl) ?? safeLink(this.options.fallbackBookingUrl);
    const progress = this.element.querySelector<HTMLElement>("[data-progress]");
    if (progress) progress.innerHTML = `<div class="orbit-progress__received"><span>✓</span> DATABASE RECEIPT CONFIRMED</div>`;
    const content = this.element.querySelector<HTMLElement>("[data-step-content]");
    if (!content) return;
    content.innerHTML = `
      <section class="orbit-received" aria-labelledby="orbit-step-title">
        <div class="orbit-received__core" aria-hidden="true"><i></i><i></i><i></i><strong>e</strong></div>
        <p class="orbit-eyebrow">TRANSMISSION COMPLETE</p>
        <h1 id="orbit-step-title">MISSION<br />RECEIVED.</h1>
        <p class="orbit-received__intro">Your project signal has been committed to Mission Control. Keep the reference below for your records.</p>
        <div class="orbit-receipt-strip">
          <div><span>LEAD REFERENCE</span><strong>${escapeHtml(receipt.referenceCode)}</strong></div>
          <div><span>RECEIVED</span><strong>${escapeHtml(new Date(receipt.receivedAt).toLocaleString())}</strong></div>
          <div><span>PRIORITY</span><strong>${escapeHtml(receipt.priority)}</strong></div>
        </div>
        <div class="orbit-brief">
          <div class="orbit-brief__header"><span>SERVER-GENERATED BRIEF / RULES_V1</span><button type="button" data-action="download-brief">DOWNLOAD COPY ↓</button></div>
          <pre>${escapeHtml(briefToText(receipt.brief))}</pre>
        </div>
        ${receipt.warnings.length ? `<div class="orbit-alert orbit-alert--info">${receipt.warnings.map(escapeHtml).join(" ")}</div>` : ""}
        <div class="orbit-received__actions">
          ${bookingUrl ? `<a class="orbit-button orbit-button--signal" href="${escapeHtml(bookingUrl)}" target="_blank" rel="noopener noreferrer">BOOK A DISCOVERY CALL <span aria-hidden="true">↗</span></a>` : ""}
          <button class="orbit-button orbit-button--ghost" type="button" data-action="return-experience">RETURN TO EXPERIENCE</button>
        </div>
      </section>
    `;
    const footer = this.element.querySelector<HTMLElement>("[data-footer]");
    if (footer) footer.innerHTML = `<div class="orbit-deck__footer-meta"><span>RECEIPT ${escapeHtml(receipt.referenceCode)}</span><span>COMMITTED / ${escapeHtml(receipt.leadId.slice(0, 12))}</span></div>`;
    this.closeModal();
    this.focusHeading();
  }

  private readonly handleClick = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-action]") : null;
    if (!target) return;
    const action = target.dataset.action;

    if (action === "close") this.close();
    if (action === "back") this.goBack();
    if (action === "next") this.goNext();
    if (action === "go-step") {
      const step = Number(target.dataset.step);
      if (step >= 1 && step <= 3) this.goToStep(step as DiagnosticStep);
    }
    if (action === "edit-step") {
      const step = Number(target.dataset.step);
      if (step >= 1 && step <= 2) {
        this.editReturnFromStep = step as DiagnosticStep;
        this.goToStep(step as DiagnosticStep);
      }
    }
    if (action === "toggle-system") this.toggleSystem(target.dataset.system as PlanetId);
    if (action === "open-help") {
      this.helpOpen = true;
      this.renderStep();
      window.setTimeout(() => this.element.querySelector<HTMLElement>("#orbit-help-title")?.focus(), 0);
    }
    if (action === "close-help") {
      this.helpOpen = false;
      this.recommendation = null;
      this.helpError = "";
      this.renderStep();
    }
    if (action === "recommend-systems") this.calculateRecommendation();
    if (action === "apply-recommendation") this.applyRecommendation();
    if (action === "resume") this.resumeDraft();
    if (action === "start-over") this.startOver();
    if (action === "keep-exit") {
      saveDiagnosticDraft(this.draft);
      this.finishClose();
    }
    if (action === "discard-exit") {
      clearDiagnosticDraft();
      this.dirty = false;
      this.finishClose();
    }
    if (action === "continue") this.closeModal();
    if (action === "submit") void this.submitMission();
    if (action === "download-brief") this.downloadBrief();
    if (action === "return-experience") this.finishClose();
  };

  private readonly handleInput = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) return;

    const helpField = target.dataset.helpField;
    if (helpField === "goal" || helpField === "environment") {
      this.helpAnswers[helpField] = target.value;
      this.recommendation = null;
      this.helpError = "";
      return;
    }

    const field = target.dataset.field;
    if (!field) return;
    this.setScalarField(field, target);
    this.clearFieldError(field);
    this.markDirty(field !== "contactConsent");
    this.updateLiveFieldMeta(field, target.value);
    if (field === "contact.workEmail") this.updateEmailWarning(target.value);
  };

  private readonly handleChange = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;

    const helpArray = target.dataset.helpArray;
    if (helpArray === "outcomes" && target instanceof HTMLInputElement) {
      this.toggleStringArray(this.helpAnswers.outcomes, target.value, target.checked, 3);
      this.recommendation = null;
      this.helpError = "";
      this.renderStep();
      return;
    }

    const arrayField = target.dataset.arrayField;
    if (arrayField && target instanceof HTMLInputElement) {
      const values = this.getArrayField(arrayField);
      if (!values) return;
      this.toggleStringArray(values, target.value, target.checked, MAX_ARRAY_SELECTIONS[arrayField]);
      this.clearFieldError(arrayField);
      this.markDirty();
      this.renderStep();
      return;
    }

    const field = target.dataset.field;
    if (field === "delivery.discloseBudget" || field === "delivery.timeline" || field === "primarySystem") {
      this.renderStep();
      this.emitPresentationState("MISSION_DECK");
    } else if (field && (target.type === "radio" || target.tagName === "SELECT")) {
      this.renderStep();
    }
  };

  private readonly handleKeydown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      const modal = this.element.querySelector<HTMLElement>("[data-modal-layer]");
      if (modal && !modal.hidden) {
        const continueButton = modal.querySelector<HTMLElement>("[data-action='continue']");
        if (continueButton) this.closeModal();
        return;
      }
      if (this.helpOpen) {
        this.helpOpen = false;
        this.renderStep();
        return;
      }
      this.close();
      return;
    }

    if (event.key !== "Tab") return;
    const scope = this.element.querySelector<HTMLElement>("[data-modal-layer]:not([hidden])") ?? this.element.querySelector<HTMLElement>(".orbit-deck");
    if (!scope) return;
    const focusable = Array.from(scope.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"))
      .filter((item) => !item.hidden && item.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  private setScalarField(field: string, target: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): void {
    const value = target instanceof HTMLInputElement && target.type === "checkbox" ? target.checked : target.value;
    switch (field) {
      case "primarySystem":
        this.draft.data.primarySystem = target.value as PlanetId;
        this.focusedSystem = this.draft.data.primarySystem;
        break;
      case "outcome.objective": this.draft.data.outcome.objective = target.value; break;
      case "outcome.executiveSummary": this.draft.data.outcome.executiveSummary = target.value; break;
      case "currentState.initiativeStage": this.draft.data.currentState.initiativeStage = target.value; break;
      case "currentState.deliveryContext": this.draft.data.currentState.deliveryContext = target.value; break;
      case "currentState.impactScope": this.draft.data.currentState.impactScope = target.value; break;
      case "currentState.landscape": this.draft.data.currentState.landscape = target.value; break;
      case "currentState.dependencies": this.draft.data.currentState.dependencies = target.value; break;
      case "delivery.engagementModel": this.draft.data.delivery.engagementModel = target.value; break;
      case "delivery.procurementState": this.draft.data.delivery.procurementState = target.value; break;
      case "delivery.timeline":
        this.draft.data.delivery.timeline = target.value;
        if (target.value !== "target-date") this.draft.data.delivery.targetDate = "";
        break;
      case "delivery.targetDate": this.draft.data.delivery.targetDate = target.value; break;
      case "delivery.discloseBudget":
        this.draft.data.delivery.discloseBudget = value === true;
        if (!this.draft.data.delivery.discloseBudget) {
          this.draft.data.delivery.budgetCurrency = "";
          this.draft.data.delivery.budgetBand = "";
        }
        break;
      case "delivery.budgetCurrency": this.draft.data.delivery.budgetCurrency = target.value as "" | "GBP" | "USD" | "EUR"; break;
      case "delivery.budgetBand": this.draft.data.delivery.budgetBand = target.value; break;
      case "contact.fullName": this.draft.data.contact.fullName = target.value; break;
      case "contact.jobTitle": this.draft.data.contact.jobTitle = target.value; break;
      case "contact.company": this.draft.data.contact.company = target.value; break;
      case "contact.workEmail": this.draft.data.contact.workEmail = target.value; break;
      case "contact.phone": this.draft.data.contact.phone = target.value; break;
      case "contact.country": this.draft.data.contact.country = target.value; break;
      case "contactConsent": this.draft.data.contactConsent = value === true; break;
    }
  }

  private getArrayField(field: string): string[] | null {
    switch (field) {
      case "outcome.expectedOutcomes": return this.draft.data.outcome.expectedOutcomes;
      default: return null;
    }
  }

  private toggleStringArray(values: string[], value: string, checked: boolean, maximum?: number): void {
    if (checked) {
      if (!values.includes(value) && (maximum === undefined || values.length < maximum)) values.push(value);
    } else {
      const index = values.indexOf(value);
      if (index >= 0) values.splice(index, 1);
    }
  }

  private toggleSystem(system: PlanetId): void {
    if (!ORBIT_SERVICES.some((service) => service.id === system)) return;
    const systems = this.draft.data.systems;
    const index = systems.indexOf(system);
    if (index >= 0) {
      systems.splice(index, 1);
      if (this.draft.data.primarySystem === system) this.draft.data.primarySystem = null;
      if (systems.length === 1) this.draft.data.primarySystem = systems[0];
      this.focusedSystem = this.draft.data.primarySystem ?? systems[0] ?? null;
    } else {
      if (systems.length >= 3) {
        this.announce("A mission can include no more than three systems.");
        return;
      }
      const expandingFromSingle = systems.length === 1;
      systems.push(system);
      this.focusedSystem = system;
      if (systems.length === 1) this.draft.data.primarySystem = system;
      if (expandingFromSingle) this.draft.data.primarySystem = null;
    }
    this.clearFieldError("systems");
    this.clearFieldError("primarySystem");
    this.markDirty();
    this.renderStep();
    this.emitPresentationState("MISSION_DECK");
  }

  private calculateRecommendation(): void {
    if (!this.helpAnswers.goal || !this.helpAnswers.environment || this.helpAnswers.outcomes.length < 1) {
      this.helpError = "Complete all three signals and choose at least one expected outcome.";
      this.recommendation = null;
    } else {
      this.helpError = "";
      this.recommendation = recommendSystems(this.helpAnswers);
    }
    this.renderStep();
  }

  private applyRecommendation(): void {
    if (!this.recommendation) return;
    this.draft.data.systems = [...this.recommendation.systems];
    this.draft.data.primarySystem = this.recommendation.systems[0] ?? null;
    this.focusedSystem = this.draft.data.primarySystem;
    this.helpOpen = false;
    this.recommendation = null;
    this.helpError = "";
    this.clearFieldError("systems");
    this.clearFieldError("primarySystem");
    this.markDirty();
    this.renderStep();
    this.announce(`${this.draft.data.systems.length} recommended systems confirmed. You can modify the selection.`);
    this.emitPresentationState("MISSION_DECK");
  }

  private goNext(): void {
    const validation = validateDiagnosticStep(this.draft.currentStep, this.draft.data);
    if (!validation.valid) {
      this.errors = validation.errors;
      this.renderStep();
      this.focusFirstError();
      return;
    }
    if (!this.draft.completedSteps.includes(this.draft.currentStep)) this.draft.completedSteps.push(this.draft.currentStep);
    if (this.editReturnFromStep === this.draft.currentStep) {
      this.draft.currentStep = 3;
      this.editReturnFromStep = null;
    } else if (this.draft.currentStep < 3) {
      this.draft.currentStep = (this.draft.currentStep + 1) as DiagnosticStep;
    }
    this.errors = {};
    this.persistNow();
    this.renderStep();
    this.focusHeading();
    this.emitPresentationState("MISSION_DECK");
  }

  private goBack(): void {
    if (this.draft.currentStep <= 1) return;
    this.editReturnFromStep = null;
    this.draft.currentStep = (this.draft.currentStep - 1) as DiagnosticStep;
    this.errors = {};
    this.persistNow();
    this.renderStep();
    this.focusHeading();
  }

  private goToStep(step: DiagnosticStep): void {
    if (step > this.draft.currentStep && !this.draft.completedSteps.includes(step)) return;
    this.draft.currentStep = step;
    this.errors = {};
    this.submitMessage = "";
    this.renderStep();
    this.focusHeading();
  }

  private resumeDraft(): void {
    if (!this.recoveryDraft) return;
    this.draft = this.recoveryDraft;
    this.draft.data.contactConsent = false;
    this.focusedSystem = this.draft.data.primarySystem ?? this.draft.data.systems[0] ?? null;
    this.recoveryDraft = null;
    this.dirty = true;
    this.closeModal();
    this.renderStep();
    this.focusHeading();
    this.announce(`Mission resumed at bay ${this.draft.currentStep} of 3.`);
    this.emitPresentationState("MISSION_DECK");
  }

  private startOver(): void {
    clearDiagnosticDraft();
    this.recoveryDraft = null;
    this.draft = createInitialDiagnosticDraft();
    this.applyInitialSystems(this.initialOpenOptions);
    this.dirty = false;
    this.closeModal();
    this.renderStep();
    this.focusHeading();
    this.announce("A new mission has started.");
    this.emitPresentationState("MISSION_DECK");
  }

  private markDirty(persist = true): void {
    this.dirty = true;
    if (persist) this.queueSave();
  }

  private queueSave(): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      saveDiagnosticDraft(this.draft);
      this.updateFooterDraftState();
    }, 180);
  }

  private persistNow(): void {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    saveDiagnosticDraft(this.draft);
  }

  private updateFooterDraftState(): void {
    const meta = this.element.querySelector<HTMLElement>(".orbit-deck__footer-meta span:last-child");
    if (meta && !this.receipt) meta.textContent = "DRAFT STORED IN THIS TAB";
  }

  private clearFieldError(field: string): void {
    if (!this.errors[field]) return;
    delete this.errors[field];
    this.element.querySelector<HTMLElement>(`[data-error-for="${CSS.escape(field)}"]`)?.remove();
    this.element.querySelector<HTMLElement>(`[data-field="${CSS.escape(field)}"]`)?.removeAttribute("aria-invalid");
  }

  private updateLiveFieldMeta(field: string, value: string): void {
    const counter = this.element.querySelector<HTMLElement>(`[data-count-for="${CSS.escape(field)}"]`);
    if (!counter) return;
    const maximum = field === "currentState.landscape" ? 1200 : 800;
    counter.textContent = `${value.length} / ${maximum}`;
  }

  private updateEmailWarning(email: string): void {
    const warning = this.element.querySelector<HTMLElement>("[data-email-warning]");
    if (!warning) return;
    const personal = isPersonalEmail(email);
    warning.hidden = !personal;
    warning.textContent = personal
      ? "That looks like a personal address. A work email helps us route the mission, but you can still submit."
      : "";
  }

  private async submit(): Promise<void> {
    if (this.submitting || this.retryUntil > Date.now()) return;
    const validation = validateDiagnostic(this.draft.data);
    if (!validation.valid) {
      this.draft.currentStep = validation.step;
      this.errors = validation.errors;
      this.submitMessage = "MISSION SIGNAL INCOMPLETE. Review the highlighted field before transmission.";
      this.renderStep();
      this.focusFirstError();
      return;
    }

    this.errors = {};
    this.submitMessage = "";
    this.submitting = true;
    this.updateSubmissionControls();
    const controller = new AbortController();
    this.activeRequest = controller;

    try {
      const endpoint = `${(this.options.apiBaseUrl ?? "/api/v1").replace(/\/$/, "")}/leads`;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": this.draft.idempotencyKey,
        },
        body: JSON.stringify(buildLeadSubmissionRequest(this.draft.data, this.options.privacyVersion)),
        signal: controller.signal,
      });
      const body = await this.readJson(response);

      if (response.status === 422) {
        this.handleValidationResponse(body as ApiErrorBody | null);
        return;
      }
      if (response.status === 429) {
        this.beginRetryCountdown(parseRetrySeconds(response, body as ApiErrorBody | null));
        return;
      }
      if (!response.ok) {
        const apiMessage = body && typeof body === "object" && "message" in body && typeof body.message === "string" ? body.message : "";
        this.submitMessage = response.status >= 500
          ? "TRANSMISSION INTERRUPTED. Your answers are safe in this tab. Retry using the same mission reference."
          : apiMessage || "TRANSMISSION REJECTED. Review the mission and try again.";
        return;
      }

      if (!this.isLeadReceipt(body)) {
        this.submitMessage = "TRANSMISSION INTERRUPTED. Mission Control returned an incomplete receipt; no success state has been shown.";
        return;
      }

      this.receipt = body;
      this.dirty = false;
      clearDiagnosticDraft();
      this.renderReceipt();
      this.emitPresentationState("RECEIVED");
      this.announce(`Mission received. Lead reference ${body.referenceCode}.`);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        this.submitMessage = "TRANSMISSION INTERRUPTED. Your answers are safe in this tab. Check the connection and retry.";
      }
    } finally {
      if (this.activeRequest === controller) this.activeRequest = null;
      this.submitting = false;
      if (!this.receipt) {
        this.renderStep();
        this.updateSubmissionControls();
      }
    }
  }

  private async readJson(response: Response): Promise<unknown> {
    try {
      return await response.json() as unknown;
    } catch {
      return null;
    }
  }

  private isLeadReceipt(value: unknown): value is CreateLeadResponse {
    if (!value || typeof value !== "object") return false;
    const record = value as Record<string, unknown>;
    return typeof record.leadId === "string"
      && record.leadId.length > 0
      && typeof record.referenceCode === "string"
      && record.referenceCode.length > 0
      && typeof record.receivedAt === "string"
      && !Number.isNaN(Date.parse(record.receivedAt))
      && typeof record.priority === "string"
      && !!record.brief
      && typeof record.brief === "object"
      && Array.isArray(record.warnings);
  }

  private handleValidationResponse(body: ApiErrorBody | null): void {
    const issues = body?.issues ?? [];
    const errors: Record<string, string> = {};
    issues.forEach((issue) => {
      if (!errors[issue.path]) errors[issue.path] = issue.message;
    });
    const derivedStep = issues.length
      ? Math.min(...issues.map((issue) => stepForApiPath(issue.path))) as DiagnosticStep
      : 3;
    // The API still reports legacy six-step positions. Map its field paths into
    // the condensed three-bay interface instead of trusting firstStep.
    this.draft.currentStep = derivedStep;
    this.errors = errors;
    this.submitMessage = "MISSION SIGNAL INCOMPLETE. Mission Control returned the highlighted fields for review.";
    this.renderStep();
    this.focusFirstError();
  }

  private beginRetryCountdown(seconds: number): void {
    this.retryUntil = Date.now() + seconds * 1000;
    this.submitMessage = `TRANSMISSION RATE LIMITED. Mission Control will accept another attempt in ${seconds} seconds.`;
    if (this.retryTimer !== null) window.clearInterval(this.retryTimer);
    this.retryTimer = window.setInterval(() => {
      if (this.retryUntil <= Date.now()) {
        if (this.retryTimer !== null) window.clearInterval(this.retryTimer);
        this.retryTimer = null;
        this.retryUntil = 0;
        this.submitMessage = "Mission Control is ready. Retry transmission when ready.";
      }
      this.updateSubmissionControls();
      const message = this.element.querySelector<HTMLElement>("[data-submit-message]");
      if (message) message.textContent = this.submitMessage;
    }, 1000);
  }

  private updateSubmissionControls(): void {
    const button = this.element.querySelector<HTMLButtonElement>("[data-action='submit']");
    const label = this.element.querySelector<HTMLElement>("[data-submit-label]");
    if (!button || !label) return;
    const retrySeconds = this.retryUntil > Date.now() ? Math.ceil((this.retryUntil - Date.now()) / 1000) : 0;
    button.disabled = this.submitting || retrySeconds > 0;
    label.textContent = this.submitting ? "TRANSMITTING…" : retrySeconds > 0 ? `RETRY IN ${retrySeconds}S` : "TRANSMIT MISSION";
  }

  private downloadBrief(): void {
    const receipt = this.receipt;
    if (!receipt) return;
    const content = [
      "e GAIN TECHNOLOGIES LTD. / PROJECT ORBIT",
      `LEAD REFERENCE: ${receipt.referenceCode}`,
      `RECEIVED: ${receipt.receivedAt}`,
      "",
      briefToText(receipt.brief),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `egain-${receipt.referenceCode.replace(/[^a-z0-9-]/gi, "-").toLowerCase()}-brief.txt`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  private focusHeading(): void {
    window.setTimeout(() => {
      const heading = this.element.querySelector<HTMLElement>("#orbit-step-title");
      if (!heading) return;
      heading.tabIndex = -1;
      heading.focus();
    }, 0);
  }

  private focusFirstError(): void {
    window.setTimeout(() => {
      const field = Object.keys(this.errors)[0];
      if (!field) return;
      const escaped = CSS.escape(field);
      const system = field.startsWith("technicalSignals.systemAnswers.") ? field.split(".").at(-1) : null;
      const control = this.element.querySelector<HTMLElement>(`[data-field="${escaped}"], [data-array-field="${escaped}"]`)
        ?? (system ? this.element.querySelector<HTMLElement>(`[data-system-answer="${CSS.escape(system)}"]`) : null)
        ?? (field === "systems" ? this.element.querySelector<HTMLElement>("[data-action='toggle-system']") : null)
        ?? this.element.querySelector<HTMLElement>("[aria-invalid='true']");
      control?.focus();
    }, 0);
  }

  private announce(message: string): void {
    const live = this.element.querySelector<HTMLElement>("[data-live]");
    if (!live) return;
    live.textContent = "";
    window.setTimeout(() => { live.textContent = message; }, 20);
  }

  private emitPresentationState(mode: SceneMode): void {
    this.options.onPresentationStateChange?.(this.getPresentationState(mode));
  }

  private finishClose(): void {
    if (!this.opened) return;
    this.activeRequest?.abort();
    this.activeRequest = null;
    this.closeModal();
    this.opened = false;
    this.element.dataset.open = "false";
    this.element.hidden = true;
    document.body.style.overflow = this.previousBodyOverflow;
    document.body.style.overscrollBehavior = this.previousBodyOverscroll;
    this.emitPresentationState("ORBIT_FOCUS");
    this.options.onClose?.();
    this.triggerElement?.focus();
    this.triggerElement = null;
  }
}

export function mountProjectOrbitFlow(options: ProjectOrbitFlowOptions): ProjectOrbitFlow {
  return new ProjectOrbitFlow(options);
}
