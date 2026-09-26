import * as THREE from "three";
import gsap from "gsap";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { QualityTier } from "./DeploymentExperience";
import type { GlbAssetLoader } from "./GlbAssetLoader";
import {
  ORBIT_MODEL_FAMILIES,
  ORBIT_NAVIGATION_WORLDS,
  ORBIT_WORLD_IDS,
  type OrbitModelFamilyId,
  type OrbitWorldId,
} from "./orbitNavigation";

/** Legacy public name kept while consumers migrate from worlds to destinations. */
export const ORBIT_PLANET_IDS = ORBIT_WORLD_IDS;
export type OrbitPlanetId = OrbitWorldId;
export type OrbitAssetState = "idle" | "loading" | "ready" | "failed";
export type OrbitInteractionMode = "inactive" | "revealing" | "overview" | "focused" | "exiting";

/** Canvas-local CSS pixel coordinates for a DOM planet label. */
export interface OrbitLabelAnchor {
  id: OrbitPlanetId;
  x: number;
  y: number;
  depth: number;
  radiusPx: number;
  visible: boolean;
  focused: boolean;
  hovered: boolean;
}

export interface OrbitPresentationState {
  step: 1 | 2 | 3;
  focusedPlanetId: OrbitPlanetId | null;
  selectedPlanetIds: OrbitPlanetId[];
  submissionState: "idle" | "sending" | "confirmed" | "error";
}

interface AssetDescriptor {
  url: string;
  bytes?: number;
  sha256?: string;
}

interface PlanetManifestEntry {
  id: OrbitModelFamilyId;
  ultra?: AssetDescriptor;
  balanced?: AssetDescriptor;
}

interface OrbitManifest {
  version: string;
  system?: { ultra?: AssetDescriptor; balanced?: AssetDescriptor };
  star?: { ultra?: AssetDescriptor; balanced?: AssetDescriptor };
  planets?: PlanetManifestEntry[];
}

interface PlanetActor {
  id: OrbitPlanetId;
  modelFamily: OrbitModelFamilyId;
  baseVariant: PlanetVisualVariant;
  heroVariant: PlanetVisualVariant | null;
  orbitFrame: THREE.Group;
  spinFrame: THREE.Group;
  hitProxy: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  fullScale: number;
  orbitRadiusX: number;
  orbitRadiusY: number;
  orbitDepth: number;
  orbitDepthPhase: number;
  orbitDepthOffset: number;
  orbitTilt: number;
  orbitPhase: number;
}

interface PlanetVisualVariant {
  tier: "balanced" | "ultra";
  root: THREE.Group;
  authoredRoot: THREE.Object3D;
  mixer: THREE.AnimationMixer | null;
  signatureActions: THREE.AnimationAction[];
  signatureClips: THREE.AnimationClip[];
}

const fullPositions: Record<OrbitPlanetId, THREE.Vector3> = {
  about: new THREE.Vector3(-9.35, 3.2, -3.35),
  services: new THREE.Vector3(-5.15, 2.18, -0.25),
  solution: new THREE.Vector3(-1.05, 3.85, -4.15),
  "work-flow": new THREE.Vector3(3.65, 2.65, -1.25),
  "technology-stack": new THREE.Vector3(8.15, 3.12, -3.85),
  tools: new THREE.Vector3(-8.45, -2.45, -0.45),
  products: new THREE.Vector3(-4.45, -3.58, -2.85),
  clients: new THREE.Vector3(-0.15, -4.02, -0.82),
  "why-axsai": new THREE.Vector3(4.25, -3.65, -2.1),
  blog: new THREE.Vector3(7.95, -2.5, -0.32),
  contact: new THREE.Vector3(10.2, -0.15, -3.05),
};

const fullScales: Record<OrbitPlanetId, number> = {
  about: 0.9,
  services: 1.05,
  solution: 0.88,
  "work-flow": 1.05,
  "technology-stack": 0.92,
  tools: 0.9,
  products: 0.93,
  clients: 0.85,
  "why-axsai": 0.94,
  blog: 0.86,
  contact: 0.86,
};

const STAR_POSITION = new THREE.Vector3(0, 0, -1.4);
const ORBIT_VERTICAL_ASPECT = 0.38;
// Project Orbit owns its own photometric grade.  These values intentionally
// match the brighter automatic reveal and are reasserted while the scene is
// active so the corridor performance governor cannot pull the system back to
// the much darker post-Protect film grade.
const ORBIT_OVERVIEW_EXPOSURE = 0.94;
const ORBIT_FOCUS_EXPOSURE = 0.98;
const ORBIT_OVERVIEW_ENVIRONMENT_INTENSITY = 0.82;
const ORBIT_FOCUS_ENVIRONMENT_INTENSITY = 0.9;

// During the automatic reveal every world approaches along its own visible
// rail. These are phase offsets on the exact ellipse, never free-space
// translation offsets, so the planet remains physically attached to the
// orbit from its first readable frame.
const emergencePhaseOffsets: Record<OrbitPlanetId, number> = {
  about: 0.92,
  services: -0.74,
  solution: 1.08,
  "work-flow": -0.86,
  "technology-stack": 0.78,
  tools: -1.02,
  products: 0.88,
  clients: -0.68,
  "why-axsai": 1.02,
  blog: -0.91,
  contact: 0.64,
};

const emergenceSpin: Record<OrbitPlanetId, THREE.Vector3> = {
  about: new THREE.Vector3(-0.42, -1.1, -0.28),
  services: new THREE.Vector3(0.34, 0.92, 0.38),
  solution: new THREE.Vector3(-0.58, -0.74, -0.22),
  "work-flow": new THREE.Vector3(0.52, 0.88, -0.36),
  "technology-stack": new THREE.Vector3(-0.28, -1.16, 0.3),
  tools: new THREE.Vector3(0.46, 0.76, -0.42),
  products: new THREE.Vector3(-0.62, -0.92, 0.26),
  clients: new THREE.Vector3(0.42, 0.72, 0.26),
  "why-axsai": new THREE.Vector3(-0.48, -0.9, -0.32),
  blog: new THREE.Vector3(0.36, 0.86, 0.22),
  contact: new THREE.Vector3(-0.44, -0.78, -0.3),
};

// Authoring fronts face the web camera at yaw 0. Small offsets reveal depth
// without ever allowing a focused planet to drift around to its unreadable
// back side while the visitor is studying it.
const heroYaws: Record<OrbitPlanetId, number> = {
  about: -0.2,
  services: THREE.MathUtils.degToRad(28),
  solution: THREE.MathUtils.degToRad(26),
  "work-flow": -0.17,
  "technology-stack": THREE.MathUtils.degToRad(22),
  tools: 0.16,
  products: THREE.MathUtils.degToRad(-22),
  clients: THREE.MathUtils.degToRad(44),
  "why-axsai": THREE.MathUtils.degToRad(34),
  blog: THREE.MathUtils.degToRad(-18),
  contact: THREE.MathUtils.degToRad(14),
};

