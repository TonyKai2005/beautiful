import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import {
  BASE_FOV,
  CAMERA_BEATS,
  CAMERA_COLLISION_CLEARANCES,
  CAMERA_EFFECT_WINDOWS,
  CAMERA_LOOK_AHEAD,
  CAMERA_RIG_SPEC,
  createCameraCurve,
  getCameraLookVerticalOffset,
  mapGlobalScrollToCameraT,
  type CameraCollisionReport,
} from "./CameraRig";
import { createCinematicFinishShader } from "./CinematicFinishShader";
import { GlbAssetLoader } from "./GlbAssetLoader";
import {
  ProjectOrbitScene,
  type OrbitAssetState,
  type OrbitInteractionMode,
  type OrbitLabelAnchor,
  type OrbitPlanetId,
  type OrbitPresentationState,
} from "./ProjectOrbitScene";
import type { ChapterId } from "./content";
import { ACTOR_CUES, ACTOR_CUE_BY_ID, type SemanticActorName } from "./SceneChoreography";
import { SpatialTitleRenderer, type SpatialTitle } from "./SpatialTitleRenderer";
import {
  PerformanceGovernor,
  getPerformanceQualityProfile,
  type PerformanceLevel,
} from "./PerformanceGovernor";

export type QualityTier = "ultra" | "balanced" | "mobile";

type LoadingUpdate = (progress: number, stage: string) => void;

interface TransformSnapshot {
  position: THREE.Vector3;
  rotation: THREE.Euler;
  scale: THREE.Vector3;
}

interface MaterialSnapshot {
  color: THREE.Color;
  emissive?: THREE.Color;
  emissiveIntensity?: number;
}

interface LightingGrade {
  environmentIntensity: number;
  hemisphereIntensity: number;
  keyBalanced: number;
  keyUltra: number;
  coolFillIntensity: number;
  orangeRimIntensity: number;
  exposure: number;
  fogDensity: number;
  materialDarkening: number;
  energyMultiplier: number;
  shadowLift: number;
}

type SpatialTitleId = Extract<ChapterId, "build" | "test" | "protect" | "finale">;

interface ManagedSpatialTitle {
  id: Extract<ChapterId, "build" | "test" | "protect" | "finale">;
  title: SpatialTitle<SpatialTitleId>;
  start: number;
  end: number;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const smoothstep = (edge0: number, edge1: number, value: number) => {
  const x = clamp01((value - edge0) / (edge1 - edge0));
  return x * x * (3 - 2 * x);
};

const range = (value: number, start: number, end: number) => smoothstep(start, end, value);
const SEMANTIC_ACTOR_NAMES = new Set<string>(ACTOR_CUES.map((cue) => cue.id));
const FINALE_LANDING_CAMERA_T = mapGlobalScrollToCameraT(0.915);

const WARM_LIGHTING_GRADE: LightingGrade = {
  environmentIntensity: 0.44,
  hemisphereIntensity: 0.48,
  keyBalanced: 1.05,
  keyUltra: 1.72,
  coolFillIntensity: 0,
  orangeRimIntensity: 1.8,
  exposure: 0.68,
  fogDensity: 0.011,
  materialDarkening: 0,
  energyMultiplier: 1,
  shadowLift: 0,
};

const INK_LIGHTING_GRADE: LightingGrade = {
  environmentIntensity: 0.34,
  hemisphereIntensity: 0.22,
  keyBalanced: 0.68,
  keyUltra: 0.88,
  coolFillIntensity: 0.48,
  orangeRimIntensity: 3.2,
  exposure: 0.78,
  fogDensity: 0.0145,
  materialDarkening: 0.72,
  energyMultiplier: 1.12,
  shadowLift: 0.05,
};

export class DeploymentExperience {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly assetLoader: GlbAssetLoader;
  private readonly projectOrbit: ProjectOrbitScene;
  private readonly experienceElement: HTMLElement | null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(42, 1, 0.08, 68);
  private readonly timer = new THREE.Timer();
  private readonly cameraPath: THREE.CatmullRomCurve3;
  private readonly compactCameraPath: THREE.CatmullRomCurve3;
  private readonly warm = new THREE.Color(0xf2efe8);
  private readonly ink = new THREE.Color(0x070809);
  private readonly orange = new THREE.Color(0xff3d00);
  private readonly titleWarm = new THREE.Color(0xece8df);
  private readonly titleColor = new THREE.Color();
  private readonly baseTransforms = new Map<THREE.Object3D, TransformSnapshot>();
  private readonly baseMaterials = new Map<THREE.Material, MaterialSnapshot>();
  private readonly namedGroups = new Map<string, THREE.Object3D>();
  private readonly pointerTarget = new THREE.Vector2();
  private readonly pointerCurrent = new THREE.Vector2();
  private readonly cameraPosition = new THREE.Vector3();
  private readonly cameraTarget = new THREE.Vector3();
  private readonly tangentBefore = new THREE.Vector3();
  private readonly tangentAfter = new THREE.Vector3();
  private readonly signalCurve: THREE.CatmullRomCurve3;
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly cinematicFinish: ShaderPass;
  private readonly particles: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private readonly signalOrb: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  private readonly signalLight: THREE.PointLight;
  private hemisphereLight!: THREE.HemisphereLight;
  private keyLight!: THREE.DirectionalLight;
  private rimLight!: THREE.DirectionalLight;
  private coolFillLight!: THREE.DirectionalLight;
  private operateFillLight!: THREE.PointLight;
  private finaleFillLight!: THREE.PointLight;
  private readonly spatialTitles: ManagedSpatialTitle[] = [];
  private spatialTitleRenderer: SpatialTitleRenderer | null = null;
  private quality: QualityTier;
  private sceneRoot: THREE.Object3D | null = null;
  private animationFrame = 0;
  private progress = 0;
  private previousProgress = 0;
  private progressDirection = 1;
  private touchRollVelocity = 0;
  private lastChapterProgress = 0;
  private running = false;
  private hidden = false;
  private performanceLevel: PerformanceLevel = 0;
  private readonly performanceGovernor = new PerformanceGovernor();
  private speedEffectScale = 1;
  private resizeFrame = 0;
  private lastWidth = 0;
  private lastHeight = 0;
  private lastPixelRatio = 0;
  private compactViewport = window.innerWidth <= 820;
  private collisionReport: CameraCollisionReport;
  private orbitPrewarming = false;

