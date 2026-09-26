import "@fontsource/barlow-condensed/latin-900.css";
import "@fontsource/manrope/latin-400.css";
import "@fontsource/manrope/latin-600.css";
import "@fontsource/manrope/latin-700.css";
import "@phosphor-icons/webcomponents/PhArrowUpRight";
import "@phosphor-icons/webcomponents/PhArrowCounterClockwise";
import "@phosphor-icons/webcomponents/PhLockKey";
import "@phosphor-icons/webcomponents/PhSpeakerHigh";
import "@phosphor-icons/webcomponents/PhSpeakerSlash";
import "./styles.css";

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { AudioDirector, type AudioDirectorState } from "./AudioDirector";
import { CAMERA_SCRUB_SECONDS, HERO_JUMP_TARGETS } from "./CameraRig";
import type { DeploymentExperience as DeploymentExperienceInstance } from "./DeploymentExperience";
import {
  mountProjectOrbitFlow,
  type OrbitPresentationState as FlowOrbitPresentationState,
  type PlanetId,
  type ProjectOrbitFlow,
} from "./ProjectOrbitFlow";
import type {
  OrbitPlanetId,
  OrbitPresentationState as SceneOrbitPresentationState,
} from "./ProjectOrbitScene";
import { getAxsaiDetail, getAxsaiDetailId, type AxsaiDetail } from "./axsaiContent";
import { ORBIT_NAVIGATION_WORLDS, getOrbitNavigationWorld } from "./orbitNavigation";
import { chapterAtProgress, chapters, type ChapterId } from "./content";
import { renderInterface } from "./interface";

gsap.registerPlugin(ScrollTrigger);

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("Missing #app root");

renderInterface(root);
document.body.classList.add("is-loading");

const experienceShell = document.querySelector<HTMLElement>("[data-experience]");
const canvas = document.querySelector<HTMLCanvasElement>("[data-webgl]");
const loading = document.querySelector<HTMLElement>("[data-loading]");
const loadingBar = document.querySelector<HTMLElement>("[data-loading-bar]");
const loadingProgress = document.querySelector<HTMLElement>("[data-loading-progress]");
const loadingStage = document.querySelector<HTMLElement>("[data-loading-stage]");
const systemStatus = document.querySelector<HTMLElement>("[data-system-status]");
const journey = document.querySelector<HTMLElement>("[data-journey]");
const scrollCue = document.querySelector<HTMLElement>("[data-scroll-cue]");
const scrollCueLabel = document.querySelector<HTMLElement>("[data-scroll-cue-label]");
const soundButton = document.querySelector<HTMLButtonElement>("[data-sound]");
const chapterAnnouncer = document.querySelector<HTMLElement>("[data-chapter-announcer]");
const orbitCalibration = document.querySelector<HTMLElement>("[data-orbit-calibration]");
const orbitCalibrationCount = document.querySelector<HTMLElement>("[data-orbit-calibration-count]");
const orbitCalibrationBar = document.querySelector<HTMLElement>("[data-orbit-calibration-bar]");
const orbitReveal = document.querySelector<HTMLElement>("[data-orbit-reveal]");
const orbitSelector = document.querySelector<HTMLElement>("[data-orbit-selector]");
const orbitOverviewCopy = document.querySelector<HTMLElement>("[data-orbit-overview-copy]");
const orbitDossier = document.querySelector<HTMLElement>("[data-orbit-dossier]");
const orbitDossierIndex = document.querySelector<HTMLElement>("[data-orbit-dossier-index]");
const orbitDossierService = document.querySelector<HTMLElement>("[data-orbit-dossier-service]");
const orbitDossierEyebrow = document.querySelector<HTMLElement>("[data-orbit-dossier-eyebrow]");
const orbitDossierTitle = document.querySelector<HTMLElement>("[data-orbit-dossier-title]");
const orbitDossierSummary = document.querySelector<HTMLElement>("[data-orbit-dossier-summary]");
const orbitDossierSequence = document.querySelector<HTMLElement>("[data-orbit-dossier-sequence]");
const orbitDossierItems = document.querySelector<HTMLElement>("[data-orbit-dossier-items]");
const orbitDossierNote = document.querySelector<HTMLElement>("[data-orbit-dossier-note]");
const orbitDossierCtaLabel = document.querySelector<HTMLElement>("[data-orbit-dossier-cta-label]");
const orbitDossierRead = document.querySelector<HTMLButtonElement>("[data-orbit-dossier-read]");
const orbitReadingDialog = document.querySelector<HTMLDialogElement>("[data-orbit-reading-dialog]");
const orbitReadingWorld = document.querySelector<HTMLElement>("[data-orbit-reading-world]");
const orbitReadingSource = document.querySelector<HTMLElement>("[data-orbit-reading-source]");
const orbitReadingIndex = document.querySelector<HTMLElement>("[data-orbit-reading-index]");
const orbitReadingTitle = document.querySelector<HTMLElement>("[data-orbit-reading-title]");
const orbitReadingContent = document.querySelector<HTMLElement>("[data-orbit-reading-content]");
const orbitLive = document.querySelector<HTMLElement>("[data-orbit-live]");
const orbitPlanetLabels = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-orbit-planet]"));

if (!experienceShell || !canvas || !loading || !loadingBar || !loadingProgress || !loadingStage || !systemStatus || !journey || !soundButton) {
  throw new Error("The cinematic interface is incomplete");
}