// Kept deliberately shallow: the orbital system reads as a wide industrial
// composition, not a stack of steep decorative rings.
const orbitTilts: Record<OrbitPlanetId, number> = {
  about: THREE.MathUtils.degToRad(-4.8),
  services: THREE.MathUtils.degToRad(3.6),
  solution: THREE.MathUtils.degToRad(-3.2),
  "work-flow": THREE.MathUtils.degToRad(5.7),
  "technology-stack": THREE.MathUtils.degToRad(-4.1),
  tools: THREE.MathUtils.degToRad(3),
  products: THREE.MathUtils.degToRad(-6.2),
  clients: THREE.MathUtils.degToRad(2.4),
  "why-axsai": THREE.MathUtils.degToRad(-4.4),
  blog: THREE.MathUtils.degToRad(4.6),
  contact: THREE.MathUtils.degToRad(-2.8),
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const smoothRange = (value: number, start: number, end: number) => {
  const progress = clamp01((value - start) / Math.max(0.0001, end - start));
  return progress * progress * (3 - 2 * progress);
};
const lerpAngle = (from: number, to: number, amount: number) => (
  from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * amount
);

const versionedAssetUrl = (descriptor: AssetDescriptor): string => {
  if (!descriptor.sha256) return descriptor.url;
  const separator = descriptor.url.includes("?") ? "&" : "?";
  return `${descriptor.url}${separator}v=${descriptor.sha256.slice(0, 16)}`;
};

export class ProjectOrbitScene {
  private readonly root = new THREE.Group();
  private readonly backgroundField = new THREE.Group();
  private readonly starSlot = new THREE.Group();
  private readonly planetSlot = new THREE.Group();
  private readonly orbitInfrastructure = new THREE.Group();
  private readonly actorOrbitTracks = new THREE.Group();
  private readonly environmentArchitecture = new THREE.Group();
  private readonly actors = new Map<OrbitPlanetId, PlanetActor>();
  private readonly baseTemplates = new Map<OrbitModelFamilyId, PlanetVisualVariant>();
  private readonly heroTemplates = new Map<OrbitModelFamilyId, PlanetVisualVariant>();
  private readonly hitTargets: THREE.Object3D[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointerNdc = new THREE.Vector2();
  private readonly worldPoint = new THREE.Vector3();
  private readonly projectedPoint = new THREE.Vector3();
  private readonly projectedEdge = new THREE.Vector3();
  private readonly cameraRight = new THREE.Vector3();
  private readonly state = {
    reveal: 0,
    cameraBlend: 0,
    focusBlend: 0,
    focusIndex: 0,
    exitFade: 1,
    zoom: 0,
  };
  private assetState: OrbitAssetState = "idle";
  private active = false;
  private entryTimeline: gsap.core.Timeline | null = null;
  private focusTween: gsap.core.Tween | null = null;
  private savedCameraPosition = new THREE.Vector3();
  private savedCameraQuaternion = new THREE.Quaternion();
  private savedFov = 42;
  private savedExposure = 0.78;
  private savedEnvironmentIntensity = 0.55;
  private savedBackground: THREE.Scene["background"] = null;
  private savedFog: THREE.Fog | THREE.FogExp2 | null = null;
  private starRoot: THREE.Object3D | null = null;
  private starBaseScale = new THREE.Vector3(1, 1, 1);
  private generatedInfrastructure: THREE.Group | null = null;
  private blenderInfrastructure: THREE.Object3D | null = null;
  private selected = new Set<OrbitPlanetId>();
  private onFocus?: (id: OrbitPlanetId) => void;
  private mode: OrbitInteractionMode = "inactive";
  private focusedPlanetId: OrbitPlanetId | null = null;
  private hoveredPlanetId: OrbitPlanetId | null = null;
  private baseAssetTier: "balanced" | "ultra" = "balanced";
  private heroAssetsLoaded = 0;
  private readonly heroLru: OrbitPlanetId[] = [];
  private orbitAmbient!: THREE.HemisphereLight;
  private orbitKey!: THREE.DirectionalLight;
  private orbitSignalLight!: THREE.PointLight;
  private orbitCoolFill!: THREE.DirectionalLight;
  private focusKey!: THREE.SpotLight;
  private focusRim!: THREE.PointLight;
  private readonly focusLightTarget = new THREE.Object3D();
  private disposed = false;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly renderer: THREE.WebGLRenderer,
    private readonly assetLoader: GlbAssetLoader,
    private readonly quality: QualityTier,
    private readonly experienceElement: HTMLElement | null,
  ) {
    this.root.name = "ProjectOrbit_Runtime";
    this.root.visible = false;
    this.environmentArchitecture.name = "ProjectOrbit_IndustrialDock";
    this.actorOrbitTracks.name = "ProjectOrbit_ExactActorTracks";
    this.root.add(
      this.backgroundField,
      this.environmentArchitecture,
      this.starSlot,
      this.actorOrbitTracks,
      this.planetSlot,
      this.orbitInfrastructure,
    );
    this.scene.add(this.root);
    this.createOrbitalBackdrop();
    this.createEnvironmentArchitecture();
    this.createOrbitInfrastructure();
    this.createOrbitLighting();
    this.updateDatasets();
  }

  getAssetState(): OrbitAssetState {
    return this.assetState;
  }

  isActive(): boolean {
    return this.active;
  }

  async preload(onProgress?: (loaded: number, total: number) => void): Promise<void> {
    if (this.assetState === "ready") return;
    if (this.assetState === "loading") {
      await new Promise<void>((resolve, reject) => {
        const poll = window.setInterval(() => {
          if (this.assetState === "ready") {
            window.clearInterval(poll);
            resolve();
          } else if (this.assetState === "failed") {
            window.clearInterval(poll);
            reject(new Error("Project Orbit assets failed to load"));
          }
        }, 120);
      });
      return;
    }

    this.assetState = "loading";
    this.updateDatasets();
    try {
      const response = await fetch("/assets/orbit/orbit-manifest.json", { cache: "no-cache" });
      if (!response.ok) throw new Error(`Orbit manifest unavailable (${response.status})`);
      const manifest = await response.json() as OrbitManifest;
      const tier = this.quality === "ultra" ? "ultra" : "balanced";
      this.baseAssetTier = tier;
      this.heroAssetsLoaded = 0;
      this.baseTemplates.clear();
      this.heroTemplates.clear();
      const entries = manifest.planets ?? [];
      const baseUnits = 8;
      const heroEntries: Array<{ id: OrbitModelFamilyId; descriptor: AssetDescriptor }> = [];
      if (this.quality === "balanced") {
        entries.forEach((entry) => {
          if (!entry.ultra?.url) return;
          heroEntries.push({ id: entry.id, descriptor: entry.ultra });
        });
      }
      const totalUnits = baseUnits + heroEntries.length;

      if (manifest.system?.[tier]?.url) {
        const descriptor = manifest.system[tier]!;
        const gltf = await this.assetLoader.load(versionedAssetUrl(descriptor));
        this.adoptSystem(gltf.scene, gltf.animations);
        onProgress?.(baseUnits, totalUnits);
      } else {
        let loaded = 0;
        if (manifest.star?.[tier]?.url) {
          const descriptor = manifest.star[tier]!;
          const gltf = await this.assetLoader.load(versionedAssetUrl(descriptor));
          this.adoptStar(gltf.scene);
          loaded += 1;
          onProgress?.(loaded, totalUnits);
        }
        for (const id of ORBIT_MODEL_FAMILIES) {
          const entry = entries.find((candidate) => candidate.id === id);
          const descriptor = entry?.[tier] ?? entry?.balanced ?? entry?.ultra;
          if (!descriptor?.url) throw new Error(`Orbit manifest is missing ${id}`);
          const gltf = await this.assetLoader.load(versionedAssetUrl(descriptor));
          this.adoptPlanetTemplate(id, gltf.scene, gltf.animations);
          loaded += 1;
          onProgress?.(loaded, totalUnits);
        }
        this.instantiateNavigationWorlds();
      }

      // A selected world fills most of the frame, so WEB_LOD1 cannot be the
      // final close-up on Balanced desktops. Parse and attach every WEB_LOD0
      // hero during Stage 2, before Orbit is advertised as ready. This moves
      // all GLB parsing, shader compilation and GPU upload out of the click
      // path; only one hidden variant is activated at runtime.
      for (let index = 0; index < heroEntries.length; index += 1) {
        const { id, descriptor } = heroEntries[index];
        try {
          const gltf = await this.assetLoader.load(versionedAssetUrl(descriptor));
          const variant = this.createPlanetVariant(id, gltf.scene, gltf.animations, "ultra");
          await this.prewarmHeroVariant(variant);
          this.heroTemplates.set(id, variant);
          this.heroAssetsLoaded += 1;
        } catch (error) {
          console.warn(`Project Orbit ${id} Ultra focus asset unavailable; retaining Balanced focus.`, error);
        }
        onProgress?.(baseUnits + index + 1, totalUnits);
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      }

      this.validateActors();
      await this.prewarm();
      this.assetState = "ready";
      this.updateDatasets();
    } catch (error) {
      console.error("Project Orbit assets unavailable; the diagnostic will use its engineered 2D fallback.", error);
      this.assetState = "failed";
      this.updateDatasets();
      throw error;
    }
  }

  async enter(onFocus?: (id: OrbitPlanetId) => void): Promise<void> {
    if (this.assetState !== "ready") throw new Error("Project Orbit is not ready");
    this.entryTimeline?.kill();
    this.focusTween?.kill();
    this.onFocus = onFocus;
    this.active = true;
    this.mode = "revealing";
    this.focusedPlanetId = null;
    this.hoveredPlanetId = null;
    this.root.visible = false;
    this.savedCameraPosition.copy(this.camera.position);
    this.savedCameraQuaternion.copy(this.camera.quaternion);
    this.savedFov = this.camera.fov;
    this.savedExposure = this.renderer.toneMappingExposure;
    this.savedEnvironmentIntensity = this.scene.environmentIntensity;
    this.savedBackground = this.scene.background;
    this.savedFog = this.scene.fog;
    this.scene.background = new THREE.Color(0x070c10);
    this.scene.fog = new THREE.FogExp2(0x091118, 0.0072);
    this.scene.environmentIntensity = ORBIT_OVERVIEW_ENVIRONMENT_INTENSITY;
    this.renderer.toneMappingExposure = ORBIT_OVERVIEW_EXPOSURE;
    Object.assign(this.state, { reveal: 0, cameraBlend: 0, focusBlend: 0, focusIndex: 0, exitFade: 1, zoom: 0 });
    this.updateLayout(performance.now() / 1000, 0);
    this.root.visible = true;
    this.experienceElement?.setAttribute("data-orbit-state", "auto-reveal");
    this.experienceElement?.removeAttribute("data-orbit-journey");
    this.experienceElement?.removeAttribute("data-orbit-hover");
    this.experienceElement?.removeAttribute("data-orbit-focus");

    await new Promise<void>((resolve) => {
      this.entryTimeline = gsap.timeline({
        onComplete: () => {
          this.mode = "overview";
          this.experienceElement?.setAttribute("data-orbit-state", "overview");
          resolve();
        },
      });
      this.entryTimeline.to(this.state, {
        cameraBlend: 1,
        duration: 1.35,
        ease: "power3.out",
      }, 0);
      this.entryTimeline.to(this.state, {
        reveal: 1,
        duration: 4.8,
        ease: "power3.inOut",
      }, 0);
      ORBIT_PLANET_IDS.forEach((id, index) => {
        this.entryTimeline?.call(() => this.playSignature(id, 3.25), [], 0.3 + index * 0.38);
      });
    });
  }

  /** @deprecated Project Orbit is click-driven. Kept as a harmless bridge while callers migrate. */
  setJourneyProgress(_progress: number): void {
    // Intentionally empty. Scroll progress must never move the click-driven
    // camera or scrub Blender signature actions.
  }

  async exit(): Promise<void> {
    if (!this.active) return;
    this.entryTimeline?.kill();
    this.focusTween?.kill();
    this.mode = "exiting";
    this.focusedPlanetId = null;
    this.setHoveredPlanet(null);
    this.renderer.domElement.style.cursor = "";
    this.experienceElement?.setAttribute("data-orbit-state", "exiting");
    await new Promise<void>((resolve) => {
      gsap.timeline({ onComplete: resolve })
        .to(this.state, { focusBlend: 0, duration: 0.65, ease: "power3.inOut" })
        .to(this.state, { reveal: 0, cameraBlend: 0, duration: 1.05, ease: "power4.inOut" }, "-=0.18");
    });
    this.active = false;
    this.mode = "inactive";
    this.root.visible = false;
    this.camera.position.copy(this.savedCameraPosition);
    this.camera.quaternion.copy(this.savedCameraQuaternion);
    this.camera.fov = this.savedFov;
    this.camera.updateProjectionMatrix();
    this.renderer.toneMappingExposure = this.savedExposure;
    this.scene.environmentIntensity = this.savedEnvironmentIntensity;
    this.scene.background = this.savedBackground;
    this.scene.fog = this.savedFog;
    this.experienceElement?.setAttribute("data-orbit-state", "inactive");
  }

  setPresentation(presentation: OrbitPresentationState): void {
    this.selected = new Set(presentation.selectedPlanetIds);
    if (presentation.focusedPlanetId) this.focus(presentation.focusedPlanetId, false);
    else if (this.focusedPlanetId && this.mode === "focused") this.clearFocus();
    this.root.userData.flowStep = presentation.step;
    this.root.userData.submissionState = presentation.submissionState;
    this.applySelectionMaterials();
  }

  focus(id: OrbitPlanetId, notify = true): void {
    const index = ORBIT_PLANET_IDS.indexOf(id);
    if (index < 0 || !this.active || this.mode === "revealing" || this.mode === "exiting") return;
    void this.ensureHeroVariant(id);
    if (this.focusedPlanetId === id && this.state.focusBlend > 0.985) return;
    this.focusTween?.kill();
    this.focusedPlanetId = id;
    this.hoveredPlanetId = null;
    this.mode = "focused";
    this.experienceElement?.setAttribute("data-orbit-state", "focused");
    this.experienceElement?.setAttribute("data-orbit-focus", id);
    this.experienceElement?.removeAttribute("data-orbit-hover");
    this.renderer.domElement.style.cursor = "default";
    this.applySelectionMaterials();
    this.updateDatasets();
    this.focusTween = gsap.to(this.state, {
      focusIndex: index,
      focusBlend: 1,
      duration: 0.85,
      ease: "power4.inOut",
      overwrite: true,
      onComplete: () => {
        this.playSignature(id);
        if (notify) this.onFocus?.(id);
      },
    });
  }

  clearFocus(): void {
    if (!this.active || this.mode === "revealing" || this.mode === "exiting") return;
    this.focusTween?.kill();
    this.focusTween = gsap.to(this.state, {
      focusBlend: 0,
      duration: 0.72,
      ease: "power4.inOut",
      overwrite: true,
      onComplete: () => {
        this.focusedPlanetId = null;
        this.mode = "overview";
        this.experienceElement?.setAttribute("data-orbit-state", "overview");
        this.experienceElement?.removeAttribute("data-orbit-focus");
        this.applySelectionMaterials();
        this.updateDatasets();
      },
    });
  }

  getInteractionMode(): OrbitInteractionMode {
    return this.mode;
  }

  getFocusedPlanet(): OrbitPlanetId | null {
    return this.focusedPlanetId;
  }

  setHoveredPlanet(id: OrbitPlanetId | null): void {
    const next = id && this.actors.has(id) && this.mode !== "revealing" && this.mode !== "exiting" ? id : null;
    if (this.hoveredPlanetId === next) return;
    this.hoveredPlanetId = next;
    if (next) void this.ensureHeroVariant(next);
    if (next) this.experienceElement?.setAttribute("data-orbit-hover", next);
    else this.experienceElement?.removeAttribute("data-orbit-hover");
    this.renderer.domElement.style.cursor = next ? "pointer" : "";
    this.applySelectionMaterials();
  }

  pickPlanet(clientX: number, clientY: number): OrbitPlanetId | null {
    if (!this.active || this.mode === "revealing" || this.mode === "exiting" || this.state.reveal < 0.98) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
    this.pointerNdc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.camera.updateMatrixWorld(true);
    this.root.updateMatrixWorld(true);
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const intersections = this.raycaster.intersectObjects(this.hitTargets, false);
    for (const intersection of intersections) {
      const id = intersection.object.userData.planetId as OrbitPlanetId | undefined;
      if (!id) continue;
      const actor = this.actors.get(id);
      if (actor && this.actorIsVisible(actor)) return id;
    }
    return null;
  }

  cycle(direction: -1 | 1): void {
    const current = this.focusedPlanetId
      ? ORBIT_PLANET_IDS.indexOf(this.focusedPlanetId)
      : Math.round(this.state.focusIndex);
    const next = (current + direction + ORBIT_PLANET_IDS.length) % ORBIT_PLANET_IDS.length;
    this.focus(ORBIT_PLANET_IDS[next]);
  }

  adjustZoom(delta: number): void {
    gsap.to(this.state, {
      zoom: THREE.MathUtils.clamp(this.state.zoom + delta, -1, 1),
      duration: 0.42,
      ease: "power3.out",
      overwrite: "auto",
    });
  }

  update(delta: number, elapsed: number): void {
    if (!this.active) return;
    // Navigation worlds deliberately rest on their authored track anchors.
    // The only continuous movement is local mechanical breathing in updateLayout.
    this.updateLayout(elapsed, delta);
    this.actors.forEach((actor) => {
      [actor.baseVariant, actor.heroVariant].forEach((variant) => {
        if (!variant?.root.visible || !variant.mixer) return;
        // Ultra templates stay GPU-resident for instant focus, but
        // invisible/paused animation graphs must not consume main-thread time.
        // Only the currently visible variant with an action still running is
        // sampled. Once a clamped signature action finishes, its pose remains
        // intact without continuing to evaluate dozens of dormant bindings.
        if (!variant.signatureActions.some((action) => action.isRunning())) return;
        variant.mixer.update(delta);
      });
    });
  }

  applyCamera(pointer: THREE.Vector2): void {
    if (!this.active) return;
    const compact = window.innerWidth <= 820;
    const fullPosition = compact ? new THREE.Vector3(0, 4.65, 25.2) : new THREE.Vector3(0, 4.15, 21.7);
    const focusPosition = compact ? new THREE.Vector3(0, 3.25, 14.9) : new THREE.Vector3(0, 2.35, 14.6);
    const targetPosition = fullPosition.lerp(focusPosition, this.state.focusBlend);
    targetPosition.z += this.state.zoom * (compact ? 1.45 : 2.2);
    const entryPosition = this.savedCameraPosition.clone().lerp(targetPosition, this.state.cameraBlend);
    if (!compact) {
      entryPosition.x += pointer.x * 0.13;
      entryPosition.y += pointer.y * 0.08;
    }
    this.camera.position.copy(entryPosition);
    const lookTarget = new THREE.Vector3(
      compact ? 0 : -2.05 * this.state.focusBlend,
      THREE.MathUtils.lerp(0.15, 0.3, this.state.focusBlend),
      -1.4,
    );
    const orbitQuaternion = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().lookAt(this.camera.position, lookTarget, new THREE.Vector3(0, 1, 0)),
    );
    this.camera.quaternion.copy(this.savedCameraQuaternion).slerp(orbitQuaternion, this.state.cameraBlend);
    this.camera.rotateZ(THREE.MathUtils.degToRad(pointer.x * 0.28 * this.state.focusBlend));
    const overviewFov = compact ? 58 : 46;
    const focusFov = compact ? 55 : 45;
    this.camera.fov = THREE.MathUtils.lerp(
      this.savedFov,
      THREE.MathUtils.lerp(overviewFov, focusFov, this.state.focusBlend),
      this.state.cameraBlend,
    );
    this.camera.updateProjectionMatrix();
  }

  getProjectedLabelAnchors(): OrbitLabelAnchor[] {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (!this.active || rect.width <= 0 || rect.height <= 0) return [];
    this.camera.updateMatrixWorld(true);
    this.root.updateMatrixWorld(true);
    this.cameraRight.setFromMatrixColumn(this.camera.matrixWorld, 0).normalize();
    const compact = rect.width <= 820;
    const anchors: OrbitLabelAnchor[] = ORBIT_PLANET_IDS.map((id) => {
      const actor = this.actors.get(id);
      if (!actor) {
        return { id, x: 0, y: 0, depth: 1, radiusPx: 0, visible: false, focused: false, hovered: false };
      }
      actor.orbitFrame.getWorldPosition(this.worldPoint);
      this.projectedPoint.copy(this.worldPoint).project(this.camera);
      const worldRadius = Math.max(0.12, actor.hitProxy.scale.x);
      this.projectedEdge
        .copy(this.worldPoint)
        .addScaledVector(this.cameraRight, worldRadius)
        .project(this.camera);
      const radiusPx = THREE.MathUtils.clamp(
        Math.abs(this.projectedEdge.x - this.projectedPoint.x) * rect.width * 0.5,
        compact ? 18 : 22,
        compact ? 210 : 310,
      );
      const rawX = (this.projectedPoint.x * 0.5 + 0.5) * rect.width;
      const rawY = (-this.projectedPoint.y * 0.5 + 0.5) * rect.height + radiusPx + (compact ? 10 : 14);
      const visible = this.state.reveal > 0.93
        && this.actorIsVisible(actor)
        && this.projectedPoint.z > -1
        && this.projectedPoint.z < 1
        && this.projectedPoint.x > -1.24
        && this.projectedPoint.x < 1.24
        && this.projectedPoint.y > -1.3
        && this.projectedPoint.y < 1.3;
      return {
        id,
        x: THREE.MathUtils.clamp(rawX, compact ? 64 : 92, rect.width - (compact ? 64 : 92)),
        y: THREE.MathUtils.clamp(rawY, compact ? 48 : 58, rect.height - (compact ? 48 : 58)),
        depth: this.projectedPoint.z,
        radiusPx,
        visible,
        focused: this.focusedPlanetId === id,
        hovered: this.hoveredPlanetId === id,
      };
    });

    return anchors;
  }

  dispose(): void {
    this.disposed = true;
    this.entryTimeline?.kill();
    this.focusTween?.kill();
    this.renderer.domElement.style.cursor = "";
    [...this.heroLru].forEach((id) => this.releaseHeroVariant(id));
    this.root.traverse((object) => {
      if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.Points) && !(object instanceof THREE.Line)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => material.dispose());
    });
    this.root.removeFromParent();
  }

  private adoptSystem(system: THREE.Object3D, animations: THREE.AnimationClip[]): void {
    const star = this.findNamed(system, ["ReactorSun_ROOT", "OrbitStar_ROOT", "Star_EGain_ROOT", "ReactorSun"]);
    if (!star) throw new Error("Orbit system is missing its e Gain reactor star root");
    this.adoptStar(star);
    ORBIT_MODEL_FAMILIES.forEach((id) => {
      const title = id[0].toUpperCase() + id.slice(1);
      const planet = this.findNamed(system, [`Planet_${title}_ROOT`, `Planet_${id.toUpperCase()}_ROOT`, `Planet_${id}_ROOT`]);
      if (!planet) throw new Error(`Orbit system is missing ${id}`);
      this.adoptPlanetTemplate(id, planet, animations.filter((clip) => clip.name.toLowerCase().includes(id)));
    });
    this.instantiateNavigationWorlds();
    const infrastructure = this.findNamed(system, ["OrbitInfrastructure_ROOT", "OrbitInfrastructure"]);
    if (infrastructure) this.adoptInfrastructure(infrastructure);
  }

  private adoptInfrastructure(object: THREE.Object3D): void {
    object.removeFromParent();
    this.prepareObject(object);
    this.batchStaticPlanetMeshes(object, [], "infrastructure", this.baseAssetTier);
    object.scale.setScalar(0.42);
    object.position.set(0, 0, -1.4);
    object.rotation.set(THREE.MathUtils.degToRad(-4.5), 0, 0);
    this.blenderInfrastructure?.removeFromParent();
    this.blenderInfrastructure = object;
    this.orbitInfrastructure.add(object);
    if (this.generatedInfrastructure) this.generatedInfrastructure.visible = false;
  }

  private adoptStar(object: THREE.Object3D): void {
    object.removeFromParent();
    this.prepareObject(object);
    // The reactor and dock are Blender-authored but have no runtime skeletal
    // motion. Consolidating their leaf meshes removes the last large block of
    // static draw calls without reducing geometry, materials or silhouette.
    this.batchStaticPlanetMeshes(object, [], "star", this.baseAssetTier);
    const scale = this.normaliseToRadius(object, 3.1);
    this.starBaseScale.setScalar(scale);
    object.scale.copy(this.starBaseScale);
    object.position.copy(STAR_POSITION);
    this.starRoot = object;
    this.starSlot.add(object);
  }

  private adoptPlanetTemplate(id: OrbitModelFamilyId, object: THREE.Object3D, animations: THREE.AnimationClip[]): void {
    this.baseTemplates.set(id, this.createPlanetVariant(id, object, animations, this.baseAssetTier));
  }

  private instantiateNavigationWorlds(): void {
    if (this.actors.size) return;
    ORBIT_NAVIGATION_WORLDS.forEach((world, index) => {
      const template = this.baseTemplates.get(world.modelFamily);
      if (!template) throw new Error(`Orbit template ${world.modelFamily} is unavailable`);
      const baseVariant = this.clonePlanetVariant(template, world.id);

      const orbitFrame = new THREE.Group();
      orbitFrame.name = `OrbitFrame_${world.id}`;
      orbitFrame.position.copy(fullPositions[world.id]);
      const spinFrame = new THREE.Group();
      spinFrame.name = `SpinFrame_${world.id}`;
      orbitFrame.add(spinFrame);
      spinFrame.add(baseVariant.root);

      // A material-invisible sphere is still raycastable but never enters the
      // render pass, visual bounds, shadows, or the authored GLB hierarchy.
      const hitProxy = new THREE.Mesh(
        new THREE.SphereGeometry(1, 18, 12),
        new THREE.MeshBasicMaterial({ visible: false }),
      );
      hitProxy.name = `InteractionProxy_${world.id}`;
      hitProxy.userData.planetId = world.id;
      hitProxy.userData.interactionOnly = true;
      hitProxy.frustumCulled = false;
      orbitFrame.add(hitProxy);
      this.hitTargets.push(hitProxy);

      // Build a low-inclination ellipse that passes exactly through the approved
      // first full-system composition at phase zero. Rotating into the ellipse's
      // shallow local frame keeps all navigation paths horizontally composed.
      const target = fullPositions[world.id].clone().sub(STAR_POSITION);
      const orbitTilt = orbitTilts[world.id];
      const cosTilt = Math.cos(orbitTilt);
      const sinTilt = Math.sin(orbitTilt);
      const localX = target.x * cosTilt + target.y * sinTilt;
      const localY = -target.x * sinTilt + target.y * cosTilt;
      const orbitRadiusX = Math.max(4.8, Math.hypot(localX, localY / ORBIT_VERTICAL_ASPECT));
      const orbitRadiusY = orbitRadiusX * ORBIT_VERTICAL_ASPECT;
      const orbitPhase = Math.atan2(localY / ORBIT_VERTICAL_ASPECT, localX);
      // Centre the depth wave on the reactor so every world visibly passes both
      // behind and in front of it. Solve the phase offset from the approved
      // initial Z rather than offsetting the whole track away from the star.
      const orbitDepth = Math.min(3.8, Math.max(2.4, Math.abs(target.z) + 0.55));
      const depthRatio = THREE.MathUtils.clamp(target.z / orbitDepth, -0.94, 0.94);
      const orbitDepthPhase = Math.asin(depthRatio) - orbitPhase;
      const orbitDepthOffset = 0;

      this.planetSlot.add(orbitFrame);
      const actor: PlanetActor = {
        id: world.id,
        modelFamily: world.modelFamily,
        baseVariant,
        heroVariant: null,
        orbitFrame,
        spinFrame,
        hitProxy,
        fullScale: fullScales[world.id],
        orbitRadiusX,
        orbitRadiusY,
        orbitDepth,
        orbitDepthPhase,
        orbitDepthOffset,
        orbitTilt,
        orbitPhase,
      };
      this.actors.set(world.id, actor);
      this.createActorOrbitTrack(actor, index);
    });
    if (this.generatedInfrastructure) this.generatedInfrastructure.visible = false;
  }

  private createPlanetVariant(
    id: OrbitModelFamilyId,
    object: THREE.Object3D,
    animations: THREE.AnimationClip[],
    tier: "balanced" | "ultra",
  ): PlanetVisualVariant {
    object.removeFromParent();
    this.prepareObject(object, tier, id);
    this.refinePlanetReadability(id, object);
    this.reduceProceduralNoise(id, object, tier);
    this.batchStaticPlanetMeshes(object, animations, id, tier);
    const normalisedScale = this.normaliseToRadius(object, 1.55);
    object.scale.setScalar(normalisedScale);
    object.position.set(0, 0, 0);
    // Keep the authored model at a fixed, normalised scale inside a centred
    // wrapper. Scaling the authored root directly left its pivot offset
    // unscaled, so asymmetric machinery drifted as the close shot enlarged.
    this.centreVisualPivot(object);
    const root = new THREE.Group();
    root.name = `PlanetVisual_${id}_${tier}`;
    root.userData.planetId = id;
    root.userData.lodTier = tier;
    root.add(object);

    const mixer = animations.length ? new THREE.AnimationMixer(object) : null;
    const signatureActions = animations.map((clip) => {
      const action = mixer!.clipAction(clip);
      action.enabled = true;
      action.clampWhenFinished = true;
      action.setLoop(THREE.LoopOnce, 1);
      action.play();
      action.paused = true;
      action.time = 0;
      return action;
    });
    return { tier, root, authoredRoot: object, mixer, signatureActions, signatureClips: animations };
  }

  /**
   * A navigation world shares its source geometry/textures with the approved
   * Blender family, but receives independent material state and animation.
   * This is what lets eleven destinations exist without eleven new GLBs.
   */
  private clonePlanetVariant(template: PlanetVisualVariant, worldId: OrbitPlanetId): PlanetVisualVariant {
    const root = template.root.clone(true) as THREE.Group;
    root.name = `PlanetVisual_${worldId}_${template.tier}`;
    root.userData.planetId = worldId;
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      const independent = materials.map((material) => {
        const clone = material.clone();
        clone.userData = { ...material.userData };
        return clone;
      });
      object.material = Array.isArray(object.material) ? independent : independent[0];
    });
    const authoredRoot = root.children[0] ?? root;
    const mixer = template.signatureClips.length ? new THREE.AnimationMixer(authoredRoot) : null;
    const signatureActions = template.signatureClips.map((clip) => {
      const action = mixer!.clipAction(clip);
      action.enabled = true;
      action.clampWhenFinished = true;
      action.setLoop(THREE.LoopOnce, 1);
      action.play();
      action.paused = true;
      action.time = 0;
      return action;
    });
    return {
      tier: template.tier,
      root,
      authoredRoot,
      mixer,
      signatureActions,
      signatureClips: template.signatureClips,
    };
  }

  private attachHeroPlanet(id: OrbitPlanetId, variant: PlanetVisualVariant): void {
    const actor = this.actors.get(id);
    if (!actor) throw new Error(`Cannot attach ${id} Ultra before its overview actor`);
    if (actor.heroVariant) this.releaseHeroVariant(id);
    variant.root.visible = false;
    actor.heroVariant = variant;
    actor.spinFrame.add(variant.root);
    this.touchHeroLru(id);
    this.applySelectionMaterials();
    this.updateDatasets();
  }

  private actorIsVisible(actor: PlanetActor): boolean {
    return actor.baseVariant.root.visible || Boolean(actor.heroVariant?.root.visible);
  }

  private async ensureHeroVariant(id: OrbitPlanetId): Promise<void> {
    if (this.disposed || this.quality !== "balanced") return;
    const actor = this.actors.get(id);
    if (!actor) return;
    if (actor.heroVariant) {
      this.touchHeroLru(id);
      this.updateDatasets();
      return;
    }
    const template = this.heroTemplates.get(actor.modelFamily);
    if (!template) return;
    // Ultra source assets are decoded and pre-warmed during Stage 2. Creating
    // an actor-specific instance here only duplicates transform/material state.
    this.attachHeroPlanet(id, this.clonePlanetVariant(template, id));
    this.trimHeroLru(id);
  }

  private async prewarmHeroVariant(variant: PlanetVisualVariant): Promise<void> {
    const prewarmCamera = new THREE.PerspectiveCamera(47, 1, 0.1, 2000);
    prewarmCamera.position.set(0, -1000, 24);
    prewarmCamera.lookAt(0, -1000, 0);
    variant.root.position.set(0, -1000, 0);
    variant.root.visible = true;
    this.scene.add(variant.root);
    try {
      await this.renderer.compileAsync(this.scene, prewarmCamera);
      const target = new THREE.WebGLRenderTarget(8, 8);
      const previousTarget = this.renderer.getRenderTarget();
      try {
        this.renderer.setRenderTarget(target);
        this.renderer.render(this.scene, prewarmCamera);
      } finally {
        this.renderer.setRenderTarget(previousTarget);
        target.dispose();
      }
    } finally {
      variant.root.removeFromParent();
      variant.root.position.set(0, 0, 0);
      variant.root.visible = false;
    }
  }

  private touchHeroLru(id: OrbitPlanetId): void {
    const previous = this.heroLru.indexOf(id);
    if (previous >= 0) this.heroLru.splice(previous, 1);
    this.heroLru.push(id);
  }

  private trimHeroLru(preserve: OrbitPlanetId): void {
    while (this.heroLru.length > 2) {
      const candidate = this.heroLru.find((id) => (
        id !== preserve
        && id !== this.focusedPlanetId
        && id !== this.hoveredPlanetId
      ));
      if (!candidate) break;
      this.releaseHeroVariant(candidate);
    }
  }

  private releaseHeroVariant(id: OrbitPlanetId): void {
    const actor = this.actors.get(id);
    const variant = actor?.heroVariant;
    if (!actor || !variant) return;
    variant.root.visible = false;
    variant.root.removeFromParent();
    variant.mixer?.stopAllAction();
    variant.mixer?.uncacheRoot(variant.authoredRoot);
    actor.heroVariant = null;
    const lruIndex = this.heroLru.indexOf(id);
    if (lruIndex >= 0) this.heroLru.splice(lruIndex, 1);
  }

  private findNamed(root: THREE.Object3D, names: string[]): THREE.Object3D | null {
    for (const name of names) {
      const object = root.getObjectByName(name);
      if (object) return object;
    }
    return null;
  }

  private reduceProceduralNoise(id: OrbitModelFamilyId, root: THREE.Object3D, tier: "balanced" | "ultra"): void {
    const hide = (object: THREE.Object3D) => {
      object.visible = false;
      object.userData.excludeFromVisualBounds = true;
    };
    const indexFromName = (name: string) => Number(name.match(/_(\d+)(?:_Mesh)?$/)?.[1] ?? -1);

    root.traverse((object) => {
      const name = object.name;
      const index = indexFromName(name);
      if (id === "build") {
        if (/Build_(?:ModuleTower|ModuleLoadPath|InterfaceLock)_/i.test(name) && index >= 0 && index % 4 !== 0) hide(object);
        if (/Build_(?:CraneArm|CraneHead)_/i.test(name) && index >= 0 && index % 3 !== 0) hide(object);
        if (/Build_LatitudeScaffold_/i.test(name) && !/(?:_1|_3)(?:_Mesh)?$/i.test(name)) hide(object);
        if (tier === "balanced" && /Build_MID_(?:Module|ModuleSupport)_/i.test(name) && index >= 0 && index % 2 !== 0) hide(object);
      }
      if (id === "operate") {
        if (/Operate_Node_/i.test(name) && index >= 18) hide(object);
        if (/Operate_NodeHalo_/i.test(name) && index >= 18) hide(object);
        if (/Operate_CausalLink_/i.test(name) && index >= 24) hide(object);
        if (/Operate_(?:ComputeRelay|RelayLink|RelayHinge)_/i.test(name) && index >= 6) hide(object);
        if (/Operate_GimbalClamp_/i.test(name) && index >= 0 && index % 3 !== 0) hide(object);
        if (/Operate_MID_Node_/i.test(name) && index >= 14) hide(object);
        if (/Operate_MID_CausalLink_/i.test(name) && index >= 18) hide(object);
        if (/Operate_MID_GimbalClamp_/i.test(name) && index >= 0 && index % 3 !== 0) hide(object);
      }
    });
  }

  private batchStaticPlanetMeshes(
    root: THREE.Object3D,
    animations: THREE.AnimationClip[],
    id: OrbitModelFamilyId | "star" | "infrastructure",
    tier: "balanced" | "ultra",
  ): void {
    const animatedNames = new Set<string>();
    animations.forEach((clip) => {
      clip.tracks.forEach((track) => {
        const target = track.name.split(".")[0];
        if (target) animatedNames.add(target);
      });
    });
    root.updateMatrixWorld(true);

    interface Batch {
      anchor: THREE.Object3D;
      material: THREE.Material;
      meshes: THREE.Mesh[];
    }
    const batches = new Map<string, Batch>();
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || object instanceof THREE.SkinnedMesh) return;
      if (!object.visible || object.userData.excludeFromVisualBounds === true) return;
      if (object.children.length) return;
      if (Array.isArray(object.material) || object.material.transparent || object.material.opacity < 0.999) return;
      if (Object.keys(object.geometry.morphAttributes).length) return;

      let anchor: THREE.Object3D = root;
      let cursor: THREE.Object3D | null = object;
      while (cursor) {
        if (animatedNames.has(cursor.name)) {
          anchor = cursor;
          break;
        }
        if (cursor === root) break;
        cursor = cursor.parent;
      }
      const attributes = Object.entries(
        object.geometry.attributes as Record<string, THREE.BufferAttribute | THREE.InterleavedBufferAttribute>,
      )
        .map(([name, attribute]) => `${name}:${attribute.itemSize}:${attribute.normalized ? 1 : 0}`)
        .sort()
        .join("|");
      const signature = `${object.geometry.index ? "indexed" : "plain"}:${attributes}`;
      const key = `${anchor.uuid}:${object.material.uuid}:${signature}`;
      let batch = batches.get(key);
      if (!batch) {
        batch = { anchor, material: object.material, meshes: [] };
        batches.set(key, batch);
      }
      batch.meshes.push(object);
    });

    let batchIndex = 0;
    batches.forEach((batch) => {
      if (batch.meshes.length < 2) return;
      batch.anchor.updateMatrixWorld(true);
      const anchorInverse = batch.anchor.matrixWorld.clone().invert();
      const sources = batch.meshes.map((mesh) => {
        const geometry = mesh.geometry.clone();
        const relative = anchorInverse.clone().multiply(mesh.matrixWorld);
        geometry.applyMatrix4(relative);
        return geometry;
      });
      const geometry = mergeGeometries(sources, false);
      sources.forEach((source) => source.dispose());
      if (!geometry) return;
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      const merged = new THREE.Mesh(geometry, batch.material);
      merged.name = `OrbitBatch_${id}_${tier}_${String(batchIndex).padStart(2, "0")}`;
      merged.castShadow = this.quality === "ultra";
      merged.receiveShadow = true;
      merged.frustumCulled = true;
      batch.anchor.add(merged);
      batch.meshes.forEach((mesh) => {
        mesh.removeFromParent();
        mesh.geometry.dispose();
      });
      batchIndex += 1;
    });
  }

  private isCausalSignal(id: OrbitModelFamilyId, objectName: string): boolean {
    const activePatterns: Record<OrbitModelFamilyId, RegExp> = {
      transform: /FaultSegment_(?:03|07|11)|TransferDatum_03|TransferBearing_03_Axle|MID_EncoderKey/i,
      build: /ForgeCausalSeam|EastInterfacePort_1|SouthEastBayLock_1|GantryHoist_1|MID_ForgeCausalSeam/i,
      experience: /FrontAperture|SignalBearing|Focal|Encoder|IrisBlade_(?:00|06)/i,
      test: /Scan|Calibration|ReferenceAperture|Validation/i,
      deploy: /ReleaseNexus|DeploymentBus|LaunchPylon_(?:00|03)|RailSignal/i,
      protect: /LockCore|AuditSignal|AuditTick_(?:00|06|12|18)|AuditInterlock_(?:0|3)/i,
      operate: /KernelSignal|CausalProcessor|ComputeBankBearing_01|Node_(?:00|13|26|39|52)|RelayLink_(?:00|03)/i,
    };
    return activePatterns[id].test(objectName);
  }

  private prepareObject(
    root: THREE.Object3D,
    detailTier: "balanced" | "ultra" = this.baseAssetTier,
    planetId?: OrbitModelFamilyId,
  ): void {
    // glTF intentionally reuses a compact authored material set. Preserve
    // that sharing in the browser, while giving the few readability families
    // their own variants. Cloning once per mesh previously turned the mobile
    // system into hundreds of material/program instances.
    const materialVariants = new Map<string, THREE.Material>();
    const authoredAnisotropy = Math.min(
      this.renderer.capabilities.getMaxAnisotropy(),
      detailTier === "ultra" ? 12 : 4,
    );
    root.traverse((object) => {
      // Collision proxies belong to the authoring/interaction layer only. An
      // early export accidentally emitted them as low-poly black meshes; if
      // rendered they occlude the actual mechanical shells and if included in
      // bounds they also shrink the hero asset. Keep this runtime guard even
      // after the exporter was corrected so a malformed asset cannot regress
      // the presentation.
      if (this.isCollisionProxy(object)) {
        object.visible = false;
        object.userData.excludeFromVisualBounds = true;
        return;
      }
      if (!(object instanceof THREE.Mesh)) return;
      const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];
      object.frustumCulled = true;
      object.castShadow = this.quality === "ultra";
      object.receiveShadow = true;
      const family = this.materialVariantFamily(object);
      const materials = sourceMaterials.map((material) => {
        const authoredSignal = /orange|signal/i.test(material.name);
        const signalDisposition = authoredSignal && planetId
          ? (this.isCausalSignal(planetId, object.name) ? "active-signal" : "muted-signal")
          : "neutral";
        const key = `${material.uuid}:${family}:${signalDisposition}`;
        const cached = materialVariants.get(key);
        if (cached) return cached;
        const created = material.clone();
        created.userData.orbitSignalDisposition = signalDisposition;
        materialVariants.set(key, created);
        return created;
      });
      materials.forEach((material) => {
        material.userData.baseEmissiveIntensity = "emissiveIntensity" in material
          ? (material as THREE.MeshStandardMaterial).emissiveIntensity
          : 0;
        if (material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshPhysicalMaterial) {
          const textureMaps = [
            material.map,
            material.normalMap,
            material.roughnessMap,
            material.metalnessMap,
            material.aoMap,
            material.emissiveMap,
          ];
          textureMaps.forEach((texture) => {
            if (!texture || texture.anisotropy >= authoredAnisotropy) return;
            texture.anisotropy = authoredAnisotropy;
            texture.needsUpdate = true;
          });
          const hsl = { h: 0, s: 0, l: 0 };
          material.color.getHSL(hsl);
          if (hsl.l < 0.055) material.color.setHSL(hsl.h, Math.min(hsl.s, 0.22), 0.065);
          else if (hsl.l < 0.16) material.color.offsetHSL(0, -hsl.s * 0.18, 0.035);
          const label = material.name.toLowerCase();
          if (label.includes("layered carbon")) {
            material.color.set(0x111a21);
            material.metalness = 0.34;
            material.roughness = 0.52;
            material.envMapIntensity = 0.7;
          } else if (label.includes("gunmetal")) {
            material.color.set(0x2c3941);
            material.metalness = 0.86;
            material.roughness = 0.36;
            material.envMapIntensity = 0.88;
          } else if (label.includes("cold titanium")) {
            material.color.set(0x4c5b64);
            material.metalness = 0.94;
            material.roughness = 0.25;
            material.envMapIntensity = 0.96;
          } else if (label.includes("satin nickel")) {
            material.color.set(0x6b7478);
            material.metalness = 0.9;
            material.roughness = 0.34;
            material.envMapIntensity = 0.9;
          } else if (label.includes("engineering ceramic")) {
            material.color.set(0x858a89);
            material.metalness = 0.04;
            material.roughness = 0.54;
            material.envMapIntensity = 0.62;
          } else if (label.includes("technical ceramic")) {
            material.color.set(0x172229);
            material.metalness = 0.06;
            material.roughness = 0.58;
            material.envMapIntensity = 0.58;
          } else if (label.includes("heat treated forge")) {
            material.color.set(0x343330);
            material.metalness = 0.72;
            material.roughness = 0.44;
            material.envMapIntensity = 0.78;
          } else if (label.includes("warm architectural white")) {
            material.color.set(0x777873);
            material.metalness = 0.12;
            material.roughness = 0.5;
            material.envMapIntensity = 0.64;
          } else if (label.includes("warm porcelain")) {
            material.color.set(0x9b9a93);
            material.metalness = 0.03;
            material.roughness = 0.5;
            material.envMapIntensity = 0.66;
          } else if (label.includes("brushed steel")) {
            material.color.set(0x596a73);
            material.metalness = 0.94;
            material.roughness = 0.31;
            material.envMapIntensity = 0.92;
          } else if (label.includes("graphite")) {
            material.color.set(0x1a252c);
            material.metalness = 0.58;
            material.roughness = 0.46;
            material.envMapIntensity = 0.72;
          } else if (label.includes("ink black")) {
            material.color.set(0x0d151a);
            material.metalness = 0.62;
            material.roughness = 0.42;
            material.envMapIntensity = 0.68;
          } else {
            material.envMapIntensity = THREE.MathUtils.clamp(material.envMapIntensity, 0.62, 0.94);
          }

          if (material.normalMap) {
            const normalStrength = label.includes("ceramic") ? 0.08 : label.includes("carbon") ? 0.16 : 0.2;
            material.normalScale.setScalar(normalStrength);
          }
          if (!material.aoMap && material.roughnessMap) {
            material.aoMap = material.roughnessMap;
            material.aoMapIntensity = 0.58;
          }
          if (!material.transparent && material.opacity >= 0.999 && !label.includes("glass")) {
            material.side = THREE.FrontSide;
          }

          if (material.userData.orbitSignalDisposition === "muted-signal") {
            material.color.set(0x321711);
            material.metalness = 0.48;
            material.roughness = 0.4;
            material.emissive.set(0x120200);
            material.emissiveIntensity = Math.min(material.emissiveIntensity, 0.08);
          } else if (material.userData.orbitSignalDisposition === "active-signal") {
            material.color.set(0xe63c12);
            material.emissive.set(0xff2600);
            material.emissiveIntensity = Math.min(Math.max(material.emissiveIntensity, 0.68), 1.25);
          }
        }
      });
      object.material = Array.isArray(object.material) ? materials : materials[0];
    });
  }

  private refinePlanetReadability(id: OrbitModelFamilyId, root: THREE.Object3D): void {
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];

      if (id === "operate") {
        if (/CausalLink|Gimbal|NodeHalo|ComputeRelay|RelayLink/i.test(object.name)) {
          materials.forEach((material) => {
            if (!(material instanceof THREE.MeshStandardMaterial) && !(material instanceof THREE.MeshPhysicalMaterial)) return;
            if (material.userData.operateReadabilityApplied) return;
            material.userData.operateReadabilityApplied = true;
            const signal = /signal|orange/i.test(material.name) || /NodeHalo|RelayLink/i.test(object.name);
            if (!signal) material.color.set(0x465760);
            material.metalness = signal ? Math.max(material.metalness, 0.52) : Math.max(material.metalness, 0.74);
            material.roughness = signal ? Math.max(material.roughness, 0.32) : Math.max(material.roughness, 0.38);
            if (!signal) {
              material.emissive.set(0x071014);
              material.emissiveIntensity = Math.min(material.emissiveIntensity, 0.045);
            }
          });
        }
      }

      if (id === "experience" && /OpticalVolume/i.test(object.name)) {
        // The authored volume is a refraction aid for offline hero renders.
        // In real-time it collapses the exposed aperture into a smooth dark
        // disc, especially on the Balanced/mobile path. The segmented front
        // optics remain, so omit this enclosed helper volume in WebGL.
        object.visible = false;
        object.userData.excludeFromVisualBounds = true;
        materials.forEach((material) => {
          if (!(material instanceof THREE.MeshStandardMaterial) && !(material instanceof THREE.MeshPhysicalMaterial)) return;
          if (material.userData.experienceGlassApplied) return;
          material.userData.experienceGlassApplied = true;
          material.color.set(0x263943);
          material.transparent = true;
          material.opacity = 0.09;
          material.depthWrite = false;
          material.roughness = 0.055;
          if (material instanceof THREE.MeshPhysicalMaterial) {
            material.transmission = Math.max(material.transmission, 0.9);
            material.thickness = Math.min(Math.max(material.thickness, 0.045), 0.09);
            material.ior = 1.18;
          }
        });
      }

      if (id === "experience" && /IrisBlade/i.test(object.name)) {
        materials.forEach((material) => {
          if (!(material instanceof THREE.MeshStandardMaterial) && !(material instanceof THREE.MeshPhysicalMaterial)) return;
          if (material.userData.experienceIrisApplied) return;
          material.userData.experienceIrisApplied = true;
          const darker = /gunmetal/i.test(material.name);
          material.color.set(darker ? 0x394a54 : 0x87979f);
          material.metalness = Math.max(material.metalness, 0.84);
          material.roughness = 0.34;
          material.envMapIntensity = Math.max(material.envMapIntensity, 1.15);
          material.emissive.set(darker ? 0x071014 : 0x10191d);
          material.emissiveIntensity = Math.max(material.emissiveIntensity, 0.055);
        });
      }

      if (id === "experience" && /FrontAperture|FrameSector|FrontFrame|RearFrame|Actuator|BarrelRail|SignalBearing/i.test(object.name)) {
        materials.forEach((material) => {
          if (!(material instanceof THREE.MeshStandardMaterial) && !(material instanceof THREE.MeshPhysicalMaterial)) return;
          if (material.userData.experienceFrameApplied) return;
          material.userData.experienceFrameApplied = true;
          if (!/orange|signal/i.test(material.name)) material.color.set(/gunmetal/i.test(material.name) ? 0x1c282f : 0x43545d);
          material.emissiveIntensity = Math.min(material.emissiveIntensity, 0.12);
          material.metalness = Math.max(material.metalness, 0.76);
          material.roughness = Math.max(material.roughness, 0.42);
          material.envMapIntensity = Math.min(material.envMapIntensity, 0.82);
        });
      }

      if (id === "protect" && /Lock|Audit|Shield|Citadel|Bastion|WallArmour|EmbeddedVent|Fastener|LoadRib|PressureHull|ArmourBed/i.test(object.name)) {
        materials.forEach((material) => {
          if (!(material instanceof THREE.MeshStandardMaterial) && !(material instanceof THREE.MeshPhysicalMaterial)) return;
          if (material.userData.protectReadabilityApplied) return;
          material.userData.protectReadabilityApplied = true;
          if (!/orange|signal/i.test(material.name)) {
            const label = material.name.toLowerCase();
            if (label.includes("warm")) material.color.set(0x77756f);
            else if (label.includes("steel")) material.color.set(0x536670);
            else if (label.includes("gunmetal")) material.color.set(0x27363e);
            else material.color.offsetHSL(0, -0.04, 0.018);
          }
          material.roughness = Math.max(material.roughness, 0.28);
          material.envMapIntensity = Math.min(Math.max(material.envMapIntensity, 0.84), 0.98);
        });
      }
    });
  }

  private normaliseToRadius(root: THREE.Object3D, targetRadius: number): number {
    root.updateMatrixWorld(true);
    const bounds = new THREE.Box3();
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || this.isCollisionProxy(object)) return;
      if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
      if (!object.geometry.boundingBox) return;
      bounds.union(object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld));
    });
    const sphere = new THREE.Sphere();
    if (bounds.isEmpty()) return 1;
    bounds.getBoundingSphere(sphere);
    const radius = Math.max(0.001, sphere.radius);
    return targetRadius / radius;
  }

  private centreVisualPivot(root: THREE.Object3D): void {
    root.updateMatrixWorld(true);
    const bounds = new THREE.Box3();
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || this.isCollisionProxy(object)) return;
      if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
      if (!object.geometry.boundingBox) return;
      bounds.union(object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld));
    });
    if (bounds.isEmpty()) return;
    const centre = bounds.getCenter(new THREE.Vector3());
    root.position.sub(centre);
    root.updateMatrixWorld(true);
  }

  private isCollisionProxy(object: THREE.Object3D): boolean {
    if (object.userData.collisionOnly === true || object.userData.excludeFromVisualBounds === true) return true;
    if (/_COLLISION(?:$|_)/i.test(object.name)) return true;
    let parent = object.parent;
    while (parent) {
      if (parent.userData.collisionOnly === true || /_COLLISION(?:$|_)/i.test(parent.name)) return true;
      parent = parent.parent;
    }
    return false;
  }

  private materialVariantFamily(object: THREE.Object3D): string {
    if (/Operate_.*(?:NodeHalo|RelayLink)/i.test(object.name)) return "operate-signal";
    if (/Operate_.*(?:CausalLink|Gimbal|ComputeRelay)/i.test(object.name)) return "operate-mechanical";
    if (/Experience_.*OpticalVolume/i.test(object.name)) return "experience-glass";
    if (/Experience_.*IrisBlade/i.test(object.name)) return "experience-iris";
    if (/Experience_.*(?:FrontAperture|FrameSector|FrontFrame|RearFrame|Actuator|BarrelRail|SignalBearing)/i.test(object.name)) return "experience-frame";
    if (/Protect_.*(?:Lock|Audit|Shield|Citadel|Bastion|WallArmour|EmbeddedVent|Fastener|LoadRib|PressureHull|ArmourBed)/i.test(object.name)) return "protect-security";
    return "base";
  }

  private validateActors(): void {
    if (!this.starRoot || this.actors.size !== ORBIT_PLANET_IDS.length) {
      throw new Error(`Project Orbit is incomplete (${this.actors.size}/${ORBIT_PLANET_IDS.length} navigation worlds)`);
    }
  }

  private async prewarm(): Promise<void> {
    const previousVisible = this.root.visible;
    const previousPosition = this.root.position.clone();
    const heroVisibility = new Map<PlanetVisualVariant, boolean>();
    this.actors.forEach((actor) => {
      if (!actor.heroVariant) return;
      heroVisibility.set(actor.heroVariant, actor.heroVariant.root.visible);
      actor.heroVariant.root.visible = true;
    });
    this.root.visible = true;
    this.root.position.set(0, -1000, 0);
    const prewarmCamera = new THREE.PerspectiveCamera(47, 1, 0.1, 2000);
    prewarmCamera.position.set(0, -1000, 24);
    prewarmCamera.lookAt(0, -1000, 0);
    await this.renderer.compileAsync(this.scene, prewarmCamera);
    const target = new THREE.WebGLRenderTarget(8, 8);
    const previousTarget = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, prewarmCamera);
    this.renderer.setRenderTarget(previousTarget);
    target.dispose();
    this.root.position.copy(previousPosition);
    this.root.visible = previousVisible;
    heroVisibility.forEach((visible, variant) => {
      variant.root.visible = visible;
    });
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  }

  private updateLayout(elapsed: number, _delta: number): void {
    const compact = window.innerWidth <= 820;
    const focusIndex = Math.round(this.state.focusIndex);
    const focusId = ORBIT_PLANET_IDS[focusIndex];
    this.actors.forEach((actor, id) => {
      const index = ORBIT_PLANET_IDS.indexOf(id);
      const revealStart = 0.04 + Math.floor(index / 4) * 0.15 + (index % 4) * 0.032;
      const reveal = clamp01((this.state.reveal - revealStart) / 0.26);
      const emergence = 1 - Math.pow(1 - reveal, 3);
      let delta = index - this.state.focusIndex;
      const halfWorldCount = ORBIT_PLANET_IDS.length / 2;
      while (delta > halfWorldCount) delta -= ORBIT_PLANET_IDS.length;
      while (delta < -halfWorldCount) delta += ORBIT_PLANET_IDS.length;
      const distance = Math.abs(delta);
      const side = Math.sign(delta);
      const neighbourX = compact ? 6.2 : 10.8;
      const farX = compact ? 8.2 : 11.5;
      const focusCentreX = compact ? 0 : -4.85;
      const focusedPosition = distance <= 1
        ? new THREE.Vector3(
            focusCentreX + side * neighbourX * distance,
            THREE.MathUtils.lerp(compact ? 3.9 : 0.1, compact ? 1.75 : 0.15, distance),
            -1.9 * distance,
          )
        : new THREE.Vector3(
            side * THREE.MathUtils.lerp(neighbourX, farX, clamp01(distance - 1)),
            THREE.MathUtils.lerp(compact ? -0.2 : 0.15, 1.2 + distance * 0.4, clamp01(distance - 1)),
            THREE.MathUtils.lerp(-1.9, -6 - distance, clamp01(distance - 1)),
          );
      // The reveal arrives along the exact visible rail, then locks into a
      // fixed anchor. No continuous orbit or self-spin is applied afterwards.
      const revealPhase = actor.orbitPhase - emergencePhaseOffsets[id] * (1 - emergence);
      const systemPosition = this.getOrbitPositionAtPhase(actor, revealPhase, this.worldPoint);
      const position = systemPosition.lerp(focusedPosition, this.state.focusBlend);
      actor.orbitFrame.position.copy(position);

      const focusHeroScale = actor.modelFamily === "experience"
        ? (compact ? 2.34 : 3.32)
        : (compact ? 2.7 : 3.65);
      const focusScale = distance <= 1
        ? THREE.MathUtils.lerp(focusHeroScale, 0.94, distance)
        : THREE.MathUtils.lerp(1.08, 0.52, clamp01(distance - 1));
      const arrivalPressure = 1 + Math.sin(reveal * Math.PI) * 0.075 * (1 - this.state.focusBlend);
      const hoverPressure = this.hoveredPlanetId === id && !this.focusedPlanetId ? 1.035 : 1;
      const scalar = emergence * arrivalPressure * hoverPressure * THREE.MathUtils.lerp(actor.fullScale, focusScale, this.state.focusBlend);
      const focusVisibility = this.state.focusBlend < 0.72 || distance <= 1.12;
      const planetVisible = reveal > 0.002 && focusVisibility;
      const showHeroVariant = Boolean(
        actor.heroVariant
        && this.state.focusBlend > 0.06
        // Only the actual hero (or the two worlds briefly crossing during a
        // direct hand-off) may render WEB_LOD0. Immediate neighbours retain
        // their Balanced silhouette instead of tripling close-shot draw cost.
        && distance <= 0.56,
      );
      actor.baseVariant.root.scale.setScalar(Math.max(0.001, scalar));
      actor.baseVariant.root.visible = planetVisible && !showHeroVariant;
      if (actor.heroVariant) {
        actor.heroVariant.root.scale.setScalar(Math.max(0.001, scalar));
        actor.heroVariant.root.visible = planetVisible && showHeroVariant;
      }
      actor.hitProxy.scale.setScalar(Math.max(0.001, scalar * 1.82));
      actor.hitProxy.visible = planetVisible;

      const idleYaw = heroYaws[id] + Math.sin(elapsed * 0.24 + index * 0.83) * 0.012;
      // A held hero yaw exposes the intended construction face. The tiny wave
      // is breathing, not continuous rotation.
      const heroLock = 0.94 * this.state.focusBlend * (1 - smoothRange(distance, 0.12, 0.82));
      actor.spinFrame.rotation.y = lerpAngle(
        idleYaw,
        heroYaws[id] + Math.sin(elapsed * 0.19 + index) * 0.014,
        heroLock,
      );
      [actor.baseVariant, actor.heroVariant].forEach((variant) => {
        if (!variant) return;
        variant.root.rotation.x = emergenceSpin[id].x * (1 - emergence);
        variant.root.rotation.y = emergenceSpin[id].y * (1 - emergence);
        variant.root.rotation.z = emergenceSpin[id].z * (1 - emergence) + Math.sin(elapsed * 0.22 + index) * 0.018;
      });
    });

    const focusLighting = smoothRange(this.state.focusBlend, 0.12, 0.88);
    // Keep reveal and interactive overview at the same exposure.  Previously
    // an unrelated performance-level change called the corridor's black-stage
    // lighting grade a few seconds after reveal, making the system visibly
    // collapse into darkness.  Orbit photometry is now stable and focus gets
    // only a small readability lift for close-up hard-surface inspection.
    this.renderer.toneMappingExposure = THREE.MathUtils.lerp(
      ORBIT_OVERVIEW_EXPOSURE,
      ORBIT_FOCUS_EXPOSURE,
      focusLighting,
    );
    this.scene.environmentIntensity = THREE.MathUtils.lerp(
      ORBIT_OVERVIEW_ENVIRONMENT_INTENSITY,
      ORBIT_FOCUS_ENVIRONMENT_INTENSITY,
      focusLighting,
    );
    const focusActor = this.actors.get(focusId);
    if (focusActor) {
      this.focusLightTarget.position.copy(focusActor.orbitFrame.position);
      this.focusKey.position.copy(focusActor.orbitFrame.position);
      this.focusKey.position.x += 3.8;
      this.focusKey.position.y += 7.2;
      this.focusKey.position.z += 7.5;
      this.focusRim.position.copy(focusActor.orbitFrame.position);
      this.focusRim.position.x -= 4.2;
      this.focusRim.position.y += 2.4;
      this.focusRim.position.z -= 1.8;
    }
    // A selected world is an inspection shot, not a silhouette shot.  Keep a
    // cold low-level wash alive while the tighter key and rim reveal bevels,
    // panel seams and the authored front-to-back construction.  The previous
    // grade reduced every broad source on focus and buried the Ultra asset's
    // secondary geometry in black.
    this.focusKey.intensity = 6.8 * focusLighting;
    this.focusRim.intensity = 5.1 * focusLighting;
    this.orbitAmbient.intensity = THREE.MathUtils.lerp(0.84, 0.72, focusLighting);
    this.orbitKey.intensity = THREE.MathUtils.lerp(1.92, 1.56, focusLighting);
    this.orbitSignalLight.intensity = THREE.MathUtils.lerp(4.35, 2.65, focusLighting);
    this.orbitCoolFill.intensity = THREE.MathUtils.lerp(1.28, 1.02, focusLighting);

    if (this.starRoot) {
      const starFocus = compact ? new THREE.Vector3(5.2, 5.3, -7.5) : new THREE.Vector3(9.2, 5.5, -8.5);
      this.starRoot.position.copy(STAR_POSITION).lerp(starFocus, this.state.focusBlend);
      const reveal = clamp01(0.34 + this.state.reveal / 0.18);
      this.starRoot.scale.copy(this.starBaseScale).multiplyScalar(reveal * THREE.MathUtils.lerp(1, 0.34, this.state.focusBlend));
      this.starRoot.rotation.y = elapsed * 0.055;
      this.starRoot.rotation.z = Math.sin(elapsed * 0.28) * 0.025;
    }

    // The legacy Blender infrastructure contains a steep diagonal ring set.
    // The approved click-driven system uses the exact low-inclination actor
    // tracks instead, so the old rails stay out of the final composition.
    this.orbitInfrastructure.visible = false;
    const focusOffset = focusIndex - (ORBIT_PLANET_IDS.length - 1) * 0.5;
    this.orbitInfrastructure.rotation.x = Math.sin(focusIndex * 0.82) * 0.022 * this.state.focusBlend;
    this.orbitInfrastructure.rotation.z = elapsed * 0.006 + focusOffset * 0.026 * this.state.focusBlend;
    this.orbitInfrastructure.scale.setScalar(1 + Math.sin((focusIndex + 1) * 1.17) * 0.018 * this.state.focusBlend);

    // Re-compose the dock for every service world. The same architectural
    // language remains continuous, while sidewalls, broken halos and crown
    // modules shift enough to create distinct pressure silhouettes.
    this.environmentArchitecture.rotation.x = Math.sin((focusIndex + 0.5) * 0.72) * 0.034 * this.state.focusBlend;
    this.environmentArchitecture.rotation.y = focusOffset * 0.018 * this.state.focusBlend;
    this.environmentArchitecture.rotation.z = elapsed * 0.0015 + focusOffset * 0.041 * this.state.focusBlend;
    const architectureX = focusOffset * (compact ? -0.34 : -0.78) * this.state.focusBlend;
    const architectureY = Math.sin((focusIndex + 1) * 1.31) * (compact ? 0.24 : 0.46) * this.state.focusBlend;
    const architectureZ = -0.16 * focusIndex * this.state.focusBlend;
    this.environmentArchitecture.position.set(architectureX, architectureY, architectureZ);
    if (this.focusedPlanetId) this.experienceElement?.setAttribute("data-orbit-focus", focusId);
    this.actorOrbitTracks.visible = true;
    const trackReveal = smoothRange(this.state.reveal, 0.08, 0.72);
    const trackFocusFade = 1 - smoothRange(this.state.focusBlend, 0.08, 0.92);
    this.actorOrbitTracks.children.forEach((track) => {
      if (!(track instanceof THREE.Line)) return;
      const material = track.material as THREE.LineBasicMaterial;
      material.opacity = Number(material.userData.baseOpacity ?? 0.16) * trackReveal * trackFocusFade;
    });
  }

  private getOrbitPositionAtPhase(actor: PlanetActor, phase: number, target: THREE.Vector3): THREE.Vector3 {
    const localX = Math.cos(phase) * actor.orbitRadiusX;
    const localY = Math.sin(phase) * actor.orbitRadiusY;
    const cosTilt = Math.cos(actor.orbitTilt);
    const sinTilt = Math.sin(actor.orbitTilt);
    target.set(
      localX * cosTilt - localY * sinTilt,
      localX * sinTilt + localY * cosTilt,
      STAR_POSITION.z
        + actor.orbitDepthOffset
        + Math.sin(phase + actor.orbitDepthPhase) * actor.orbitDepth,
    );
    return target;
  }

  private createActorOrbitTrack(actor: PlanetActor, index: number): void {
    const points: THREE.Vector3[] = [];
    const segments = this.quality === "mobile" ? 128 : 224;
    for (let segment = 0; segment < segments; segment += 1) {
      points.push(this.getOrbitPositionAtPhase(
        actor,
        (segment / segments) * Math.PI * 2,
        new THREE.Vector3(),
      ));
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: index === 6 ? 0x748995 : index === 3 ? 0x6a7d88 : 0x52636e,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
    });
    material.userData.baseOpacity = index === 6 ? 0.34 : index === 3 ? 0.3 : 0.22;
    const track = new THREE.LineLoop(geometry, material);
    track.name = `ActorOrbitTrack_${actor.id}`;
    track.userData.planetId = actor.id;
    track.renderOrder = -2;
    this.actorOrbitTracks.add(track);
  }

  private applySelectionMaterials(): void {
    this.actors.forEach((actor, id) => {
      [actor.baseVariant, actor.heroVariant].forEach((variant) => {
        variant?.root.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => {
            if (!(material instanceof THREE.MeshStandardMaterial) && !(material instanceof THREE.MeshPhysicalMaterial)) return;
            const base = Number(material.userData.baseEmissiveIntensity ?? 0);
            const signal = /orange|signal|energy|emissive/i.test(material.name);
            const boost = this.selected.has(id)
              ? 0.72
              : this.hoveredPlanetId === id
                ? 0.46
                : this.focusedPlanetId === id
                  ? 0.3
                  : 0.08;
            material.emissiveIntensity = signal ? base + boost : base;
          });
        });
      });
    });
  }

  private playSignature(id: OrbitPlanetId, timeScale = 1): void {
    const actor = this.actors.get(id);
    if (!actor) return;
    const variant = actor.heroVariant?.root.visible ? actor.heroVariant : actor.baseVariant;
    variant.signatureActions.forEach((action) => {
      action.reset();
      action.enabled = true;
      action.paused = false;
      action.timeScale = timeScale;
      action.play();
    });
  }

  private createOrbitInfrastructure(): void {
    const generated = new THREE.Group();
    generated.name = "OrbitInfrastructure_Fallback";
    this.generatedInfrastructure = generated;
    this.orbitInfrastructure.add(generated);
    const dark = new THREE.MeshStandardMaterial({ color: 0x1a2025, metalness: 0.92, roughness: 0.28 });
    const signal = new THREE.MeshStandardMaterial({
      color: 0xff3d00,
      emissive: 0xff2b00,
      emissiveIntensity: 1.25,
      metalness: 0.45,
      roughness: 0.2,
    });
    [4.1, 6.4, 8.8, 11.2].forEach((radius, index) => {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, index % 2 ? 0.035 : 0.065, 8, 128), index === 1 ? signal : dark);
      ring.rotation.x = Math.PI * 0.5 + (index - 1.5) * 0.035;
      ring.rotation.y = (index - 1.5) * 0.08;
      generated.add(ring);
    });
    for (let index = 0; index < 28; index += 1) {
      const angle = (index / 28) * Math.PI * 2;
      const radius = 6.4;
      const clamp = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.11, 0.38), index % 7 === 0 ? signal : dark);
      clamp.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
      clamp.rotation.z = angle;
      generated.add(clamp);
    }
  }

  private createOrbitalBackdrop(): void {
    const canvas = document.createElement("canvas");
    canvas.width = 1536;
    canvas.height = 896;
    const context = canvas.getContext("2d");
    if (!context) return;

    const base = context.createLinearGradient(0, 0, 0, canvas.height);
    base.addColorStop(0, "#111d24");
    base.addColorStop(0.46, "#0d171d");
    base.addColorStop(1, "#05090c");
    context.fillStyle = base;
    context.fillRect(0, 0, canvas.width, canvas.height);

    const coldVolume = context.createRadialGradient(
      canvas.width * 0.52,
      canvas.height * 0.4,
      0,
      canvas.width * 0.52,
      canvas.height * 0.4,
      canvas.width * 0.5,
    );
    coldVolume.addColorStop(0, "rgb(96 124 142 / 0.36)");
    coldVolume.addColorStop(0.38, "rgb(52 76 91 / 0.22)");
    coldVolume.addColorStop(1, "rgb(3 6 9 / 0)");
    context.fillStyle = coldVolume;
    context.fillRect(0, 0, canvas.width, canvas.height);

    const reactorAura = context.createRadialGradient(
      canvas.width * 0.49,
      canvas.height * 0.53,
      0,
      canvas.width * 0.49,
      canvas.height * 0.53,
      canvas.width * 0.22,
    );
    reactorAura.addColorStop(0, "rgb(255 61 0 / 0.095)");
    reactorAura.addColorStop(0.28, "rgb(116 48 28 / 0.045)");
    reactorAura.addColorStop(1, "rgb(0 0 0 / 0)");
    context.fillStyle = reactorAura;
    context.fillRect(0, 0, canvas.width, canvas.height);

    context.save();
    context.translate(canvas.width * 0.5, canvas.height * 0.48);
    context.strokeStyle = "rgb(143 166 181 / 0.045)";
    context.lineWidth = 1;
    for (let index = 0; index < 8; index += 1) {
      context.beginPath();
      context.ellipse(0, 0, 190 + index * 116, 62 + index * 38, 0, 0, Math.PI * 2);
      context.stroke();
    }
    context.restore();

    for (let index = 0; index < 280; index += 1) {
      const x = (Math.sin(index * 91.731) * 0.5 + 0.5) * canvas.width;
      const y = (Math.sin((index + 37) * 47.117) * 0.5 + 0.5) * canvas.height;
      const radius = index % 19 === 0 ? 1.25 : index % 7 === 0 ? 0.8 : 0.45;
      const alpha = 0.08 + (index % 9) * 0.012;
      context.fillStyle = `rgb(189 207 219 / ${alpha.toFixed(3)})`;
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
    }

    const vignette = context.createRadialGradient(
      canvas.width * 0.5,
      canvas.height * 0.46,
      canvas.width * 0.24,
      canvas.width * 0.5,
      canvas.height * 0.46,
      canvas.width * 0.72,
    );
    vignette.addColorStop(0, "rgb(0 0 0 / 0)");
    vignette.addColorStop(0.72, "rgb(0 0 0 / 0.13)");
    vignette.addColorStop(1, "rgb(0 0 0 / 0.54)");
    context.fillStyle = vignette;
    context.fillRect(0, 0, canvas.width, canvas.height);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      depthWrite: false,
      depthTest: false,
      fog: false,
      toneMapped: false,
    });
    const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(130, 78), material);
    backdrop.name = "OrbitColdGreyVolumetricBackdrop";
    backdrop.position.set(0, 1.5, -48);
    backdrop.renderOrder = -100;
    backdrop.frustumCulled = false;
    this.backgroundField.add(backdrop);
  }

  private createEnvironmentArchitecture(): void {
    const farSteel = new THREE.MeshStandardMaterial({
      color: 0x31414a,
      metalness: 0.96,
      roughness: 0.34,
      envMapIntensity: 0.68,
    });
    const edgeSteel = new THREE.MeshStandardMaterial({
      color: 0x859aa7,
      metalness: 0.9,
      roughness: 0.28,
      envMapIntensity: 0.86,
    });
    const deadSignal = new THREE.MeshStandardMaterial({
      color: 0x4b1a10,
      emissive: 0xff3100,
      emissiveIntensity: 0.18,
      metalness: 0.7,
      roughness: 0.26,
    });

    const brokenArcs = [
      { radius: 16.5, tube: 0.34, arc: 2.15, rotation: [0.18, 0.08, -0.7], position: [-1.5, 1.4, -12] },
      { radius: 20.5, tube: 0.22, arc: 1.72, rotation: [-0.12, 0.22, 1.65], position: [2.2, -1.8, -17] },
      { radius: 25.5, tube: 0.42, arc: 1.28, rotation: [0.26, -0.18, 2.92], position: [-3.5, 2.8, -24] },
      { radius: 29.0, tube: 0.16, arc: 2.55, rotation: [-0.2, 0.12, 4.05], position: [4.2, -2.5, -29] },
    ] as const;
    brokenArcs.forEach((definition, index) => {
      const geometry = new THREE.TorusGeometry(definition.radius, definition.tube, 8, 112, definition.arc);
      const arc = new THREE.Mesh(geometry, index === 1 ? edgeSteel : farSteel);
      arc.name = `DockBrokenHalo_${index + 1}`;
      arc.rotation.set(definition.rotation[0], definition.rotation[1], definition.rotation[2]);
      arc.position.set(definition.position[0], definition.position[1], definition.position[2]);
      this.environmentArchitecture.add(arc);
      const signalGeometry = new THREE.TorusGeometry(definition.radius + definition.tube * 1.5, 0.028, 5, 112, definition.arc * 0.82);
      const signal = new THREE.Mesh(signalGeometry, deadSignal);
      signal.rotation.copy(arc.rotation);
      signal.position.copy(arc.position);
      signal.rotation.z += 0.08;
      this.environmentArchitecture.add(signal);
    });

    // Monumental sidewalls give the planets an authored place to inhabit. The
    // inner edges sit just outside the hero lane, so they crop into the frame
    // like a deep-space assembly dock instead of reading as decorative lines
    // on a black background.
    const sidewall = new THREE.Group();
    sidewall.name = "DockMonumentalSidewalls";
    const panelGeometry = new THREE.BoxGeometry(2.9, 8.6, 0.7, 2, 4, 1);
    const edgeGeometry = new THREE.BoxGeometry(0.13, 7.5, 0.16);
    const signalGeometry = new THREE.BoxGeometry(0.045, 3.4, 0.055);
    const wallDepths = this.quality === "mobile" ? [-10, -19] : [-8, -15, -23];
    wallDepths.forEach((depth, row) => {
      [-1, 1].forEach((side) => {
        const panel = new THREE.Mesh(panelGeometry, row === 1 ? edgeSteel : farSteel);
        panel.name = `DockSidewall_${side < 0 ? "L" : "R"}_${row + 1}`;
        panel.position.set(side * (8.2 + row * 1.35), (row - 1) * 1.25, depth);
        panel.rotation.set(side * 0.045, side * (0.22 + row * 0.035), side * (0.08 + row * 0.025));
        sidewall.add(panel);

        const innerEdge = new THREE.Mesh(edgeGeometry, edgeSteel);
        innerEdge.name = `${panel.name}_InnerEdge`;
        innerEdge.position.set(-side * 1.31, 0, 0.43);
        panel.add(innerEdge);

        if (row !== 1 || this.quality !== "mobile") {
          const status = new THREE.Mesh(signalGeometry, deadSignal);
          status.name = `${panel.name}_StatusBus`;
          status.position.set(-side * 1.43, -1.35 + row * 0.85, 0.49);
          panel.add(status);
        }
      });
    });
    this.environmentArchitecture.add(sidewall);

    const crown = new THREE.Group();
    crown.name = "DockDistantServiceCrown";
    const crownBlockGeometry = new THREE.BoxGeometry(1.55, 0.48, 1.05);
    const crownCount = this.quality === "mobile" ? 9 : 14;
    for (let index = 0; index < crownCount; index += 1) {
      const angle = THREE.MathUtils.lerp(-2.58, 0.58, index / Math.max(1, crownCount - 1));
      const radius = 12.6 + (index % 3) * 0.55;
      const block = new THREE.Mesh(crownBlockGeometry, index % 5 === 2 ? edgeSteel : farSteel);
      block.name = `DockCrownModule_${index + 1}`;
      block.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius * 0.64 + 2.3, -19 - (index % 2) * 0.8);
      block.rotation.set(0.08 * (index % 2), -0.12 + (index % 3) * 0.1, angle + Math.PI * 0.5);
      block.scale.set(0.78 + (index % 4) * 0.11, 1, 1);
      crown.add(block);
    }
    this.environmentArchitecture.add(crown);

    const strutGeometry = new THREE.BoxGeometry(0.34, 6.8, 0.42);
    const strutCount = this.quality === "mobile" ? 12 : 28;
    const struts = new THREE.InstancedMesh(strutGeometry, farSteel, strutCount);
    struts.name = "DockFarField_Struts";
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const position = new THREE.Vector3();
    for (let index = 0; index < strutCount; index += 1) {
      const side = index % 2 === 0 ? -1 : 1;
      const row = Math.floor(index / 2);
      position.set(side * (11.8 + (row % 4) * 1.85), -7.8 + (row % 7) * 2.6, -5 - row * 1.65);
      quaternion.setFromEuler(new THREE.Euler(0.08 * (row % 3), side * 0.12, side * (0.18 + (row % 4) * 0.035)));
      scale.set(1, 0.78 + (row % 5) * 0.16, 1);
      matrix.compose(position, quaternion, scale);
      struts.setMatrixAt(index, matrix);
    }
    struts.instanceMatrix.needsUpdate = true;
    this.environmentArchitecture.add(struts);

    const bridgeGeometry = new THREE.BoxGeometry(5.2, 0.22, 0.32);
    const bridgeCount = this.quality === "mobile" ? 6 : 12;
    const bridges = new THREE.InstancedMesh(bridgeGeometry, edgeSteel, bridgeCount);
    bridges.name = "DockFarField_Bridges";
    for (let index = 0; index < bridgeCount; index += 1) {
      const side = index % 2 === 0 ? -1 : 1;
      position.set(side * (12.6 + (index % 3)), -5.6 + (index % 6) * 2.3, -7 - index * 1.9);
      quaternion.setFromEuler(new THREE.Euler(0, side * 0.18, side * (Math.PI * 0.5 - 0.14)));
      scale.set(0.72 + (index % 4) * 0.16, 1, 1);
      matrix.compose(position, quaternion, scale);
      bridges.setMatrixAt(index, matrix);
    }
    bridges.instanceMatrix.needsUpdate = true;
    this.environmentArchitecture.add(bridges);

    const particleCount = this.quality === "mobile" ? 180 : this.quality === "ultra" ? 620 : 360;
    const particlePositions = new Float32Array(particleCount * 3);
    const random = (seed: number) => {
      const value = Math.sin(seed * 91.733) * 43758.5453;
      return value - Math.floor(value);
    };
    for (let index = 0; index < particleCount; index += 1) {
      particlePositions[index * 3] = (random(index + 1) - 0.5) * 42;
      particlePositions[index * 3 + 1] = (random(index + 101) - 0.5) * 26;
      particlePositions[index * 3 + 2] = -2 - random(index + 211) * 35;
    }
    const particlesGeometry = new THREE.BufferGeometry();
    particlesGeometry.setAttribute("position", new THREE.BufferAttribute(particlePositions, 3));
    const particles = new THREE.Points(
      particlesGeometry,
      new THREE.PointsMaterial({ color: 0xaec0cd, size: 0.03, transparent: true, opacity: 0.46, depthWrite: false }),
    );
    particles.name = "DockSuspendedParticulate";
    this.environmentArchitecture.add(particles);

    const shaftMaterial = new THREE.MeshBasicMaterial({
      color: 0x758fa6,
      transparent: true,
      opacity: 0.032,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    [-1, 1].forEach((side) => {
      const shaft = new THREE.Mesh(new THREE.ConeGeometry(5.4, 28, 20, 1, true), shaftMaterial);
      shaft.name = `DockVolumetricShaft_${side > 0 ? "R" : "L"}`;
      shaft.position.set(side * 10.5, 6.5, -15);
      shaft.rotation.z = side * 0.72;
      shaft.rotation.x = Math.PI * 0.5;
      this.environmentArchitecture.add(shaft);
    });
  }

  private createOrbitLighting(): void {
    this.orbitAmbient = new THREE.HemisphereLight(0xd1dee8, 0x172129, 0.84);
    this.orbitKey = new THREE.DirectionalLight(0xf5f1e9, 1.92);
    this.orbitKey.position.set(7, 9, 12);
    this.orbitSignalLight = new THREE.PointLight(0xff3d00, 4.35, 15, 1.85);
    this.orbitSignalLight.position.set(0, 0, -1);
    this.orbitCoolFill = new THREE.DirectionalLight(0xb8cede, 1.28);
    this.orbitCoolFill.position.set(-8, 4, 6);

    this.focusKey = new THREE.SpotLight(0xe4edf3, 0, 32, 0.42, 0.48, 1.35);
    this.focusKey.position.set(-1, 8, 10);
    this.focusKey.target = this.focusLightTarget;
    this.focusRim = new THREE.PointLight(0x91b1c6, 0, 14, 1.7);
    this.focusRim.position.set(-8, 3, -1);
    this.root.add(
      this.orbitAmbient,
      this.orbitKey,
      this.orbitSignalLight,
      this.orbitCoolFill,
      this.focusKey,
      this.focusRim,
      this.focusLightTarget,
    );
  }

  private updateDatasets(): void {
    this.experienceElement?.setAttribute("data-orbit-assets", this.assetState);
    this.experienceElement?.setAttribute("data-orbit-overview-lod", this.baseAssetTier);
    this.experienceElement?.setAttribute("data-orbit-ultra-resident", String(this.heroAssetsLoaded));
    if (!this.experienceElement) return;
    let residentMeshes = 0;
    let activeMeshes = 0;
    this.root.traverse((object) => {
      if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.Line) && !(object instanceof THREE.Points)) return;
      residentMeshes += 1;
      let visible = object.visible;
      let parent = object.parent;
      while (visible && parent) {
        visible = parent.visible;
        parent = parent.parent;
      }
      if (visible) activeMeshes += 1;
    });
    this.experienceElement.setAttribute("data-orbit-resident-drawables", String(residentMeshes));
    this.experienceElement.setAttribute("data-orbit-active-drawables", String(activeMeshes));
    if (!this.focusedPlanetId) {
      this.experienceElement.setAttribute("data-orbit-focused-lod", this.baseAssetTier);
      return;
    }
    const actor = this.actors.get(this.focusedPlanetId);
    const focusedTier = actor?.heroVariant ? "ultra" : this.baseAssetTier;
    this.experienceElement.setAttribute("data-orbit-focused-lod", focusedTier);
  }
}