  constructor(canvas: HTMLCanvasElement) {
    this.experienceElement = canvas.closest<HTMLElement>("[data-experience]");
    this.quality = this.detectQuality();
    canvas.dataset.quality = this.quality;
    canvas.dataset.performanceLevel = "0";
    if (this.experienceElement) {
      this.experienceElement.dataset.quality = this.quality;
      this.experienceElement.dataset.performanceLevel = "0";
    }

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: this.quality !== "mobile",
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.72;
    this.renderer.shadowMap.enabled = this.quality === "ultra";
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    const gl = this.renderer.getContext();
    const rendererInfo = gl.getExtension("WEBGL_debug_renderer_info");
    canvas.dataset.gpu = rendererInfo ? String(gl.getParameter(rendererInfo.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    this.assetLoader = new GlbAssetLoader(this.renderer);

    this.scene.background = this.ink;
    this.scene.fog = new THREE.FogExp2(this.ink, 0.018);

    const environmentGenerator = new THREE.PMREMGenerator(this.renderer);
    const roomEnvironment = new RoomEnvironment();
    this.scene.environment = environmentGenerator.fromScene(roomEnvironment, 0.035).texture;
    this.scene.environmentIntensity = 0.55;
    environmentGenerator.dispose();
    roomEnvironment.dispose();

    this.cameraPath = createCameraCurve("desktop");
    this.compactCameraPath = createCameraCurve("mobile");
    this.collisionReport = {
      viewport: this.compactViewport ? "mobile" : "desktop",
      sampleCount: 480,
      sweepRadiusMeters: CAMERA_COLLISION_CLEARANCES.sweepRadiusMeters,
      minimumMeasuredClearanceMeters: 1.16,
      requiredClearanceMeters: CAMERA_COLLISION_CLEARANCES.visibleClearanceMeters,
      status: "resolved-by-model-move",
      hits: [],
    };

    this.signalCurve = new THREE.CatmullRomCurve3(
      [
        new THREE.Vector3(-0.05, 0.28, 30),
        new THREE.Vector3(0.15, 0.3, 16),
        new THREE.Vector3(-0.35, 0.34, 1),
        new THREE.Vector3(0.5, 0.38, -15),
        new THREE.Vector3(-0.22, 0.52, -31),
        new THREE.Vector3(0, 0.68, -58),
      ],
      false,
      "catmullrom",
      0.3,
    );

    const renderPass = new RenderPass(this.scene, this.camera);
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(1, 1),
      this.quality === "ultra" ? 0.3 : this.quality === "balanced" ? 0.2 : 0.13,
      0.42,
      1.02,
    );
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(renderPass);
    this.composer.addPass(this.bloom);
    this.cinematicFinish = new ShaderPass(createCinematicFinishShader());
    this.cinematicFinish.uniforms.uGrainAmount.value = this.quality === "mobile" ? 0.004 : 0.006;
    this.cinematicFinish.uniforms.uVignetteAmount.value = 0.13;
    this.cinematicFinish.uniforms.uChromaticAberration.value = this.quality === "mobile" ? 0.06 : 0.12;
    this.cinematicFinish.uniforms.uProtectFlash.value = 0.14;
    this.cinematicFinish.uniforms.uShadowLift.value = 0;
    this.cinematicFinish.uniforms.uReducedMotion.value = 0;
    this.composer.addPass(this.cinematicFinish);
    this.composer.addPass(new OutputPass());

    this.createLighting();
    this.createSignalTrails();
    this.particles = this.createParticles();
    this.scene.add(this.particles);

    const signalMaterial = new THREE.MeshStandardMaterial({
      color: this.orange,
      emissive: this.orange,
      emissiveIntensity: 1.3,
      roughness: 0.18,
      metalness: 0.2,
    });
    this.signalOrb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 18, 18), signalMaterial);
    this.signalLight = new THREE.PointLight(this.orange, 1.3, 4, 2);
    this.scene.add(this.signalOrb, this.signalLight);
    this.projectOrbit = new ProjectOrbitScene(
      this.scene,
      this.camera,
      this.renderer,
      this.assetLoader,
      this.quality,
      this.experienceElement,
    );

    this.applyResize();
    window.addEventListener("resize", this.scheduleResize);
    document.addEventListener("visibilitychange", this.handleVisibility);
  }

  async load(onUpdate: LoadingUpdate): Promise<void> {
    onUpdate(0.08, "CALIBRATING GRAPHICS");
    await new Promise<void>((resolve) => window.setTimeout(resolve, 220));

    onUpdate(0.14, `LOADING ${this.quality.toUpperCase()} ENVIRONMENT`);
    const modelUrl = this.quality === "ultra"
      ? "/assets/3d/egain-corridor.glb?v=architectural-compression-20260718"
      : "/assets/3d/egain-corridor-balanced.glb?v=architectural-compression-20260718";

    const corridor = await this.assetLoader.load(modelUrl, ({ ratio }) => {
      if (ratio !== null) onUpdate(0.14 + ratio * 0.58, `LOADING ${this.quality.toUpperCase()} ENVIRONMENT`);
    });
    onUpdate(0.72, "DECODING DEPLOYMENT CORRIDOR");
    const sceneRoot = corridor.scene;

    this.sceneRoot = sceneRoot;
    this.scene.add(sceneRoot);
    this.prepareModel(sceneRoot);
    await this.createSpatialTitles();
    onUpdate(0.76, "TRANSCODING MATERIAL SYSTEM");

    await new Promise<void>((resolve) => window.setTimeout(resolve, 120));
    onUpdate(0.84, "COMPILING CINEMATIC SHADERS");
    await this.renderer.compileAsync(this.scene, this.camera);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    onUpdate(0.94, "PREWARMING SEVEN ENVIRONMENTS");
    const originalProgress = this.progress;
    for (const progress of [0, 0.11, 0.29, 0.46, 0.64, 0.8, 0.94]) {
      this.setProgress(progress);
      this.composer.render();
    }
    this.setProgress(originalProgress);
    const canvas = this.renderer.domElement;
    canvas.dataset.cameraRig = "single-path-forward-look";
    canvas.dataset.collision = this.collisionReport.status;
    canvas.dataset.collisionSamples = String(this.collisionReport.sampleCount);
    canvas.dataset.collisionClearance = this.collisionReport.minimumMeasuredClearanceMeters.toFixed(2);
    onUpdate(1, "SYSTEM READY");
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.timer.reset();
    this.performanceGovernor.resetAfterPrewarm(this.performanceLevel);
    this.animationFrame = requestAnimationFrame(this.render);
  }

  setProgress(progress: number): void {
    const rawProgress = clamp01(progress);
    const progressDelta = rawProgress - this.previousProgress;
    if (Math.abs(progressDelta) > 0.000001) this.progressDirection = Math.sign(progressDelta);
    this.touchRollVelocity = THREE.MathUtils.lerp(
      this.touchRollVelocity,
      THREE.MathUtils.clamp(progressDelta * 180, -1, 1),
      0.42,
    );
    this.previousProgress = rawProgress;
    this.progress = rawProgress;
    this.lastChapterProgress = this.progress;
    if (this.projectOrbit.isActive()) return;
    this.updateEnvironment();
    this.updateCamera();
    this.updateModelStates();
  }

  setPointer(x: number, y: number): void {
    if (this.getQuality() === "mobile") return;
    this.pointerTarget.set(THREE.MathUtils.clamp(x, -1, 1), THREE.MathUtils.clamp(y, -1, 1));
  }

  getQuality(): QualityTier {
    return this.compactViewport ? "mobile" : this.quality;
  }

  getProjectOrbitAssetState(): OrbitAssetState {
    return this.projectOrbit.getAssetState();
  }

  async preloadProjectOrbit(onProgress?: (loaded: number, total: number) => void): Promise<void> {
    this.orbitPrewarming = true;
    try {
      await this.projectOrbit.preload(onProgress);
    } finally {
      this.orbitPrewarming = false;
      this.performanceGovernor.resetAfterPrewarm(this.performanceLevel);
    }
  }

  async enterProjectOrbit(onFocus?: (id: OrbitPlanetId) => void): Promise<void> {
    this.setCinematicVisibility(false);
    this.cinematicFinish.uniforms.uOrbitMode.value = 1;
    this.bloom.strength = this.getQuality() === "mobile" ? 0.14 : this.quality === "ultra" ? 0.29 : 0.22;
    this.cinematicFinish.uniforms.uChromaticAberration.value = this.getQuality() === "mobile" ? 0.035 : 0.07;
    this.cinematicFinish.uniforms.uProtectFlash.value = 0;
    this.cinematicFinish.uniforms.uProtectPulse.value = 0;
    this.cinematicFinish.uniforms.uProtectSweep.value = 0;
    // Project Orbit begins at the Finale landing, where the corridor's sprint
    // envelope may still be non-zero. Explicitly clear the first film's speed
    // treatment so its procedural shutter streaks cannot contaminate the
    // automatic solar-system reveal.
    this.cinematicFinish.uniforms.uSpeedImpact.value = 0;
    this.cinematicFinish.uniforms.uShadowLift.value = 0.035;
    try {
      await this.projectOrbit.enter(onFocus);
    } catch (error) {
      this.cinematicFinish.uniforms.uOrbitMode.value = 0;
      this.setCinematicVisibility(true);
      throw error;
    }
  }

  async exitProjectOrbit(): Promise<void> {
    await this.projectOrbit.exit();
    this.cinematicFinish.uniforms.uOrbitMode.value = 0;
    this.setCinematicVisibility(true);
    this.updateEnvironment();
    this.updateCamera();
    this.updateModelStates();
  }

  setProjectOrbitPresentation(state: OrbitPresentationState): void {
    this.projectOrbit.setPresentation(state);
  }

  setProjectOrbitJourneyProgress(progress: number): void {
    this.projectOrbit.setJourneyProgress(progress);
  }

  pickProjectOrbitPlanet(clientX: number, clientY: number): OrbitPlanetId | null {
    return this.projectOrbit.pickPlanet(clientX, clientY);
  }

  setProjectOrbitHoveredPlanet(id: OrbitPlanetId | null): void {
    this.projectOrbit.setHoveredPlanet(id);
  }

  focusProjectOrbitPlanet(id: OrbitPlanetId, notify = true): void {
    this.projectOrbit.focus(id, notify);
  }

  clearProjectOrbitFocus(): void {
    this.projectOrbit.clearFocus();
  }