let deployment: DeploymentExperienceInstance | null = null;
let activeChapter: ChapterId = "boot";
let activeInterfaceTone: "light" | "ink" = "light";
let currentProgress = 0;
let masterTimeline: gsap.core.Timeline | null = null;
let motionMedia: ReturnType<typeof gsap.matchMedia> | null = null;
let chapterJumpTween: gsap.core.Tween | null = null;
let pendingOrbitOpen = false;
let orbitOpening = false;
let orbitSceneActive = false;
let orbitPreloadPromise: Promise<void> | null = null;
let orbitPreloadFailed = false;
let orbitPreloadLoaded = 0;
let orbitPreloadTotal = 8;
let savedJourneyScrollY = 0;
let previousSelectedPlanets = "";
let focusedOrbitPlanet: OrbitPlanetId | null = null;
let hoveredOrbitPlanet: OrbitPlanetId | null = null;
let orbitReadingReturnFocus: HTMLElement | null = null;
let projectFlow: ProjectOrbitFlow;

const updateAudioInterface = (state: AudioDirectorState) => {
  experienceShell.dataset.audioState = state;
  const isPlaying = state === "playing" || state === "suspended";
  const isLoading = state === "loading";
  soundButton.setAttribute("aria-pressed", String(isPlaying));
  soundButton.setAttribute("aria-label", isPlaying ? "Turn music off" : "Turn music on");
  const icon = soundButton.querySelector<HTMLElement>("[data-sound-icon]");
  const label = soundButton.querySelector<HTMLElement>("[data-sound-label]");
  if (icon) {
    icon.innerHTML = isPlaying
      ? '<ph-speaker-high size="1rem" weight="regular"></ph-speaker-high>'
      : '<ph-speaker-slash size="1rem" weight="regular"></ph-speaker-slash>';
  }
  if (label) label.textContent = isLoading ? "MUSIC LOADING" : isPlaying ? "MUSIC ON" : "MUSIC OFF";
  if (scrollCueLabel) {
    scrollCueLabel.textContent = state === "armed" || isLoading
      ? "CLICK / TAP FOR SOUND · SCROLL TO ENTER"
      : "SCROLL TO ENTER";
  }
};

const audioDirector = new AudioDirector(updateAudioInterface);
experienceShell.dataset.audioState = audioDirector.getState();
audioDirector.preload();

const toOrbitPlanetId = (id: PlanetId | null): OrbitPlanetId | null => (
  id ? ORBIT_NAVIGATION_WORLDS.find((world) => world.leadSystem === id)?.id ?? null : null
);

const updateOrbitCalibration = (loaded: number, total: number, visible: boolean) => {
  orbitPreloadLoaded = loaded;
  orbitPreloadTotal = Math.max(1, total);
  if (orbitCalibrationCount) orbitCalibrationCount.textContent = `${loaded} / ${orbitPreloadTotal}`;
  if (orbitCalibrationBar) {
    gsap.to(orbitCalibrationBar, {
      scaleX: Math.min(1, loaded / orbitPreloadTotal),
      duration: 0.45,
      ease: "power3.out",
      overwrite: true,
    });
  }
  orbitCalibration?.classList.toggle("is-visible", visible);
  orbitCalibration?.setAttribute("aria-hidden", String(!visible));
};

const beginProjectOrbitPreload = (interactive = false): Promise<void> => {
  if (!deployment) return Promise.reject(new Error("Project Orbit requires WebGL"));
  if (deployment.getProjectOrbitAssetState() === "ready") {
    updateOrbitCalibration(orbitPreloadTotal, orbitPreloadTotal, false);
    return Promise.resolve();
  }
  if (interactive) updateOrbitCalibration(orbitPreloadLoaded, orbitPreloadTotal, true);
  if (!orbitPreloadPromise) {
    orbitPreloadPromise = deployment.preloadProjectOrbit((loaded, total) => {
      updateOrbitCalibration(loaded, total, interactive || orbitOpening);
    }).then(() => {
      orbitPreloadFailed = false;
      experienceShell.dataset.orbitAssets = "ready";
      updateOrbitCalibration(orbitPreloadTotal, orbitPreloadTotal, false);
    }).catch((error) => {
      orbitPreloadFailed = true;
      experienceShell.dataset.orbitAssets = "failed";
      updateOrbitCalibration(orbitPreloadLoaded, orbitPreloadTotal, false);
      throw error;
    });
  }
  return orbitPreloadPromise;
};

const syncOrbitPresentation = (state: FlowOrbitPresentationState) => {
  const completedMax = state.completedSteps.length ? Math.max(...state.completedSteps) : 0;
  const step = (state.mode === "RECEIVED" ? 3 : Math.min(3, Math.max(1, completedMax + 1))) as SceneOrbitPresentationState["step"];
  const selectedPlanetIds = state.selectedPlanets.map((id) => toOrbitPlanetId(id)!).filter(Boolean);
  const sceneState: SceneOrbitPresentationState = {
    step,
    focusedPlanetId: toOrbitPlanetId(state.focusedPlanet),
    selectedPlanetIds,
    submissionState: state.mode === "RECEIVED" ? "confirmed" : "idle",
  };
  deployment?.setProjectOrbitPresentation(sceneState);
  experienceShell.dataset.orbitStep = String(step);
  experienceShell.dataset.orbitMode = state.mode.toLowerCase();

  const selectionKey = [...state.selectedPlanets].sort().join("|");
  if (previousSelectedPlanets && selectionKey !== previousSelectedPlanets) audioDirector.playOrbitLock("select");
  previousSelectedPlanets = selectionKey;
  if (state.mode === "RECEIVED") audioDirector.playOrbitLock("submit");
};

