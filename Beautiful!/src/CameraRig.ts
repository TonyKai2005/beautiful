import * as THREE from "three";
import type { ChapterId } from "./content";

export type CameraViewport = "desktop" | "mobile";
export type CameraPointTuple = readonly [x: number, y: number, z: number];
export type CameraRange = readonly [start: number, peak: number, end: number];

export interface CameraFovTarget {
  readonly desktop: number;
  readonly mobile: number;
}

export interface CameraLookVerticalOffsetTarget {
  readonly desktop: number;
  readonly mobile: number;
}

export interface CameraEffectWindow {
  readonly id: "test-pass" | "protect-cut" | "finale-sprint";
  readonly progress: CameraRange;
  readonly speedBlur: boolean;
  readonly speedLines: boolean;
  readonly shakeMeters: number;
}

export interface CameraBeat {
  readonly id: ChapterId;
  readonly scrollRange: readonly [start: number, end: number];
  readonly cameraRange: readonly [start: number, end: number];
  readonly heroProgress: number;
  readonly fovTarget: CameraFovTarget;
  readonly fovWindow: CameraRange;
  readonly shakeMeters: number;
  readonly effectWindowId?: CameraEffectWindow["id"];
}

export interface CameraCollisionHit {
  readonly progress: number;
  readonly objectName: string;
  readonly measuredClearanceMeters: number;
  readonly requiredClearanceMeters: number;
  readonly resolution: "move-model" | "camera-offset" | "unresolved";
  readonly appliedOffset?: CameraPointTuple;
}

export interface CameraCollisionReport {
  readonly viewport: CameraViewport;
  readonly sampleCount: number;
  readonly sweepRadiusMeters: number;
  readonly minimumMeasuredClearanceMeters: number;
  readonly requiredClearanceMeters: number;
  readonly status: "clear" | "resolved-by-model-move" | "camera-offset-required" | "unresolved";
  readonly hits: readonly CameraCollisionHit[];
}

export interface CameraRigSpec {
  readonly tension: number;
  readonly lookAhead: number;
  readonly lookVerticalOffset: CameraLookVerticalOffsetTarget;
  readonly scrubSeconds: number;
  readonly paths: Readonly<Record<CameraViewport, readonly CameraPointTuple[]>>;
  readonly baseFov: CameraFovTarget;
  readonly chapterScrollBoundaries: readonly number[];
  readonly cameraStops: readonly number[];
  readonly localDistanceTable: readonly number[];
  readonly localScrollTimeTable: readonly number[];
  readonly beats: readonly CameraBeat[];
  readonly effectWindows: readonly CameraEffectWindow[];
  readonly roll: Readonly<{
    curvatureMaxDegrees: number;
    pointerMaxDegrees: number;
    touchVelocityMaxDegrees: number;
  }>;
  readonly collision: Readonly<{
    sweepRadiusMeters: number;
    visibleClearanceMeters: number;
    maxLocalCameraAvoidanceMeters: number;
    testOpeningWidthMeters: number;
    deployAxisWidthMeters: number;
    operateRingClearanceMeters: number;
    finaleClearFrameFraction: number;
  }>;
}

export const DESKTOP_CAMERA_PATH = [
  [0, 3.1, 30],
  [-1.8, 2.52, 18],
  [1.2, 2.28, 7],
  [-0.8, 2.82, -6],
  [2.6, 2.62, -19],
  [-1.6, 3.02, -33],
  [0.2, 3.22, -47],
  [0, 2.45, -60],
] as const satisfies readonly CameraPointTuple[];

export const MOBILE_CAMERA_PATH = [
  [0, 4.1, 30],
  [-0.65, 3.55, 18],
  [0.35, 3.3, 7],
  [-0.35, 3.9, -6],
  [0.75, 3.7, -19],
  [-0.65, 3.55, -33],
  [0.1, 3.22, -47],
  [0, 3.2, -60],
] as const satisfies readonly CameraPointTuple[];

export const CAMERA_PATH_TENSION = 0.42;
export const CAMERA_LOOK_AHEAD = 0.027;
export const CAMERA_LOOK_VERTICAL_OFFSETS = {
  desktop: -0.1,
  mobile: -0.14,
} as const satisfies CameraLookVerticalOffsetTarget;
/** @deprecated Select from CAMERA_LOOK_VERTICAL_OFFSETS using the active viewport. */
export const CAMERA_LOOK_VERTICAL_OFFSET = CAMERA_LOOK_VERTICAL_OFFSETS.desktop;
export const CAMERA_SCRUB_SECONDS = 0.22;