  getProjectOrbitFocusedPlanet(): OrbitPlanetId | null {
    return this.projectOrbit.getFocusedPlanet();
  }

  getProjectOrbitInteractionMode(): OrbitInteractionMode {
    return this.projectOrbit.getInteractionMode();
  }

  getProjectOrbitLabelAnchors(): OrbitLabelAnchor[] {
    return this.projectOrbit.getProjectedLabelAnchors();
  }

  cycleProjectOrbit(direction: -1 | 1): void {
    this.projectOrbit.cycle(direction);
  }

  adjustProjectOrbitZoom(delta: number): void {
    this.projectOrbit.adjustZoom(delta);
  }

  destroy(): void {
    this.running = false;
    cancelAnimationFrame(this.animationFrame);
    window.removeEventListener("resize", this.scheduleResize);
    cancelAnimationFrame(this.resizeFrame);
    document.removeEventListener("visibilitychange", this.handleVisibility);
    this.spatialTitles.forEach(({ title }) => {
      title.mesh.removeFromParent();
      title.dispose();
    });
    this.spatialTitleRenderer?.dispose();
    this.spatialTitleRenderer = null;
    this.projectOrbit.dispose();
    this.composer.dispose();
    this.assetLoader.dispose();
    this.timer.dispose();
    this.renderer.dispose();
  }

  private detectQuality(): QualityTier {
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    if (coarse || window.innerWidth <= 820) return "mobile";

    const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
    const cores = navigator.hardwareConcurrency || 4;
    if (window.innerWidth >= 1440 && deviceMemory >= 8 && cores >= 10) return "ultra";
    return "balanced";
  }

  private createLighting(): void {
    this.hemisphereLight = new THREE.HemisphereLight(0xf4f0e8, 0x080808, 0.62);
    this.scene.add(this.hemisphereLight);

    this.keyLight = new THREE.DirectionalLight(0xfff5e8, this.quality === "ultra" ? 2.4 : 1.35);
    this.keyLight.position.set(7, 12, 14);
    this.keyLight.castShadow = this.quality === "ultra";
    this.keyLight.shadow.mapSize.set(this.quality === "ultra" ? 2048 : 1024, this.quality === "ultra" ? 2048 : 1024);
    this.keyLight.shadow.camera.near = 1;
    this.keyLight.shadow.camera.far = 60;
    this.keyLight.shadow.camera.left = -15;
    this.keyLight.shadow.camera.right = 15;
    this.keyLight.shadow.camera.top = 15;
    this.keyLight.shadow.camera.bottom = -15;
    this.scene.add(this.keyLight);

    this.rimLight = new THREE.DirectionalLight(this.orange, 2);
    this.rimLight.position.set(-10, 3, -30);
    this.scene.add(this.rimLight);

    this.coolFillLight = new THREE.DirectionalLight(0xb8c7d9, 0);
    this.coolFillLight.position.set(8, 7, -18);
    this.scene.add(this.coolFillLight);

    this.operateFillLight = new THREE.PointLight(0xb8c7d9, 0, 11, 2);
    this.operateFillLight.position.set(-0.05, 3.17, -44.83);
    this.scene.add(this.operateFillLight);

    this.finaleFillLight = new THREE.PointLight(0xc7d4e2, 0, 12, 2);
    this.finaleFillLight.position.set(0, 2.9, -58.1);
    this.scene.add(this.finaleFillLight);
  }

  private createSignalTrails(): void {
    const sampleCount = this.quality === "mobile" ? 90 : 180;
    const offsets = [-0.17, 0, 0.17];

    offsets.forEach((offset, index) => {
      const points = this.signalCurve.getPoints(sampleCount).map((point) => point.clone().add(new THREE.Vector3(offset, index * 0.035, 0)));
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineBasicMaterial({
        color: index === 1 ? 0xff6a28 : 0xff3d00,
        transparent: true,
        opacity: index === 1 ? 1 : 0.42,
      });
      const line = new THREE.Line(geometry, material);
      line.name = `SignalTrail_${index}`;
      this.scene.add(line);
    });
  }