const orbitWorldBySceneId = (id: OrbitPlanetId) => getOrbitNavigationWorld(id);

const toFlowPlanetId = (id: OrbitPlanetId): PlanetId | null => orbitWorldBySceneId(id).leadSystem ?? null;

const renderAxsaiDetail = (detail: AxsaiDetail, navigationLabel?: string) => {
  const world = ORBIT_NAVIGATION_WORLDS.find((candidate) => candidate.id === detail.worldId);
  if (orbitReadingWorld) {
    orbitReadingWorld.textContent = `${world?.index ?? "00"} / ${world?.label ?? "AXSAI"}`.toUpperCase();
  }
  if (orbitReadingSource) {
    orbitReadingSource.textContent = `LOCAL AXSAI SOURCE SNAPSHOT · ${new URL(detail.sourceUrl).hostname.toUpperCase()}`;
  }
  if (orbitReadingIndex) {
    orbitReadingIndex.textContent = detail.itemIndex ? `${detail.itemIndex} / READING` : "FULL PAGE / READING";
  }
  if (orbitReadingTitle) orbitReadingTitle.textContent = navigationLabel ?? detail.title;
  if (!orbitReadingContent) return;

  orbitReadingContent.replaceChildren(...detail.blocks.map((block) => {
    if (block.type === "heading") {
      const heading = document.createElement(block.level <= 2 ? "h3" : "h4");
      heading.textContent = block.text;
      return heading;
    }
    if (block.type === "list") {
      const list = document.createElement("ul");
      block.items.forEach((text) => {
        const item = document.createElement("li");
        item.textContent = text;
        list.append(item);
      });
      return list;
    }
    const paragraph = document.createElement("p");
    paragraph.textContent = block.text;
    return paragraph;
  }));
};

const openAxsaiDetail = (detailId: string, trigger: HTMLElement, navigationLabel?: string) => {
  const detail = getAxsaiDetail(detailId);
  if (!detail || !orbitReadingDialog) return;
  orbitReadingReturnFocus = trigger;
  renderAxsaiDetail(detail, navigationLabel);
  document.body.classList.add("is-orbit-reading");
  if (!orbitReadingDialog.open) orbitReadingDialog.showModal();
  const readingBody = orbitReadingDialog.querySelector<HTMLElement>("[data-orbit-reading-body]");
  if (readingBody) readingBody.scrollTop = 0;
  requestAnimationFrame(() => orbitReadingDialog.querySelector<HTMLButtonElement>("[data-orbit-reading-close]")?.focus());
  if (orbitLive) orbitLive.textContent = `${navigationLabel ?? detail.title} reading window opened.`;
};

const closeAxsaiDetail = () => {
  if (orbitReadingDialog?.open) orbitReadingDialog.close();
};

const renderOrbitDossier = (id: OrbitPlanetId) => {
  const world = orbitWorldBySceneId(id);
  const destination = world.destination;
  if (!orbitDossier || !orbitDossierItems) return;

  orbitDossier.hidden = false;
  orbitDossier.dataset.kind = destination.kind;
  if (orbitDossierIndex) orbitDossierIndex.textContent = `${world.index} / NAVIGATION`;
  if (orbitDossierService) orbitDossierService.textContent = world.label;
  if (orbitDossierEyebrow) orbitDossierEyebrow.textContent = destination.eyebrow;
  if (orbitDossierTitle) orbitDossierTitle.textContent = destination.title;
  if (orbitDossierSummary) orbitDossierSummary.textContent = destination.summary;
  if (orbitDossierCtaLabel) orbitDossierCtaLabel.textContent = destination.ctaLabel.toUpperCase();
  // Only the AXSAI destinations without a second-level navigation expose a
  // full-page entry here. Worlds with source sub-navigation open their own
  // preserved reading snapshots directly from the matching label.
  const rootDetailId = world.detailId;
  if (orbitDossierRead) {
    orbitDossierRead.hidden = !rootDetailId;
    if (rootDetailId) {
      orbitDossierRead.dataset.detailId = rootDetailId;
      orbitDossierRead.dataset.detailLabel = world.label;
    } else {
      delete orbitDossierRead.dataset.detailId;
      delete orbitDossierRead.dataset.detailLabel;
    }
  }

  if (orbitDossierSequence) {
    const sequence = destination.sequence ?? [];
    orbitDossierSequence.hidden = sequence.length === 0;
    orbitDossierSequence.replaceChildren(...sequence.map((label, index) => {
      const item = document.createElement("button");
      item.type = "button";
      item.dataset.dossierSequence = String(index);
      item.className = index === 0 ? "is-active" : "";
      item.innerHTML = `<span>${String(index + 1).padStart(2, "0")}</span><strong>${label}</strong>`;
      return item;
    }));
  }

  orbitDossierItems.replaceChildren(...destination.items.map((entry, index) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `orbit-dossier-item${index === 0 ? " is-active" : ""}`;
    item.dataset.dossierItem = String(index);
    const detailId = entry.detailId ?? getAxsaiDetailId(world.id, entry.index);
    if (detailId) {
      item.dataset.detailId = detailId;
      item.dataset.detailLabel = entry.title;
      item.setAttribute("aria-label", `Read ${entry.title}`);
    }
    item.innerHTML = `
      <span class="orbit-dossier-item__index">${entry.index}</span>
      <span class="orbit-dossier-item__copy">
        <small>${entry.kicker}</small>
        <strong>${entry.title}</strong>
        <em>${entry.body}</em>
      </span>
      ${entry.signal ? `<span class="orbit-dossier-item__signal">${entry.signal}</span>` : ""}
    `;
    return item;
  }));

  if (orbitDossierNote) {
    orbitDossierNote.hidden = !destination.note;
    orbitDossierNote.textContent = destination.note ?? "";
  }

  experienceShell.dataset.orbitDestination = destination.kind;
  requestAnimationFrame(() => {
    orbitDossier.classList.add("is-visible");
    gsap.fromTo(
      orbitDossier.querySelectorAll(".orbit-dossier__body > *, .orbit-dossier__footer"),
      { autoAlpha: 0, y: 18 },
      { autoAlpha: 1, y: 0, duration: 0.62, stagger: 0.045, ease: "power3.out", overwrite: true },
    );
  });
};