export const CHAPTER_SCROLL_BOUNDARIES = [0, 0.07, 0.24, 0.39, 0.58, 0.73, 0.88, 1] as const;
export const CAMERA_STOPS = [0, 0.07, 0.235, 0.38, 0.57, 0.72, 0.875, 1] as const;
export const LOCAL_DISTANCE_TABLE = [0, 0.3, 0.42, 0.58, 0.72, 1] as const;
export const LOCAL_SCROLL_TIME_TABLE = [0, 0.22, 0.42, 0.66, 0.82, 1] as const;

export const HERO_JUMP_TARGETS = {
  boot: 0.025,
  build: 0.155,
  test: 0.315,
  deploy: 0.49,
  protect: 0.655,
  operate: 0.81,
  finale: 0.945,
} as const satisfies Readonly<Record<ChapterId, number>>;

export const BASE_FOV = { desktop: 42, mobile: 55 } as const satisfies CameraFovTarget;

export const CAMERA_EFFECT_WINDOWS = [
  {
    id: "test-pass",
    progress: [0.287, 0.315, 0.345],
    speedBlur: true,
    speedLines: true,
    shakeMeters: 0.08,
  },
  {
    id: "protect-cut",
    progress: [0.606, 0.622, 0.655],
    speedBlur: true,
    speedLines: true,
    shakeMeters: 0.08,
  },
  {
    id: "finale-sprint",
    progress: [0.905, 0.945, 0.972],
    speedBlur: true,
    speedLines: true,
    shakeMeters: 0.08,
  },
] as const satisfies readonly CameraEffectWindow[];

export const CAMERA_BEATS = [
  {
    id: "boot",
    scrollRange: [0, 0.07],
    cameraRange: [0, 0.07],
    heroProgress: HERO_JUMP_TARGETS.boot,
    fovTarget: BASE_FOV,
    fovWindow: [0, 0.025, 0.065],
    shakeMeters: 0,
  },
  {
    id: "build",
    scrollRange: [0.07, 0.24],
    cameraRange: [0.07, 0.235],
    heroProgress: HERO_JUMP_TARGETS.build,
    fovTarget: BASE_FOV,
    fovWindow: [0.07, 0.155, 0.235],
    shakeMeters: 0,
  },
  {
    id: "test",
    scrollRange: [0.24, 0.39],
    cameraRange: [0.235, 0.38],
    heroProgress: HERO_JUMP_TARGETS.test,
    fovTarget: { desktop: 58, mobile: 71 },
    fovWindow: [0.255, 0.315, 0.375],
    shakeMeters: 0.08,
    effectWindowId: "test-pass",
  },
  {
    id: "deploy",
    scrollRange: [0.39, 0.58],
    cameraRange: [0.38, 0.57],
    heroProgress: HERO_JUMP_TARGETS.deploy,
    fovTarget: BASE_FOV,
    fovWindow: [0.39, 0.49, 0.575],
    shakeMeters: 0,
  },
  {
    id: "protect",
    scrollRange: [0.58, 0.73],
    cameraRange: [0.57, 0.72],
    heroProgress: HERO_JUMP_TARGETS.protect,
    fovTarget: { desktop: 66, mobile: 79 },
    fovWindow: [0.595, 0.622, 0.655],
    shakeMeters: 0.08,
    effectWindowId: "protect-cut",
  },
  {
    id: "operate",
    scrollRange: [0.73, 0.88],
    cameraRange: [0.72, 0.875],
    heroProgress: HERO_JUMP_TARGETS.operate,
    fovTarget: { desktop: 60, mobile: 73 },
    fovWindow: [0.73, 0.755, 0.82],
    shakeMeters: 0,
  },
  {
    id: "finale",
    scrollRange: [0.88, 1],
    cameraRange: [0.875, 1],
    heroProgress: HERO_JUMP_TARGETS.finale,
    fovTarget: { desktop: 70, mobile: 83 },
    fovWindow: [0.89, 0.945, 1],
    shakeMeters: 0.08,
    effectWindowId: "finale-sprint",
  },
] as const satisfies readonly CameraBeat[];

export const CAMERA_COLLISION_CLEARANCES = {
  sweepRadiusMeters: 0.42,
  visibleClearanceMeters: 0.55,
  maxLocalCameraAvoidanceMeters: 0.35,
  testOpeningWidthMeters: 2.4,
  deployAxisWidthMeters: 4.2,
  operateRingClearanceMeters: 3,
  finaleClearFrameFraction: 0.28,
} as const;