  private createParticles(): THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> {
    const count = this.quality === "ultra" ? 5200 : this.quality === "balanced" ? 3000 : 1100;
    const positions = new Float32Array(count * 3);

    for (let index = 0; index < count; index += 1) {
      const cursor = index * 3;
      const progress = Math.random();
      const center = this.signalCurve.getPointAt(progress);
      const radius = 0.6 + Math.random() * 11;
      const angle = Math.random() * Math.PI * 2;
      positions[cursor] = center.x + Math.cos(angle) * radius;
      positions[cursor + 1] = center.y + (Math.random() - 0.5) * 11;
      positions[cursor + 2] = center.z + Math.sin(angle) * radius * 0.22;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: this.orange,
      size: this.quality === "mobile" ? 0.026 : 0.035,
      transparent: true,
      opacity: 0.58,
      sizeAttenuation: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    return new THREE.Points(geometry, material);
  }

  private async createSpatialTitles(): Promise<void> {
    this.spatialTitleRenderer = await SpatialTitleRenderer.load(this.renderer);
    const definitions: Array<{
      id: SpatialTitleId;
      start: number;
      end: number;
      color: THREE.ColorRepresentation;
      desktop: { lines: string[]; align: "left" | "center" | "right"; targetScreenWidth: number };
      mobile: { lines: string[]; align: "left" | "center" | "right"; targetScreenWidth: number };
    }> = [
      {
        id: "build",
        start: 0.07,
        end: 0.24,
        color: this.titleWarm,
        desktop: { lines: ["ENGINEERING IDEAS", "INTO SYSTEMS."], align: "left", targetScreenWidth: 0.68 },
        mobile: { lines: ["ENGINEERING", "IDEAS INTO", "SYSTEMS."], align: "center", targetScreenWidth: 0.84 },
      },
      {
        id: "test",
        start: 0.24,
        end: 0.39,
        color: this.ink,
        desktop: { lines: ["PROOF BEFORE", "PROMISE."], align: "center", targetScreenWidth: 0.76 },
        mobile: { lines: ["PROOF BEFORE", "PROMISE."], align: "center", targetScreenWidth: 0.82 },
      },
      {
        id: "protect",
        start: 0.58,
        end: 0.73,
        color: this.ink,
        desktop: { lines: ["SECURITY BECOMES", "THE ENVIRONMENT."], align: "left", targetScreenWidth: 0.74 },
        mobile: { lines: ["SECURITY", "BECOMES THE", "ENVIRONMENT."], align: "center", targetScreenWidth: 0.82 },
      },
      {
        id: "finale",
        start: 0.88,
        end: 1,
        color: this.titleWarm,
        desktop: { lines: ["PUT YOUR NEXT SYSTEM", "IN MOTION."], align: "center", targetScreenWidth: 0.68 },
        mobile: { lines: ["PUT YOUR NEXT", "SYSTEM IN", "MOTION."], align: "center", targetScreenWidth: 0.78 },
      },
    ];

    definitions.forEach((definition) => {
      const title = this.spatialTitleRenderer!.createTitle({
        id: definition.id,
        desktop: definition.desktop,
        mobile: definition.mobile,
        color: definition.color,
        outlineWidth: 0.66,
        outlineOpacity: 0.48,
        depthTest: true,
        renderOrder: 2,
      });
      this.scene.add(title.mesh);
      this.spatialTitles.push({ id: definition.id, title, start: definition.start, end: definition.end });
    });
    document.querySelector<HTMLElement>("[data-experience]")?.setAttribute("data-spatial-titles", "true");
  }

  private updateSpatialTitles(): void {
    if (!this.spatialTitles.length) return;
    const viewport = this.compactViewport ? "mobile" : "desktop";

    this.spatialTitles.forEach((managed) => {
      const introStart = managed.id === "build" ? 0.102 : managed.start;
      const intro = range(this.progress, introStart, Math.min(managed.end, introStart + 0.032));
      const outro = managed.id === "finale" ? 1 : 1 - range(this.progress, managed.end - 0.032, managed.end);
      const opacity = intro * outro;

      if (managed.id === "build") {
        managed.title.setColor(this.titleColor.copy(this.titleWarm).lerp(this.ink, range(this.progress, 0.085, 0.125)));
      } else if (managed.id === "protect") {
        managed.title.setColor(this.titleColor.copy(this.ink).lerp(this.titleWarm, range(this.progress, 0.603, 0.635)));
      } else if (managed.id === "test") {
        managed.title.setColor(this.ink);
      } else {
        managed.title.setColor(this.titleWarm);
      }

      const heroProgress = managed.id === "build" ? 0.155 : managed.id === "test" ? 0.315 : managed.id === "protect" ? 0.655 : 0.945;
      const heroProtection = range(this.progress, heroProgress - 0.045, heroProgress)
        * (1 - range(this.progress, heroProgress + 0.055, heroProgress + 0.095));
      managed.title.mesh.material.depthTest = heroProtection < 0.985;
      const baseDepth = managed.id === "build" ? 6.1 : managed.id === "test" ? 6.4 : managed.id === "protect" ? 6.6 : 6.8;
      const protectedDepth = managed.id === "build" ? 3.35 : managed.id === "test" ? 2.75 : managed.id === "protect" ? 3.05 : 1.35;
      let depth = THREE.MathUtils.lerp(baseDepth, protectedDepth, heroProtection);
      if (managed.id === "finale" && this.progress >= 0.945) depth = 1.35;
      const desktopY = managed.id === "build" ? 0.3 : managed.id === "test" ? 0.46 : managed.id === "protect" ? 0.4 : 0.32;
      const desktopX = managed.id === "build" || managed.id === "protect" ? -0.39 : 0;
      const screenX = this.compactViewport ? 0 : desktopX;
      const authoredScreenWidth = managed.title.getMetrics(viewport).targetScreenWidth;
      const targetScreenWidth = managed.id === "finale"
        ? THREE.MathUtils.lerp(authoredScreenWidth, this.compactViewport ? 0.7 : 0.6, range(this.progress, 0.958, 0.995))
        : authoredScreenWidth;
      managed.title.place({
        camera: this.camera,
        viewport,
        depth,
        targetScreenWidth,
        screenOffset: { x: screenX, y: 0 },
        worldOffset: { x: 0, y: this.compactViewport ? 0.35 : desktopY },
        opacity,
        revealScale: 0.975 + opacity * 0.025,
      });
    });
  }

  private prepareModel(root: THREE.Object3D): void {
    root.traverse((object) => {
      this.baseTransforms.set(object, {
        position: object.position.clone(),
        rotation: object.rotation.clone(),
        scale: object.scale.clone(),
      });

      if (
        ["SignalRail", "BuildAssembly", "TestGate", "DeployArray", "ProtectPlane", "CloudTopology", "FinaleCore"].includes(object.name)
        || SEMANTIC_ACTOR_NAMES.has(object.name)
      ) {
        this.namedGroups.set(object.name, object);
      }

      if (!(object instanceof THREE.Mesh)) return;
      if (object.name === "FinaleBrandMedallion") {
        const medallionMaterial = (Array.isArray(object.material) ? object.material[0] : object.material).clone();
        if (medallionMaterial instanceof THREE.MeshStandardMaterial || medallionMaterial instanceof THREE.MeshPhysicalMaterial) {
          medallionMaterial.name = "Finale graphite medallion";
          medallionMaterial.color.set(0x3c4650);
          medallionMaterial.emissive.set(0x071018);
          medallionMaterial.emissiveIntensity = 0.16;
          medallionMaterial.metalness = 0.78;
          medallionMaterial.roughness = 0.24;
        }
        object.material = medallionMaterial;
      } else if (object.name === "FinaleMark") {
        const markMaterial = (Array.isArray(object.material) ? object.material[0] : object.material).clone();
        if (markMaterial instanceof THREE.MeshStandardMaterial || markMaterial instanceof THREE.MeshPhysicalMaterial) {
          markMaterial.name = "Finale illuminated brand mark";
          markMaterial.color.copy(this.titleWarm);
          markMaterial.emissive.copy(this.titleWarm);
          markMaterial.emissiveIntensity = 0.28;
          markMaterial.metalness = 0.12;
          markMaterial.roughness = 0.32;
        }
        object.material = markMaterial;
      }
      object.frustumCulled = true;
      object.castShadow = this.quality === "ultra" && !this.materialIsTransparent(object.material);
      object.receiveShadow = this.quality === "ultra";

      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => {
        if (!(material instanceof THREE.MeshStandardMaterial) && !(material instanceof THREE.MeshPhysicalMaterial)) return;
        if (!this.baseMaterials.has(material)) {
          this.baseMaterials.set(material, {
            color: material.color.clone(),
            emissive: material.emissive.clone(),
            emissiveIntensity: material.emissiveIntensity,
          });
        }
        if (material.map) material.map.anisotropy = this.quality === "ultra" ? 8 : 4;
        if (!material.transparent && material.opacity >= 0.99) {
          material.side = THREE.FrontSide;
          material.needsUpdate = true;
        }
        const materialName = material.name.toLowerCase();
        if (materialName.includes("verification glass") && this.quality !== "ultra" && material instanceof THREE.MeshPhysicalMaterial) {
          material.transmission = 0;
          material.transparent = true;
          material.opacity = 0.28;
          material.depthWrite = false;
          material.needsUpdate = true;
        }
        if (materialName.includes("orange") || materialName.includes("signal")) {
          material.emissive = this.orange.clone();
          material.emissiveIntensity = this.quality === "ultra" ? 1.35 : 1.05;
        }
      });
    });

    this.updateModelStates();
  }

  private materialIsTransparent(material: THREE.Material | THREE.Material[]): boolean {
    return Array.isArray(material) ? material.some((item) => item.transparent) : material.transparent;
  }

  private updateEnvironment(): void {
    const warmArrival = smoothstep(0.035, 0.11, this.progress);
    const protectInversion = smoothstep(0.606, 0.638, this.progress);
    const darkness = 1 - warmArrival * (1 - protectInversion);
    const color = this.warm.clone().lerp(this.ink, darkness);
    this.scene.background = color;
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.color.copy(color);
      this.scene.fog.density = THREE.MathUtils.lerp(
        WARM_LIGHTING_GRADE.fogDensity,
        INK_LIGHTING_GRADE.fogDensity,
        darkness,
      );
    }
    this.baseMaterials.forEach((base, material) => {
      if (!(material instanceof THREE.MeshStandardMaterial) && !(material instanceof THREE.MeshPhysicalMaterial)) return;
      const energyMaterial = /orange|signal|energy/i.test(material.name);
      material.color.copy(base.color);
      if (!energyMaterial) {
        const surfaceRelief = material.metalness * 0.045 + (1 - material.roughness) * 0.025;
        const darkening = Math.max(0.64, INK_LIGHTING_GRADE.materialDarkening - surfaceRelief);
        material.color.lerp(this.ink, protectInversion * darkening);
      }
      if (base.emissive) material.emissive.copy(base.emissive);
      if (base.emissiveIntensity !== undefined) {
        const multiplier = energyMaterial
          ? THREE.MathUtils.lerp(WARM_LIGHTING_GRADE.energyMultiplier, INK_LIGHTING_GRADE.energyMultiplier, protectInversion)
          : 1 - protectInversion * 0.14;
        const authoredEnergyCeiling = this.quality === "ultra" ? 0.96 : this.quality === "balanced" ? 0.8 : 0.66;
        const baseIntensity = energyMaterial
          ? Math.min(base.emissiveIntensity, authoredEnergyCeiling)
          : base.emissiveIntensity;
        material.emissiveIntensity = baseIntensity * multiplier;
      }
    });

    const warmKey = this.quality === "ultra" ? WARM_LIGHTING_GRADE.keyUltra : WARM_LIGHTING_GRADE.keyBalanced;
    const inkKey = this.quality === "ultra" ? INK_LIGHTING_GRADE.keyUltra : INK_LIGHTING_GRADE.keyBalanced;
    this.scene.environmentIntensity = THREE.MathUtils.lerp(
      WARM_LIGHTING_GRADE.environmentIntensity,
      INK_LIGHTING_GRADE.environmentIntensity,
      protectInversion,
    );
    this.hemisphereLight.intensity = THREE.MathUtils.lerp(
      WARM_LIGHTING_GRADE.hemisphereIntensity,
      INK_LIGHTING_GRADE.hemisphereIntensity,
      protectInversion,
    );
    this.keyLight.intensity = THREE.MathUtils.lerp(warmKey, inkKey, protectInversion);
    this.rimLight.intensity = THREE.MathUtils.lerp(
      WARM_LIGHTING_GRADE.orangeRimIntensity,
      INK_LIGHTING_GRADE.orangeRimIntensity,
      protectInversion,
    );
    this.coolFillLight.intensity = INK_LIGHTING_GRADE.coolFillIntensity * protectInversion;
    const operateWindow = range(this.progress, 0.69, 0.76) * (1 - range(this.progress, 0.89, 0.935));
    const finaleWindow = range(this.progress, 0.84, 0.92);
    this.operateFillLight.intensity = 0.95 * protectInversion * operateWindow;
    this.finaleFillLight.intensity = 1.08 * protectInversion * finaleWindow;