const focusOrbitPlanet = (id: OrbitPlanetId, playSound = true) => {
  focusedOrbitPlanet = id;
  deployment?.focusProjectOrbitPlanet(id);
  projectFlow.focusSystem(toFlowPlanetId(id));
  orbitSelector?.classList.add("is-focused");
  orbitOverviewCopy?.setAttribute("aria-hidden", "true");
  orbitPlanetLabels.forEach((label) => {
    const selected = label.dataset.orbitPlanet?.toLowerCase() === id;
    label.classList.toggle("is-focused", selected);
    label.setAttribute("aria-pressed", String(selected));
  });
  renderOrbitDossier(id);
  const world = orbitWorldBySceneId(id);
  experienceShell.dataset.orbitFocus = id;
  orbitLive && (orbitLive.textContent = `${world.label}, ${world.destination.label} focused.`);
  if (playSound) audioDirector.playOrbitLock("focus");
};

const showOrbitOverview = (announce = true) => {
  closeAxsaiDetail();
  focusedOrbitPlanet = null;
  deployment?.clearProjectOrbitFocus();
  projectFlow.focusSystem(null);
  orbitSelector?.classList.remove("is-focused");
  orbitOverviewCopy?.setAttribute("aria-hidden", "false");
  orbitPlanetLabels.forEach((label) => {
    label.classList.remove("is-focused");
    label.setAttribute("aria-pressed", "false");
  });
  orbitDossier?.classList.remove("is-visible");
  if (orbitDossier) window.setTimeout(() => {
    if (!focusedOrbitPlanet) orbitDossier.hidden = true;
  }, 520);
  delete experienceShell.dataset.orbitDestination;
  experienceShell.dataset.orbitFocus = "system";
  if (announce && orbitLive) orbitLive.textContent = "Project Orbit system view. Eleven worlds available.";
};

const showOrbitSelector = () => {
  if (!orbitSelector) return;
  orbitSelector.hidden = false;
  orbitSelector.setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => orbitSelector.classList.add("is-visible"));
  showOrbitOverview(false);
};

const hideOrbitSelector = () => {
  closeAxsaiDetail();
  if (!orbitSelector) return;
  orbitSelector.classList.remove("is-visible", "is-focused");
  orbitSelector.hidden = true;
  orbitSelector.setAttribute("aria-hidden", "true");
  if (orbitDossier) orbitDossier.hidden = true;
  focusedOrbitPlanet = null;
  hoveredOrbitPlanet = null;
};

const openMissionDeck = (preferredPlanet: OrbitPlanetId | null = focusedOrbitPlanet) => {
  hideOrbitSelector();
  experienceShell.dataset.orbitState = "mission-deck";
  const leadSystem = preferredPlanet ? toFlowPlanetId(preferredPlanet) : null;
  const selected = leadSystem ? [leadSystem] : undefined;
  projectFlow.open({ selectedSystems: selected, primarySystem: selected?.[0] });
  audioDirector.playOrbitLock("step");
};

const closeProjectOrbitScene = async () => {
  pendingOrbitOpen = false;
  orbitOpening = false;
  orbitReveal?.classList.remove("is-visible");
  orbitReveal?.setAttribute("aria-hidden", "true");
  updateOrbitCalibration(orbitPreloadLoaded, orbitPreloadTotal, false);
  hideOrbitSelector();
  audioDirector.setOrbitMode(false);
  if (orbitSceneActive && deployment) {
    try {
      await deployment.exitProjectOrbit();
    } catch (error) {
      console.warn("Project Orbit could not complete its reverse transition", error);
    }
  }
  orbitSceneActive = false;
  experienceShell.dataset.orbitState = "inactive";
  experienceShell.classList.remove("is-orbit-fallback");
  document.body.classList.remove("is-project-orbit");
  document.body.style.removeProperty("--orbit-scroll-lock");
  window.scrollTo(0, savedJourneyScrollY);
  ScrollTrigger.update();
};