export const CAMERA_RIG_SPEC: CameraRigSpec = {
  tension: CAMERA_PATH_TENSION,
  lookAhead: CAMERA_LOOK_AHEAD,
  lookVerticalOffset: CAMERA_LOOK_VERTICAL_OFFSETS,
  scrubSeconds: CAMERA_SCRUB_SECONDS,
  paths: { desktop: DESKTOP_CAMERA_PATH, mobile: MOBILE_CAMERA_PATH },
  baseFov: BASE_FOV,
  chapterScrollBoundaries: CHAPTER_SCROLL_BOUNDARIES,
  cameraStops: CAMERA_STOPS,
  localDistanceTable: LOCAL_DISTANCE_TABLE,
  localScrollTimeTable: LOCAL_SCROLL_TIME_TABLE,
  beats: CAMERA_BEATS,
  effectWindows: CAMERA_EFFECT_WINDOWS,
  roll: {
    curvatureMaxDegrees: 3.5,
    pointerMaxDegrees: 1.4,
    touchVelocityMaxDegrees: 1.4,
  },
  collision: CAMERA_COLLISION_CLEARANCES,
};

export function createCameraPathPoints(viewport: CameraViewport): THREE.Vector3[] {
  return CAMERA_RIG_SPEC.paths[viewport].map(([x, y, z]) => new THREE.Vector3(x, y, z));
}

export function getCameraLookVerticalOffset(viewport: CameraViewport): number {
  return CAMERA_LOOK_VERTICAL_OFFSETS[viewport];
}

export function createCameraCurve(viewport: CameraViewport): THREE.CatmullRomCurve3 {
  return new THREE.CatmullRomCurve3(
    createCameraPathPoints(viewport),
    false,
    "catmullrom",
    CAMERA_PATH_TENSION,
  );
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function findPiece(value: number, domain: readonly number[]): number {
  for (let index = 0; index < domain.length - 1; index += 1) {
    if (value <= domain[index + 1]) return index;
  }
  return domain.length - 2;
}

function mapPiecewise(value: number, domain: readonly number[], range: readonly number[]): number {
  if (domain.length !== range.length || domain.length < 2) {
    throw new Error("Piecewise camera tables must have equal lengths of at least two values.");
  }

  const bounded = Math.min(domain[domain.length - 1], Math.max(domain[0], value));
  const index = findPiece(bounded, domain);
  const domainSpan = domain[index + 1] - domain[index];
  const local = domainSpan === 0 ? 0 : (bounded - domain[index]) / domainSpan;
  return range[index] + (range[index + 1] - range[index]) * local;
}

/** Maps chapter-local scroll time to chapter-local travelled distance. */
export function mapLocalScrollToDistance(localScrollProgress: number): number {
  return mapPiecewise(
    clamp01(localScrollProgress),
    LOCAL_SCROLL_TIME_TABLE,
    LOCAL_DISTANCE_TABLE,
  );
}

/** Exact monotonic inverse of mapLocalScrollToDistance for values in [0, 1]. */
export function mapLocalDistanceToScroll(localDistanceProgress: number): number {
  return mapPiecewise(
    clamp01(localDistanceProgress),
    LOCAL_DISTANCE_TABLE,
    LOCAL_SCROLL_TIME_TABLE,
  );
}

/** Converts global document progress into arc-length camera progress. */
export function mapGlobalScrollToCameraT(globalScrollProgress: number): number {
  const scroll = clamp01(globalScrollProgress);
  const chapterIndex = findPiece(scroll, CHAPTER_SCROLL_BOUNDARIES);
  const scrollStart = CHAPTER_SCROLL_BOUNDARIES[chapterIndex];
  const scrollEnd = CHAPTER_SCROLL_BOUNDARIES[chapterIndex + 1];
  const localScroll = (scroll - scrollStart) / (scrollEnd - scrollStart);
  const localDistance = mapLocalScrollToDistance(localScroll);
  const cameraStart = CAMERA_STOPS[chapterIndex];
  const cameraEnd = CAMERA_STOPS[chapterIndex + 1];
  return cameraStart + (cameraEnd - cameraStart) * localDistance;
}

/** Exact monotonic inverse of mapGlobalScrollToCameraT for values in [0, 1]. */
export function mapCameraTToGlobalScroll(cameraT: number): number {
  const boundedCameraT = clamp01(cameraT);
  const chapterIndex = findPiece(boundedCameraT, CAMERA_STOPS);
  const cameraStart = CAMERA_STOPS[chapterIndex];
  const cameraEnd = CAMERA_STOPS[chapterIndex + 1];
  const localDistance = (boundedCameraT - cameraStart) / (cameraEnd - cameraStart);
  const localScroll = mapLocalDistanceToScroll(localDistance);
  const scrollStart = CHAPTER_SCROLL_BOUNDARIES[chapterIndex];
  const scrollEnd = CHAPTER_SCROLL_BOUNDARIES[chapterIndex + 1];
  return scrollStart + (scrollEnd - scrollStart) * localScroll;
}