    const protectPulse = Math.max(0, 1 - Math.abs(this.progress - 0.622) * 24);
    const warmExposure = THREE.MathUtils.lerp(0.62, WARM_LIGHTING_GRADE.exposure, warmArrival);
    this.renderer.toneMappingExposure = THREE.MathUtils.lerp(
      warmExposure,
      INK_LIGHTING_GRADE.exposure,
      protectInversion,
    ) + protectPulse * 0.04;
    const effectiveQuality = this.getQuality();
    const qualityBloom = effectiveQuality === "ultra" ? 0.24 : effectiveQuality === "balanced" ? 0.16 : 0.1;
    const bloomScale = getPerformanceQualityProfile(this.performanceLevel).bloomIntensityScale;
    this.bloom.enabled = true;
    this.bloom.strength = qualityBloom * bloomScale + protectPulse * 0.14;
    this.cinematicFinish.uniforms.uProtectPulse.value = protectPulse;
    this.cinematicFinish.uniforms.uProtectSweep.value = smoothstep(0.565, 0.622, this.progress);
    this.cinematicFinish.uniforms.uShadowLift.value = THREE.MathUtils.lerp(
      WARM_LIGHTING_GRADE.shadowLift,
      INK_LIGHTING_GRADE.shadowLift,
      protectInversion,
    );
    const baseAberration = effectiveQuality === "mobile" ? 0.06 : 0.12;
    this.cinematicFinish.uniforms.uChromaticAberration.value = baseAberration + protectPulse * (effectiveQuality === "mobile" ? 0.22 : 0.6);
    const speedImpact = Math.max(...CAMERA_EFFECT_WINDOWS.map((window) => this.cameraEnvelope(window.progress)));
    this.cinematicFinish.uniforms.uSpeedImpact.value = speedImpact * this.speedEffectScale;
    const direction = this.progressDirection;
    this.cinematicFinish.uniforms.uSpeedDirection.value.set(0.18 * direction, -direction).normalize();
  }

  private updateCamera(): void {
    if (this.projectOrbit.isActive()) {
      this.projectOrbit.applyCamera(this.pointerCurrent);
      return;
    }
    const rawCinematic = mapGlobalScrollToCameraT(this.progress);
    // The sprint crosses the brand core, then the final 3.5% reverses along
    // the same approved curve to reveal a deliberate, stable end frame.
    const finaleReturn = range(this.progress, 0.965, 1);
    const cinematic = THREE.MathUtils.lerp(rawCinematic, FINALE_LANDING_CAMERA_T, finaleReturn);
    const positionPath = this.compactViewport ? this.compactCameraPath : this.cameraPath;
    positionPath.getPointAt(cinematic, this.cameraPosition);
    positionPath.getPointAt(Math.min(1, cinematic + CAMERA_LOOK_AHEAD), this.cameraTarget);

    this.camera.position.copy(this.cameraPosition);
    if (!this.compactViewport) {
      this.camera.position.x += this.pointerCurrent.x * 0.12;
      this.camera.position.y += this.pointerCurrent.y * 0.08;
    }

    const impact = CAMERA_EFFECT_WINDOWS.reduce(
      (strongest, window) => Math.max(strongest, this.cameraEnvelope(window.progress) * window.shakeMeters),
      0,
    );
    if (impact > 0) {
      const phase = this.progress * 2780;
      this.camera.position.x += Math.sin(phase * 1.17) * impact * 0.58;
      this.camera.position.y += Math.cos(phase * 0.91) * impact * 0.42;
      this.camera.position.z += Math.sin(phase * 0.63) * impact * 0.24;
    }

    this.cameraTarget.y += getCameraLookVerticalOffset(this.compactViewport ? "mobile" : "desktop");
    this.camera.lookAt(this.cameraTarget);

    const beforeT = Math.max(0, cinematic - 0.012);
    const afterT = Math.min(1, cinematic + 0.012);
    positionPath.getTangentAt(beforeT, this.tangentBefore);
    positionPath.getTangentAt(afterT, this.tangentAfter);
    const signedBend = Math.atan2(
      this.tangentBefore.x * this.tangentAfter.z - this.tangentBefore.z * this.tangentAfter.x,
      this.tangentBefore.x * this.tangentAfter.x + this.tangentBefore.z * this.tangentAfter.z,
    );
    const curveRoll = THREE.MathUtils.clamp(
      signedBend * 1.35,
      -THREE.MathUtils.degToRad(CAMERA_RIG_SPEC.roll.curvatureMaxDegrees),
      THREE.MathUtils.degToRad(CAMERA_RIG_SPEC.roll.curvatureMaxDegrees),
    );
    const pointerRoll = this.compactViewport
      ? this.touchRollVelocity * THREE.MathUtils.degToRad(CAMERA_RIG_SPEC.roll.touchVelocityMaxDegrees)
      : -this.pointerCurrent.x * THREE.MathUtils.degToRad(CAMERA_RIG_SPEC.roll.pointerMaxDegrees);
    this.camera.rotation.z += curveRoll + pointerRoll;

    const baseFov = this.compactViewport ? BASE_FOV.mobile : BASE_FOV.desktop;
    let fov: number = baseFov;
    CAMERA_BEATS.forEach((beat) => {
      const target = this.compactViewport ? beat.fovTarget.mobile : beat.fovTarget.desktop;
      fov = Math.max(fov, baseFov + (target - baseFov) * this.cameraEnvelope(beat.fovWindow));
    });
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }

    this.renderer.domElement.dataset.progress = this.progress.toFixed(4);
    this.renderer.domElement.dataset.cameraT = cinematic.toFixed(4);
    this.renderer.domElement.dataset.fov = this.camera.fov.toFixed(2);

    this.updateSpatialTitles();
  }

  private cameraEnvelope([start, peak, end]: readonly [number, number, number]): number {
    return range(this.progress, start, peak) * (1 - range(this.progress, peak, end));
  }

  private updateModelStates(): void {
    if (!this.sceneRoot) return;

    this.restoreNamedGroups();
    this.updateChapterVisibility();

    const actor = (name: SemanticActorName) => this.namedGroups.get(name);
    const actorReveal = (name: SemanticActorName) => {
      const cue = ACTOR_CUE_BY_ID.get(name);
      return cue ? range(this.progress, cue.enter[0], cue.enter[1]) : 1;
    };
    const actorExit = (name: SemanticActorName) => {
      const cue = ACTOR_CUE_BY_ID.get(name);
      return cue?.exit ? range(this.progress, cue.exit[0], cue.exit[1]) : 0;
    };

    // BUILD — software evidence enters first; the right-side architectural
    // machine then closes around it shell -> mechanics -> core -> signal.
    const buildLock = range(this.progress, 0.062, 0.17);
    const buildExit = range(this.progress, 0.235, 0.285);
    const buildGroup = this.namedGroups.get("BuildAssembly");
    if (buildGroup) {
      const base = this.baseTransforms.get(buildGroup)!;
      buildGroup.position.set(
        base.position.x + 10.4 + (1 - buildLock) * 4.8 + buildExit * 4.5,
        base.position.y - (1 - buildLock) * 3.1 + buildExit * 0.8,
        base.position.z + 16 + (1 - buildLock) * 1.8 + buildExit * 5.5,
      );
      buildGroup.rotation.y = base.rotation.y - (1 - buildLock) * 0.38 + buildExit * 0.16;
      buildGroup.scale.copy(base.scale).multiplyScalar(0.82 + buildLock * 0.18 - buildExit * 0.05);
    }

    const buildSource = actor("BuildSourceField");
    if (buildSource) {
      const base = this.baseTransforms.get(buildSource)!;
      const reveal = actorReveal("BuildSourceField");
      buildSource.position.copy(base.position).add(new THREE.Vector3((1 - reveal) * -3.2, (1 - reveal) * 1.4, (1 - reveal) * 2.1));
      buildSource.rotation.y = base.rotation.y + (1 - reveal) * 0.26;
      buildSource.scale.copy(base.scale).multiplyScalar(0.36 + reveal * 0.64);
    }
    const buildParts: Array<[SemanticActorName, THREE.Vector3, number, number]> = [
      ["BuildShell", new THREE.Vector3(3.4, -2.8, 1.5), -0.34, 0.66],
      ["BuildMechanics", new THREE.Vector3(2.3, 2.1, 1.9), 0.28, 0.48],
      ["BuildCore", new THREE.Vector3(-1.7, 0.2, 2.8), -0.22, 0.32],
      ["BuildEnergy", new THREE.Vector3(0, -0.4, 2.4), 0.16, 0.12],
    ];
    buildParts.forEach(([name, offset, yaw, startScale]) => {
      const object = actor(name);
      if (!object) return;
      const base = this.baseTransforms.get(object)!;
      const reveal = actorReveal(name);
      object.position.copy(base.position).addScaledVector(offset, 1 - reveal);
      object.rotation.y = base.rotation.y + (1 - reveal) * yaw;
      object.scale.copy(base.scale).multiplyScalar(startScale + reveal * (1 - startScale));
    });

    // TEST — the threshold is built in place. Pillars clamp from both sides,
    // the header drops, then the scanner performs the only full aperture pass.
    const testGate = this.namedGroups.get("TestGate");
    if (testGate) {
      const base = this.baseTransforms.get(testGate)!;
      testGate.position.set(base.position.x, base.position.y, base.position.z + (this.compactViewport ? 14 : 17));
      testGate.rotation.copy(base.rotation);
      testGate.scale.copy(base.scale);
    }
    const testPillars = actor("TestPillars");
    if (testPillars) {
      const base = this.baseTransforms.get(testPillars)!;
      const reveal = actorReveal("TestPillars");
      const heroClear = this.cameraEnvelope([0.287, 0.315, 0.35]);
      testPillars.position.copy(base.position);
      testPillars.scale.copy(base.scale);
      testPillars.scale.x *= 1.58 - reveal * 0.58 + heroClear * 0.2;
      testPillars.scale.y *= 0.88 + reveal * 0.12;
    }
    const testHeader = actor("TestHeaderAssembly");
    if (testHeader) {
      const base = this.baseTransforms.get(testHeader)!;
      const reveal = actorReveal("TestHeaderAssembly");
      const heroClear = this.cameraEnvelope([0.287, 0.315, 0.35]);
      testHeader.position.copy(base.position);
      testHeader.position.y += (1 - reveal) * 3.35 + heroClear * 6.4;
      testHeader.rotation.z = base.rotation.z + (1 - reveal) * 0.08;
      testHeader.scale.copy(base.scale).multiplyScalar(0.78 + reveal * 0.22);
    }
    const testThreshold = actor("TestThresholdAssembly");
    if (testThreshold) {
      const base = this.baseTransforms.get(testThreshold)!;
      const reveal = actorReveal("TestThresholdAssembly");
      const heroClear = this.cameraEnvelope([0.287, 0.315, 0.35]);
      testThreshold.position.copy(base.position);
      testThreshold.position.y -= (1 - reveal) * 1.1 + heroClear * 4.8;
      testThreshold.position.z += (1 - reveal) * 1.2;
      testThreshold.scale.copy(base.scale).multiplyScalar(0.7 + reveal * 0.3);
    }
    const scanner = actor("TestScannerAssembly") ?? testGate?.getObjectByName("TestScanner");
    if (scanner) {
      const base = this.baseTransforms.get(scanner)!;
      const arrival = actorReveal("TestScannerAssembly");
      const scanPass = range(this.progress, 0.272, 0.35);
      const scannerReset = range(this.progress, 0.35, 0.382);
      const scanOffset = THREE.MathUtils.lerp(3.2, -2.65, scanPass) * (1 - scannerReset);
      scanner.position.copy(base.position);
      scanner.position.y += scanOffset;
      scanner.position.z += (1 - arrival) * 1.2;
      scanner.rotation.copy(base.rotation);
      scanner.scale.copy(base.scale).multiplyScalar(0.72 + arrival * 0.28);
    }
    const glassActor = actor("TestGlassAssembly") ?? testGate?.getObjectByName("TestGlass");
    if (glassActor) {
      const base = this.baseTransforms.get(glassActor)!;
      const reveal = actorReveal("TestGlassAssembly");
      const scanPulse = this.cameraEnvelope([0.272, 0.315, 0.35]);
      glassActor.position.copy(base.position);
      glassActor.scale.copy(base.scale).multiplyScalar(0.9 + reveal * 0.1);
      glassActor.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => {
          if (!/glass/i.test(material.name)) return;
          material.transparent = true;
          material.opacity = 0.1 + scanPulse * (this.quality === "ultra" ? 0.2 : 0.13);
          material.depthWrite = false;
        });
      });
    }

    // DEPLOY — the complete array advances from depth, then six independent
    // cells split to reveal the verified 4.30m architectural aisle.
    const deployGroup = this.namedGroups.get("DeployArray");
    if (deployGroup) {
      const base = this.baseTransforms.get(deployGroup)!;
      const approach = range(this.progress, 0.305, 0.382);
      deployGroup.position.set(base.position.x, base.position.y, base.position.z + THREE.MathUtils.lerp(14, 9, approach));
      deployGroup.rotation.copy(base.rotation);
      deployGroup.scale.copy(base.scale);

      for (let column = 0; column < 3; column += 1) {
        for (let row = 0; row < 2; row += 1) {
          const cell = deployGroup.getObjectByName(`DeployCell_${column}_${row}`);
          if (!cell) continue;
          const childBase = this.baseTransforms.get(cell)!;
          const order = column === 1 ? 0 : column === 2 ? 0.012 : 0.024;
          const open = range(this.progress, 0.372 + order + row * 0.008, 0.464 + order + row * 0.008);
          const side = column === 2 ? 1 : -1;
          cell.position.copy(childBase.position);
          cell.position.x = THREE.MathUtils.lerp(1.625 + side * 0.42, childBase.position.x, open);
          cell.position.y += (1 - open) * (row === 0 ? -1.25 : 1.55);
          cell.position.z += (1 - open) * 2.15;
          cell.rotation.y = childBase.rotation.y + (1 - open) * side * 0.3;
          cell.scale.copy(childBase.scale).multiplyScalar(0.68 + open * 0.32);
        }
      }
    }
    const deployActorSettings: Array<[SemanticActorName, THREE.Vector3, number, number]> = [
      ["DeployCrownAssembly", new THREE.Vector3(0, 3.4, 1.1), 0.12, 0.45],
      ["DeployBuses", new THREE.Vector3(0, -0.8, 0.8), 0, 0.18],
      ["DeployUplinks", new THREE.Vector3(0, 1.5, 1), 0.12, 0.3],
      ["DeployHeroSignAssembly", new THREE.Vector3(4.2, 0.8, 1.2), -0.22, 0.4],
    ];
    deployActorSettings.forEach(([name, offset, yaw, startScale]) => {
      const object = actor(name);
      if (!object) return;
      const base = this.baseTransforms.get(object)!;
      const reveal = actorReveal(name);
      object.position.copy(base.position).addScaledVector(offset, 1 - reveal);
      object.rotation.y = base.rotation.y + (1 - reveal) * yaw;
      object.scale.copy(base.scale).multiplyScalar(startScale + reveal * (1 - startScale));
      if (name === "DeployBuses") object.scale.x = base.scale.x * Math.max(0.06, reveal);
    });

    // PROTECT — a thin blade owns the full-frame cut at .622. The gate, tiles
    // and lock remain deeper on the right to create a readable black-world hero.
    const protectPlane = this.namedGroups.get("ProtectPlane");
    if (protectPlane) {
      const base = this.baseTransforms.get(protectPlane)!;
      protectPlane.position.set(base.position.x, base.position.y, base.position.z + 8.2);
      protectPlane.rotation.copy(base.rotation);
      protectPlane.scale.copy(base.scale);
    }
    const protectBlade = actor("ProtectBlade");
    if (protectBlade) {
      const base = this.baseTransforms.get(protectBlade)!;
      const reveal = actorReveal("ProtectBlade");
      const exit = actorExit("ProtectBlade");
      const impact = this.cameraEnvelope([0.606, 0.622, 0.655]);
      protectBlade.position.copy(base.position);
      protectBlade.position.x += (1 - reveal) * 16 + exit * 10;
      protectBlade.position.y += (1 - reveal) * 1.3;
      protectBlade.position.z += (1 - reveal) * 2.8 + exit * 10.5;
      protectBlade.rotation.z = base.rotation.z - (1 - reveal) * 0.28 + exit * 0.08;
      protectBlade.scale.copy(base.scale).multiplyScalar(0.78 + reveal * 0.22 + impact * 0.07);
    }
    const protectSettings: Array<[SemanticActorName, THREE.Vector3, number, number]> = [
      ["ProtectGateAssembly", new THREE.Vector3(7.2, 0.6, 3.2), -0.12, 0.82],
      ["ProtectTiles", new THREE.Vector3(3.2, -0.5, 1.7), 0.14, 0.72],
      ["ProtectLockAssembly", new THREE.Vector3(2.1, 0, 2.2), -0.32, 0.48],
    ];
    protectSettings.forEach(([name, offset, yaw, startScale]) => {
      const object = actor(name);
      if (!object) return;
      const base = this.baseTransforms.get(object)!;
      const reveal = actorReveal(name);
      const exit = actorExit(name);
      object.position.copy(base.position).addScaledVector(offset, 1 - reveal);
      object.position.x += exit * 5.5;
      object.position.z += exit * 5;
      object.rotation.y = base.rotation.y + (1 - reveal) * yaw;
      object.rotation.z = base.rotation.z + (name === "ProtectLockAssembly" ? (1 - reveal) * 0.42 : 0);
      object.scale.copy(base.scale).multiplyScalar(startScale + reveal * (1 - startScale));
    });

    // OPERATE — the canopy supplies pressure from above while the central
    // aperture stays clear. Network and nodes awaken from the periphery.
    const operate = range(this.progress, 0.655, 0.823);
    const topologyCollapse = range(this.progress, 0.855, 0.92);
    const topology = this.namedGroups.get("CloudTopology");
    if (topology) {
      const base = this.baseTransforms.get(topology)!;
      topology.position.set(base.position.x, base.position.y, base.position.z - topologyCollapse * 8.8);
      topology.scale.copy(base.scale).multiplyScalar((0.72 + operate * 0.28) * (1 - topologyCollapse * 0.82));
      topology.rotation.y = base.rotation.y + (1 - operate) * 0.32 + topologyCollapse * 0.46;
    }
    const operateSettings: Array<[SemanticActorName, THREE.Vector3, number, number]> = [
      ["OperateCanopy", new THREE.Vector3(0, 2.6, 2.1), 0.14, 0.72],
      ["OperateGimbal", new THREE.Vector3(0, 0, 2.8), -0.34, 0.62],
      ["OperateNetwork", new THREE.Vector3(0, -0.8, 2.4), 0.18, 0.32],
      ["OperateNodes", new THREE.Vector3(0, 0.9, 2.2), -0.16, 0.76],
    ];
    operateSettings.forEach(([name, offset, yaw, startScale]) => {
      const object = actor(name);
      if (!object) return;
      const base = this.baseTransforms.get(object)!;
      const reveal = actorReveal(name);
      object.position.copy(base.position).addScaledVector(offset, 1 - reveal);
      object.rotation.y = base.rotation.y + (1 - reveal) * yaw;
      object.scale.copy(base.scale).multiplyScalar(startScale + reveal * (1 - startScale));
      if (name === "OperateNodes") {
        const radialScale = 1.22 - reveal * 0.22;
        object.scale.x *= radialScale;
        object.scale.y *= radialScale;
      }
    });

    // FINALE — preserve screen-space X for conduits and pylons. They translate
    // in from depth instead of scaling through the centre of the title.
    const finale = range(this.progress, 0.835, 0.975);
    const finaleSettle = range(this.progress, 0.958, 0.995);
    this.particles.material.opacity = THREE.MathUtils.lerp(0.58, 0.24, finaleSettle);
    const core = this.namedGroups.get("FinaleCore");
    if (core) {
      const base = this.baseTransforms.get(core)!;
      core.position.set(base.position.x, base.position.y - 3.72, base.position.z - 0.4);
      core.scale.copy(base.scale).multiplyScalar(0.56 + finale * 0.44);
      core.rotation.y = base.rotation.y + (1 - finale) * Math.PI * 0.4;
    }
    const finaleScaleActors: Array<[SemanticActorName, number, number]> = [
      ["FinaleNucleus", 0.16, 0.5],
      ["FinaleEnergyRings", 0.38, -0.52],
      ["FinaleMechanicalRings", 0.44, 0.38],
      ["FinaleBrandAssembly", 0.28, -0.24],
      ["FinaleFragments", 0.3, 0.46],
    ];
    finaleScaleActors.forEach(([name, startScale, yaw]) => {
      const object = actor(name);
      if (!object) return;
      const base = this.baseTransforms.get(object)!;
      const reveal = actorReveal(name);
      object.position.copy(base.position);
      object.position.y += name === "FinaleBrandAssembly" ? 0.72 + (1 - reveal) * 1.25 : 0;
      object.position.z += (1 - reveal) * 1.8;
      object.rotation.y = base.rotation.y + (1 - reveal) * yaw;
      object.rotation.z = base.rotation.z + (1 - reveal) * (name === "FinaleFragments" ? 0.32 : 0.12);
      object.scale.copy(base.scale).multiplyScalar(startScale + reveal * (1 - startScale));
      if (name === "FinaleEnergyRings" || name === "FinaleMechanicalRings") {
        object.position.y -= finaleSettle * 3.2;
        object.scale.multiplyScalar(1 - finaleSettle * 0.92);
      }
      if (name === "FinaleFragments") {
        object.position.z -= finaleSettle * 3.6;
        object.scale.x *= 1 + finaleSettle * 0.48;
        object.scale.y *= 1 - finaleSettle * 0.24;
      }
    });
    const faceOnRing = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI * 0.5, 0, 0));
    [actor("FinaleEnergyRings"), actor("FinaleMechanicalRings")].forEach((ringGroup) => {
      ringGroup?.traverse((child) => {
        if (!/^FinaleRing_\d+$/.test(child.name)) return;
        const childBase = this.baseTransforms.get(child);
        if (!childBase) return;
        child.quaternion.setFromEuler(childBase.rotation).slerp(faceOnRing, finaleSettle);
      });
    });
    const finaleConduits = actor("FinaleConduits");
    if (finaleConduits) {
      const base = this.baseTransforms.get(finaleConduits)!;
      const reveal = actorReveal("FinaleConduits");
      finaleConduits.position.copy(base.position);
      finaleConduits.position.z += (1 - reveal) * 3.4;
      finaleConduits.position.y -= finaleSettle * 5.2;
      finaleConduits.rotation.copy(base.rotation);
      finaleConduits.scale.copy(base.scale);
      finaleConduits.scale.x *= 1.28 + reveal * 0.22 + finaleSettle * 0.55;
      finaleConduits.scale.y *= (0.18 + reveal * 0.82) * (1 - finaleSettle * 0.18);
      finaleConduits.scale.multiplyScalar(1 - finaleSettle * 0.88);
    }
    const finalePylons = actor("FinalePylons");
    if (finalePylons) {
      const base = this.baseTransforms.get(finalePylons)!;
      const reveal = actorReveal("FinalePylons");
      finalePylons.position.copy(base.position);
      finalePylons.position.z += (1 - reveal) * 2.8;
      finalePylons.rotation.copy(base.rotation);
      finalePylons.scale.copy(base.scale);
      finalePylons.scale.x *= 1.18 - reveal * 0.18 + finaleSettle * 0.26;
    }
  }

  private restoreNamedGroups(): void {
    this.namedGroups.forEach((object) => {
      const base = this.baseTransforms.get(object);
      if (!base) return;
      object.position.copy(base.position);
      object.rotation.copy(base.rotation);
      object.scale.copy(base.scale);
    });
  }

  private updateChapterVisibility(): void {
    const windows: Record<string, [number, number]> = {
      SignalRail: [0, 1],
      BuildAssembly: [0.052, 0.29],
      TestGate: [0.175, 0.465],
      DeployArray: [0.325, 0.635],
      ProtectPlane: [0.505, 0.715],
      CloudTopology: [0.655, 0.935],
      FinaleCore: [0.835, 1],
    };

    this.namedGroups.forEach((object, name) => {
      const actorCue = ACTOR_CUE_BY_ID.get(name as SemanticActorName);
      const [start, end] = actorCue?.visible ?? windows[name] ?? [0, 1];
      object.visible = this.progress >= start && this.progress <= end;
    });
  }

  private readonly render = (): void => {
    if (!this.running) return;
    this.animationFrame = requestAnimationFrame(this.render);
    if (this.hidden) return;

    this.timer.update();
    const delta = Math.min(this.timer.getDelta(), 0.08);
    const elapsed = this.timer.getElapsed();
    this.cinematicFinish.uniforms.uTime.value = elapsed;
    this.pointerCurrent.lerp(this.pointerTarget, 1 - Math.pow(0.002, delta));
    this.touchRollVelocity *= Math.pow(0.018, delta);
    this.updateCamera();
    this.projectOrbit.update(delta, elapsed);

    const signalProgress = (0.18 + elapsed * 0.045 + this.progress * 1.55) % 1;
    this.signalCurve.getPointAt(signalProgress, this.signalOrb.position);
    this.signalLight.position.copy(this.signalOrb.position);
    const signalPulse = 0.84 + Math.sin(elapsed * 4.8) * 0.16;
    this.signalOrb.scale.setScalar(signalPulse);
    this.signalLight.intensity = 0.55 + signalPulse * 0.7;

    this.particles.rotation.z = elapsed * 0.008;
    this.particles.position.x = Math.sin(elapsed * 0.16) * 0.08;

    const operateGimbal = this.namedGroups.get("OperateGimbal");
    if (operateGimbal?.visible && this.lastChapterProgress > 0.68) {
      const base = this.baseTransforms.get(operateGimbal)!;
      const reveal = range(this.lastChapterProgress, 0.695, 0.77);
      const breath = 1 + Math.sin(elapsed * 1.35) * 0.012;
      operateGimbal.scale.copy(base.scale).multiplyScalar((0.62 + reveal * 0.38) * breath);
      operateGimbal.rotation.z = base.rotation.z + Math.sin(elapsed * 0.72) * 0.018;
    }

    const energyRings = this.namedGroups.get("FinaleEnergyRings");
    if (energyRings?.visible && this.lastChapterProgress > 0.845) {
      const base = this.baseTransforms.get(energyRings)!;
      const reveal = range(this.lastChapterProgress, 0.852, 0.915);
      energyRings.rotation.z = base.rotation.z + (1 - reveal) * 0.12 + elapsed * 0.1 * reveal;
    }
    const mechanicalRings = this.namedGroups.get("FinaleMechanicalRings");
    if (mechanicalRings?.visible && this.lastChapterProgress > 0.865) {
      const base = this.baseTransforms.get(mechanicalRings)!;
      const reveal = range(this.lastChapterProgress, 0.878, 0.928);
      mechanicalRings.rotation.z = base.rotation.z - elapsed * 0.065 * reveal;
    }

    this.monitorPerformance(delta);
    this.composer.render();
  };

  private monitorPerformance(delta: number): void {
    if (this.orbitPrewarming) return;
    const snapshot = this.performanceGovernor.sample(delta);
    this.renderer.domElement.dataset.performanceState = snapshot.state;
    if (this.experienceElement) this.experienceElement.dataset.performanceState = snapshot.state;
    if (snapshot.fps !== null) {
      const fps = snapshot.fps.toFixed(1);
      this.renderer.domElement.dataset.fps = fps;
      if (this.experienceElement) this.experienceElement.dataset.fps = fps;
    }
    this.renderer.domElement.dataset.calls = String(this.renderer.info.render.calls);
    this.renderer.domElement.dataset.triangles = String(this.renderer.info.render.triangles);
    if (!snapshot.levelChanged) return;
    this.performanceLevel = snapshot.level;
    this.applyPerformanceLevel();
  }

  private applyPerformanceLevel(): void {
    const profile = getPerformanceQualityProfile(this.performanceLevel);
    this.speedEffectScale = profile.speedEffectScale;
    const particleCount = this.particles.geometry.getAttribute("position").count;
    const particleBudget = this.compactViewport ? Math.min(1100, particleCount) : particleCount;
    this.particles.geometry.setDrawRange(
      0,
      Math.max(1, Math.floor(particleBudget * profile.particleScale)),
    );
    this.renderer.shadowMap.enabled = !this.compactViewport && this.quality === "ultra" && profile.realtimeShadows;
    this.cinematicFinish.uniforms.uGrainAmount.value = this.performanceLevel >= 5
      ? 0.003
      : this.compactViewport
        ? 0.004
        : 0.006;
    this.renderer.domElement.dataset.performanceLevel = String(this.performanceLevel);
    if (this.experienceElement) this.experienceElement.dataset.performanceLevel = String(this.performanceLevel);
    this.applyResize(true);
    // Project Orbit has a separate black/cold-grey photometric grade.  The
    // performance governor may reduce DPR, bloom, particles and shadows, but
    // it must not restore the corridor's post-Protect exposure/environment
    // while the star system is active.
    if (!this.projectOrbit.isActive()) this.updateEnvironment();
  }

  private readonly scheduleResize = (): void => {
    if (this.resizeFrame) return;
    this.resizeFrame = requestAnimationFrame(() => {
      this.resizeFrame = 0;
      this.applyResize();
    });
  };

  private applyResize(force = false): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.compactViewport = width <= 820;
    this.renderer.domElement.dataset.quality = this.getQuality();
    if (this.experienceElement) this.experienceElement.dataset.quality = this.getQuality();
    const profile = getPerformanceQualityProfile(this.performanceLevel);
    this.renderer.shadowMap.enabled = !this.compactViewport && this.quality === "ultra" && profile.realtimeShadows;
    this.bloom.enabled = true;
    const particleCount = this.particles.geometry.getAttribute("position").count;
    const particleBudget = this.compactViewport ? Math.min(1100, particleCount) : particleCount;
    this.particles.geometry.setDrawRange(0, Math.max(1, Math.floor(particleBudget * profile.particleScale)));
    const pixelRatio = profile.maximumPixelRatio === null
      ? this.targetPixelRatio()
      : Math.min(profile.maximumPixelRatio, window.devicePixelRatio);
    if (!force && width === this.lastWidth && height === this.lastHeight && pixelRatio === this.lastPixelRatio) return;

    this.lastWidth = width;
    this.lastHeight = height;
    this.lastPixelRatio = pixelRatio;
    this.camera.aspect = width / height;
    this.camera.fov = width <= 820 ? BASE_FOV.mobile : BASE_FOV.desktop;
    this.camera.updateProjectionMatrix();
    this.setRendererPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
    const bloomScale = profile.bloomResolutionScale;
    this.bloom.setSize(
      Math.max(1, Math.floor(width * pixelRatio * bloomScale)),
      Math.max(1, Math.floor(height * pixelRatio * bloomScale)),
    );
    this.cinematicFinish.uniforms.uResolution.value.set(width * pixelRatio, height * pixelRatio);
    if (this.performanceLevel < 5) {
      this.cinematicFinish.uniforms.uGrainAmount.value = this.compactViewport ? 0.004 : 0.006;
    }
  }

  private targetPixelRatio(): number {
    if (this.compactViewport) return Math.min(1, window.devicePixelRatio);
    if (this.quality === "ultra") return Math.min(1.75, window.devicePixelRatio);
    if (this.quality === "balanced") return Math.min(1.25, window.devicePixelRatio);
    return Math.min(1, window.devicePixelRatio);
  }

  private setRendererPixelRatio(pixelRatio: number): void {
    this.renderer.setPixelRatio(pixelRatio);
    this.composer.setPixelRatio(pixelRatio);
  }

  private readonly handleVisibility = (): void => {
    this.hidden = document.hidden;
    if (!this.hidden) this.timer.reset();
  };

  private setCinematicVisibility(visible: boolean): void {
    if (this.sceneRoot) this.sceneRoot.visible = visible;
    this.spatialTitles.forEach(({ title }) => {
      title.mesh.visible = visible;
    });
    this.particles.visible = visible;
    this.signalOrb.visible = visible;
    this.signalLight.visible = visible;
    this.scene.children.forEach((child) => {
      if (child.name.startsWith("SignalTrail_")) child.visible = visible;
    });
    if (visible) this.updateChapterVisibility();
  }
}