const enterProjectOrbit = async () => {
  if (orbitOpening || projectFlow.isOpen) return;
  pendingOrbitOpen = false;
  orbitOpening = true;
  savedJourneyScrollY = window.scrollY;
  document.body.style.setProperty("--orbit-scroll-lock", `${-savedJourneyScrollY}px`);
  document.body.classList.add("is-project-orbit");
  experienceShell.dataset.orbitState = "calibrating";
  audioDirector.setOrbitMode(true);

  let useFallback = !deployment;
  if (deployment) {
    try {
      await beginProjectOrbitPreload(true);
      experienceShell.dataset.orbitState = "auto-reveal";
      orbitReveal?.classList.add("is-visible");
      orbitReveal?.setAttribute("aria-hidden", "false");
      await deployment.enterProjectOrbit((id) => {
        experienceShell.dataset.orbitFocus = id;
      });
      orbitSceneActive = true;
    } catch (error) {
      console.warn("Project Orbit is using the engineered fallback environment", error);
      useFallback = true;
    }
  }

  orbitReveal?.classList.remove("is-visible");
  orbitReveal?.setAttribute("aria-hidden", "true");
  updateOrbitCalibration(orbitPreloadLoaded, orbitPreloadTotal, false);
  experienceShell.classList.toggle("is-orbit-fallback", useFallback || orbitPreloadFailed);
  experienceShell.dataset.orbitState = useFallback ? "fallback-selector" : "interactive-overview";
  showOrbitSelector();
  orbitOpening = false;
};

projectFlow = mountProjectOrbitFlow({
  mount: document.body,
  privacyNoticeUrl: "/privacy/",
  privacyVersion: "LOCAL-PROTOTYPE-2026-07-18",
  onPresentationStateChange: syncOrbitPresentation,
  onClose: () => void closeProjectOrbitScene(),
});

let autoAudioArmed = false;
let autoAudioAttemptInFlight = false;

const armAutoAudio = () => {
  if (autoAudioArmed || audioDirector.isUserMuted()) return;
  autoAudioArmed = true;
  window.addEventListener("click", handleAutoAudioClick, true);
  window.addEventListener("touchend", handleAutoAudioTouch, { passive: true, capture: true });
  window.addEventListener("keydown", handleAutoAudioKey, true);
};

const disarmAutoAudio = () => {
  if (!autoAudioArmed) return;
  autoAudioArmed = false;
  window.removeEventListener("click", handleAutoAudioClick, true);
  window.removeEventListener("touchend", handleAutoAudioTouch, true);
  window.removeEventListener("keydown", handleAutoAudioKey, true);
};

const startAudioFromGesture = () => {
  if (!autoAudioArmed || autoAudioAttemptInFlight) return;
  disarmAutoAudio();
  autoAudioAttemptInFlight = true;
  void audioDirector.enableFromGesture().then((started) => {
    autoAudioAttemptInFlight = false;
    // Browser policy failures are retryable; only an explicit MUSIC OFF choice
    // suppresses automatic activation for the rest of this visit.
    if (!started && !audioDirector.isUserMuted()) armAutoAudio();
  });
};

function handleAutoAudioClick(event: MouseEvent) {
  if (event.button !== 0) return;
  const target = event.target;
  if (target instanceof Element && target.closest("[data-sound]")) return;
  startAudioFromGesture();
}

function handleAutoAudioTouch(event: TouchEvent) {
  const target = event.target;
  if (target instanceof Element && target.closest("[data-sound]")) return;
  startAudioFromGesture();
}

function handleAutoAudioKey(event: KeyboardEvent) {
  if (event.key !== "Enter" && event.key !== " ") return;
  const target = event.target;
  if (target instanceof Element && target.closest("[data-sound]")) return;
  startAudioFromGesture();
}

const setLoading = (progress: number, stage: string) => {
  const safe = Math.max(0, Math.min(1, progress));
  gsap.to(loadingBar, { scaleX: safe, duration: 0.4, ease: "power2.out", overwrite: true });
  loadingProgress.textContent = Math.round(safe * 100).toString().padStart(2, "0");
  loadingStage.textContent = stage;
};

const updateActiveChapter = (progress: number) => {
  // The interface follows the physical world change, not the nominal chapter
  // boundary. This keeps every label readable while Build warms up and while
  // the Protect blade performs the full-frame inversion.
  const nextTone = progress >= 0.11 && progress < 0.622 ? "ink" : "light";
  if (nextTone !== activeInterfaceTone) {
    activeInterfaceTone = nextTone;
    experienceShell.dataset.ui = nextTone;
  }

  const chapter = chapterAtProgress(progress);
  document.querySelectorAll<HTMLElement>("[data-jump]").forEach((item) => {
    const isCurrent = item.dataset.jump === chapter.id;
    item.classList.toggle("is-active", isCurrent);
    if (item.classList.contains("chapter-rail__item")) {
      if (isCurrent) item.setAttribute("aria-current", "step");
      else item.removeAttribute("aria-current");
    }
  });

  systemStatus.textContent = `${chapter.navLabel} / ${deployment?.getQuality().toUpperCase() ?? "FILM"} MODE`;
  if (chapter.id === activeChapter) return;

  activeChapter = chapter.id;
  if (chapterAnnouncer) chapterAnnouncer.textContent = `${chapter.navLabel}: ${chapter.title.replace("\n", " ")}`;
  const hash = chapter.id === "boot" ? "" : `#${chapter.id}`;
  history.replaceState(null, "", `${window.location.pathname}${window.location.search}${hash}`);
};

const cancelChapterJump = () => {
  chapterJumpTween?.kill();
  chapterJumpTween = null;
  pendingOrbitOpen = false;
};

const jumpToChapter = (id: ChapterId, immediate = false, onComplete?: () => void) => {
  if (!chapters.some((item) => item.id === id)) return;
  const scrollDistance = journey.offsetHeight - window.innerHeight;
  const destination = journey.offsetTop + scrollDistance * HERO_JUMP_TARGETS[id];
  cancelChapterJump();

  if (immediate) {
    window.scrollTo(0, destination);
    ScrollTrigger.update();
    onComplete?.();
    return;
  }

  const travel = Math.abs(destination - window.scrollY) / Math.max(1, scrollDistance);
  const duration = gsap.utils.clamp(0.65, 1.8, 0.65 + travel * 1.15);
  const scrollState = { y: window.scrollY };
  chapterJumpTween = gsap.to(scrollState, {
    y: destination,
    duration,
    ease: "power4.inOut",
    overwrite: true,
    onUpdate: () => window.scrollTo(0, scrollState.y),
    onComplete: () => {
      chapterJumpTween = null;
      onComplete?.();
    },
  });
};

const requestProjectOrbit = () => {
  if (projectFlow.isOpen || orbitOpening) return;
  if (currentProgress < 0.915) {
    jumpToChapter("finale", false, () => {
      if (pendingOrbitOpen) void enterProjectOrbit();
    });
    pendingOrbitOpen = true;
    return;
  }
  void enterProjectOrbit();
};

const updateOrbitLabelPositions = () => {
  if (!deployment || !orbitSceneActive || !orbitSelector || orbitSelector.hidden || window.innerWidth <= 820) return;
  const anchors = deployment.getProjectOrbitLabelAnchors();
  if (!anchors.length) return;
  const placed: Array<{ element: HTMLButtonElement; x: number; y: number; width: number; height: number }> = [];
  const marginX = 86;
  const marginY = 86;

  anchors.forEach((anchor) => {
    const element = orbitPlanetLabels.find((label) => label.dataset.orbitPlanet?.toLowerCase() === anchor.id);
    if (!element) return;
    element.classList.toggle("is-offscreen", !anchor.visible && !anchor.focused);
    if (!anchor.visible && !anchor.focused) return;
    const width = Math.max(122, element.offsetWidth || 156);
    const height = Math.max(48, element.offsetHeight || 56);
    const x = gsap.utils.clamp(marginX, window.innerWidth - marginX, anchor.x);
    const y = gsap.utils.clamp(marginY, window.innerHeight - marginY, anchor.y);
    element.classList.toggle("is-behind", !anchor.visible);
    placed.push({ element, x, y, width, height });
  });

  placed.sort((a, b) => a.y - b.y || a.x - b.x);
  for (let index = 0; index < placed.length; index += 1) {
    const current = placed[index];
    for (let previousIndex = 0; previousIndex < index; previousIndex += 1) {
      const previous = placed[previousIndex];
      const overlapsX = Math.abs(current.x - previous.x) < (current.width + previous.width) * 0.48 + 10;
      const overlapsY = Math.abs(current.y - previous.y) < (current.height + previous.height) * 0.48 + 8;
      if (overlapsX && overlapsY) current.y = Math.min(window.innerHeight - marginY, previous.y + (previous.height + current.height) * 0.5 + 10);
    }
  }

  placed.forEach(({ element, x, y }) => {
    element.style.setProperty("--orbit-label-x", `${x.toFixed(1)}px`);
    element.style.setProperty("--orbit-label-y", `${y.toFixed(1)}px`);
  });
};

const setupControls = () => {
  armAutoAudio();

  document.querySelectorAll<HTMLElement>("[data-jump]").forEach((control) => {
    control.addEventListener("click", (event) => {
      event.preventDefault();
      const target = control.dataset.jump as ChapterId | undefined;
      if (target) jumpToChapter(target);
    });
  });

  document.querySelector<HTMLElement>("[data-replay]")?.addEventListener("click", () => jumpToChapter("boot"));
  document.querySelectorAll<HTMLElement>("[data-open-project]").forEach((control) => {
    control.addEventListener("click", (event) => {
      event.preventDefault();
      requestProjectOrbit();
    });
  });
  document.querySelectorAll<HTMLElement>("[data-open-mission-deck]").forEach((control) => {
    control.addEventListener("click", () => openMissionDeck());
  });
  document.querySelector<HTMLElement>("[data-exit-orbit]")?.addEventListener("click", () => {
    if (!projectFlow.isOpen) void closeProjectOrbitScene();
  });
  document.querySelector<HTMLElement>("[data-orbit-system-view]")?.addEventListener("click", () => showOrbitOverview());
  document.querySelector<HTMLElement>("[data-orbit-dossier-cta]")?.addEventListener("click", () => openMissionDeck(focusedOrbitPlanet));
  document.querySelector<HTMLElement>("[data-orbit-reading-close]")?.addEventListener("click", closeAxsaiDetail);
  orbitReadingDialog?.addEventListener("cancel", (event) => {
    event.preventDefault();
    event.stopPropagation();
    closeAxsaiDetail();
  });
  orbitReadingDialog?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeAxsaiDetail();
    }
  });
  orbitReadingDialog?.addEventListener("click", (event) => {
    if (event.target === orbitReadingDialog) closeAxsaiDetail();
  });
  orbitReadingDialog?.addEventListener("close", () => {
    document.body.classList.remove("is-orbit-reading");
    const returnFocus = orbitReadingReturnFocus;
    orbitReadingReturnFocus = null;
    requestAnimationFrame(() => returnFocus?.focus());
    if (orbitLive) orbitLive.textContent = "Reading window closed.";
  });
  orbitPlanetLabels.forEach((label) => {
    const id = label.dataset.orbitPlanet?.toLowerCase() as OrbitPlanetId | undefined;
    if (!id) return;
    label.addEventListener("click", () => focusOrbitPlanet(id));
    label.addEventListener("pointerenter", () => {
      if (focusedOrbitPlanet) return;
      hoveredOrbitPlanet = id;
      deployment?.setProjectOrbitHoveredPlanet(id);
      label.classList.add("is-hovered");
    });
    label.addEventListener("pointerleave", () => {
      if (hoveredOrbitPlanet === id) hoveredOrbitPlanet = null;
      deployment?.setProjectOrbitHoveredPlanet(null);
      label.classList.remove("is-hovered");
    });
  });
  orbitDossier?.addEventListener("click", (event) => {
    const control = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-dossier-item], [data-dossier-sequence], [data-detail-id]") : null;
    if (!control) return;
    if (control.hasAttribute("data-dossier-item")) {
      orbitDossier.querySelectorAll("[data-dossier-item]").forEach((item) => item.classList.toggle("is-active", item === control));
    } else if (control.hasAttribute("data-dossier-sequence")) {
      orbitDossier.querySelectorAll("[data-dossier-sequence]").forEach((item) => item.classList.toggle("is-active", item === control));
    }
    const detailId = control.dataset.detailId;
    if (detailId) openAxsaiDetail(detailId, control, control.dataset.detailLabel);
  });

  ["wheel", "touchstart", "pointerdown", "keydown"].forEach((eventName) => {
    window.addEventListener(eventName, cancelChapterJump, { passive: true });
  });

  soundButton.addEventListener("click", async () => {
    const shouldMute = audioDirector.isEnabled();
    disarmAutoAudio();
    await audioDirector.setMuted(shouldMute);
    if (!shouldMute && !audioDirector.isEnabled() && !audioDirector.isUserMuted()) armAutoAudio();
  });

  document.addEventListener("visibilitychange", async () => {
    if (document.hidden) void audioDirector.suspend();
    else {
      await audioDirector.resume();
      if (!audioDirector.isEnabled() && !audioDirector.isUserMuted()) armAutoAudio();
    }
  });

  if (deployment && window.matchMedia("(pointer: fine)").matches) {
    const pointer = { x: 0, y: 0 };
    const xTo = gsap.quickTo(pointer, "x", { duration: 0.55, ease: "power3.out" });
    const yTo = gsap.quickTo(pointer, "y", { duration: 0.55, ease: "power3.out" });

    window.addEventListener("pointermove", (event) => {
      xTo((event.clientX / window.innerWidth) * 2 - 1);
      yTo(-((event.clientY / window.innerHeight) * 2 - 1));
    });

    gsap.ticker.add(() => deployment?.setPointer(pointer.x, pointer.y));
  }

  let orbitGestureStartX: number | null = null;
  let orbitGestureStartY = 0;
  window.addEventListener("pointerdown", (event) => {
    if (!orbitSceneActive || event.target instanceof Element && event.target.closest(".orbit-deck, .orbit-selector button, .orbit-dossier, .orbit-reading-dialog")) return;
    orbitGestureStartX = event.clientX;
    orbitGestureStartY = event.clientY;
  });
  window.addEventListener("pointerup", (event) => {
    if (orbitGestureStartX === null || !orbitSceneActive) return;
    const deltaX = event.clientX - orbitGestureStartX;
    const deltaY = event.clientY - orbitGestureStartY;
    orbitGestureStartX = null;
    if (Math.hypot(deltaX, deltaY) > 8) return;
    const picked = deployment?.pickProjectOrbitPlanet(event.clientX, event.clientY) ?? null;
    if (picked) focusOrbitPlanet(picked);
    else if (focusedOrbitPlanet) showOrbitOverview();
  });
  let hoverFrame = 0;
  window.addEventListener("pointermove", (event) => {
    if (!orbitSceneActive || focusedOrbitPlanet || window.matchMedia("(pointer: coarse)").matches) return;
    if (event.target instanceof Element && event.target.closest(".orbit-selector button, .orbit-dossier, .orbit-deck, .orbit-reading-dialog")) return;
    cancelAnimationFrame(hoverFrame);
    hoverFrame = requestAnimationFrame(() => {
      const picked = deployment?.pickProjectOrbitPlanet(event.clientX, event.clientY) ?? null;
      if (picked === hoveredOrbitPlanet) return;
      hoveredOrbitPlanet = picked;
      deployment?.setProjectOrbitHoveredPlanet(picked);
      orbitPlanetLabels.forEach((label) => label.classList.toggle("is-hovered", label.dataset.orbitPlanet?.toLowerCase() === picked));
    });
  }, { passive: true });
  window.addEventListener("keydown", (event) => {
    if (!orbitSceneActive || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
    if (orbitReadingDialog?.open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      if (focusedOrbitPlanet) showOrbitOverview();
      else void closeProjectOrbitScene();
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const currentIndex = focusedOrbitPlanet ? ORBIT_NAVIGATION_WORLDS.findIndex((world) => world.id === focusedOrbitPlanet) : -1;
      const delta = event.key === "ArrowRight" ? 1 : -1;
      const nextIndex = (currentIndex + delta + ORBIT_NAVIGATION_WORLDS.length) % ORBIT_NAVIGATION_WORLDS.length;
      focusOrbitPlanet(ORBIT_NAVIGATION_WORLDS[nextIndex].id);
    }
  });
  gsap.ticker.add(updateOrbitLabelPositions);
};

const buildTimeline = () => {
  const bootChapter = document.querySelector<HTMLElement>('[data-chapter="boot"]');
  if (bootChapter) gsap.set(bootChapter, { autoAlpha: 1, yPercent: 0, scale: 1 });

  motionMedia = gsap.matchMedia();
  motionMedia.add(
    {
      desktop: "(min-width: 821px)",
      mobile: "(max-width: 820px)",
    },
    (context) => {
      const sceneState = { progress: 0 };
      void context.conditions;

      masterTimeline = gsap.timeline({
        defaults: { ease: "none" },
        scrollTrigger: {
          trigger: journey,
          start: "top top",
          end: "bottom bottom",
          scrub: CAMERA_SCRUB_SECONDS,
          invalidateOnRefresh: true,
        },
      });

      masterTimeline.to(
        sceneState,
        {
          progress: 1,
          duration: 100,
          ease: "none",
          onUpdate: () => {
            currentProgress = sceneState.progress;
            deployment?.setProgress(sceneState.progress);
            updateActiveChapter(sceneState.progress);
            audioDirector.setProgress(sceneState.progress);
          },
        },
        0,
      );

      chapters.forEach((chapter) => {
        const element = document.querySelector<HTMLElement>(`[data-chapter="${chapter.id}"]`);
        if (!element) return;

        const start = chapter.start * 100;
        const end = chapter.end * 100;
        const span = end - start;
        const inDuration = Math.min(3.8, span * 0.27);
        const outDuration = Math.min(3.2, span * 0.23);

        if (chapter.id === "boot") {
          masterTimeline!.set(element, { autoAlpha: 1, yPercent: 0, scale: 1 }, 0);
        } else {
          masterTimeline!.fromTo(
            element,
            { autoAlpha: 0, yPercent: 11, scale: 0.985 },
            { autoAlpha: 1, yPercent: 0, scale: 1, duration: inDuration, ease: "power3.out", immediateRender: false },
            start,
          );
        }

        if (chapter.id !== "finale") {
          masterTimeline!.to(
            element,
            { autoAlpha: 0, yPercent: -8, scale: 1.012, duration: outDuration, ease: "power2.in" },
            end - outDuration,
          );
        }
      });

      const finaleLockup = document.querySelector<HTMLElement>("[data-finale-lockup]");
      if (finaleLockup) {
        masterTimeline.fromTo(
          finaleLockup,
          { autoAlpha: 0, y: 26, scale: 0.965 },
          { autoAlpha: 1, y: 0, scale: 1, duration: 3.8, ease: "power3.out", immediateRender: false },
          96.2,
        );
      }
      const finaleMeta = document.querySelector<HTMLElement>('[data-chapter="finale"] .chapter__meta');
      if (finaleMeta) {
        masterTimeline.to(
          finaleMeta,
          { autoAlpha: 0, y: -10, duration: 2.6, ease: "power2.out" },
          96.2,
        );
      }

      if (scrollCue) {
        masterTimeline.to(scrollCue, { autoAlpha: 0, x: -12, duration: 2.4, ease: "power2.out" }, 1.2);
      }

      ScrollTrigger.refresh();

      return () => {
        masterTimeline?.scrollTrigger?.kill();
        masterTimeline?.kill();
        masterTimeline = null;
      };
    },
  );

  const hash = window.location.hash.replace("#", "") as ChapterId;
  if (chapters.some((chapter) => chapter.id === hash)) {
    requestAnimationFrame(() => jumpToChapter(hash, true));
  } else {
    updateActiveChapter(0);
  }
};

const revealExperience = async (fallback = false) => {
  if (fallback) experienceShell.classList.add("is-fallback");
  experienceShell.dataset.ready = "true";
  document.body.classList.remove("is-loading");

  await new Promise<void>((resolve) => {
    gsap.timeline({ onComplete: resolve })
      .to(loading.querySelector(".loading__content"), { y: -18, autoAlpha: 0, duration: 0.55, ease: "power3.in" })
      .to(loading, { autoAlpha: 0, duration: 0.85, ease: "power3.inOut" }, "-=0.12")
      .set(loading, { display: "none" });
  });

  buildTimeline();
  document.querySelectorAll<HTMLElement>("[data-lock-while-loading]").forEach((element) => {
    element.inert = false;
    element.removeAttribute("aria-hidden");
  });
  setupControls();
  if (deployment) {
    window.setTimeout(() => {
      void beginProjectOrbitPreload(false).catch(() => undefined);
    }, 900);
  }
};

const boot = async () => {
  if (new URLSearchParams(window.location.search).get("mode") === "film") {
    setLoading(1, "FILM FALLBACK READY");
    await revealExperience(true);
    return;
  }

  try {
    const { DeploymentExperience } = await import("./DeploymentExperience");
    deployment = new DeploymentExperience(canvas);
    await deployment.load(setLoading);
    deployment.setProgress(0);
    deployment.start();
    await revealExperience(false);
  } catch (error) {
    console.error("WebGL experience unavailable; using the cinematic fallback.", error);
    deployment?.destroy();
    deployment = null;
    setLoading(1, "FILM FALLBACK READY");
    await revealExperience(true);
  }
};

void boot();

window.addEventListener("beforeunload", () => {
  cancelChapterJump();
  disarmAutoAudio();
  audioDirector.destroy();
  projectFlow.destroy();
  motionMedia?.revert();
  deployment?.destroy();
});

window.addEventListener("resize", () => requestAnimationFrame(() => updateActiveChapter(currentProgress)));
