import type { ChapterId } from "./content";

export type SemanticActorName =
  | "BuildSourceField"
  | "BuildShell"
  | "BuildMechanics"
  | "BuildCore"
  | "BuildEnergy"
  | "TestPillars"
  | "TestHeaderAssembly"
  | "TestThresholdAssembly"
  | "TestScannerAssembly"
  | "TestGlassAssembly"
  | "DeployCells"
  | "DeployCrownAssembly"
  | "DeployBuses"
  | "DeployUplinks"
  | "DeployHeroSignAssembly"
  | "ProtectBlade"
  | "ProtectGateAssembly"
  | "ProtectTiles"
  | "ProtectLockAssembly"
  | "OperateCanopy"
  | "OperateGimbal"
  | "OperateNetwork"
  | "OperateNodes"
  | "FinaleNucleus"
  | "FinaleEnergyRings"
  | "FinaleMechanicalRings"
  | "FinaleBrandAssembly"
  | "FinaleConduits"
  | "FinalePylons"
  | "FinaleFragments";

export interface ActorCue {
  readonly id: SemanticActorName;
  readonly chapter: ChapterId;
  readonly visible: readonly [start: number, end: number];
  readonly enter: readonly [start: number, end: number];
  readonly exit?: readonly [start: number, end: number];
  readonly pressureRole: "left-wall" | "right-wall" | "ceiling" | "threshold" | "centre-core" | "periphery";
}

export interface ProjectionSafeArea {
  readonly centralCorridorFraction: number;
  readonly maximumSideIntrusionFraction: number;
  readonly maximumCeilingIntrusionFraction: number;
  readonly maximumImpactTitleOcclusionFraction: number;
  readonly maximumHeroTitleOcclusionFraction: number;
  readonly protectFullFrameException: readonly [start: number, end: number];
}

export const PROJECTION_SAFE_AREA: ProjectionSafeArea = {
  centralCorridorFraction: 0.44,
  maximumSideIntrusionFraction: 0.28,
  maximumCeilingIntrusionFraction: 0.22,
  maximumImpactTitleOcclusionFraction: 0.15,
  maximumHeroTitleOcclusionFraction: 0,
  protectFullFrameException: [0.606, 0.628],
};

export const ACTOR_CUES: readonly ActorCue[] = [
  { id: "BuildSourceField", chapter: "build", visible: [0.052, 0.255], enter: [0.052, 0.095], exit: [0.232, 0.255], pressureRole: "left-wall" },
  { id: "BuildShell", chapter: "build", visible: [0.062, 0.285], enter: [0.068, 0.145], exit: [0.235, 0.285], pressureRole: "right-wall" },
  { id: "BuildMechanics", chapter: "build", visible: [0.072, 0.285], enter: [0.082, 0.159], exit: [0.235, 0.285], pressureRole: "right-wall" },
  { id: "BuildCore", chapter: "build", visible: [0.09, 0.285], enter: [0.1, 0.177], exit: [0.235, 0.285], pressureRole: "right-wall" },
  { id: "BuildEnergy", chapter: "build", visible: [0.11, 0.285], enter: [0.12, 0.19], exit: [0.235, 0.285], pressureRole: "right-wall" },
  { id: "TestPillars", chapter: "test", visible: [0.175, 0.42], enter: [0.18, 0.255], exit: [0.385, 0.42], pressureRole: "threshold" },
  { id: "TestHeaderAssembly", chapter: "test", visible: [0.195, 0.42], enter: [0.21, 0.275], exit: [0.385, 0.42], pressureRole: "ceiling" },
  { id: "TestThresholdAssembly", chapter: "test", visible: [0.18, 0.42], enter: [0.19, 0.245], exit: [0.385, 0.42], pressureRole: "threshold" },
  { id: "TestScannerAssembly", chapter: "test", visible: [0.215, 0.402], enter: [0.225, 0.27], exit: [0.382, 0.402], pressureRole: "threshold" },
  { id: "TestGlassAssembly", chapter: "test", visible: [0.235, 0.39], enter: [0.255, 0.305], exit: [0.37, 0.39], pressureRole: "threshold" },
  { id: "DeployCells", chapter: "deploy", visible: [0.305, 0.625], enter: [0.372, 0.464], exit: [0.58, 0.625], pressureRole: "periphery" },
  { id: "DeployCrownAssembly", chapter: "deploy", visible: [0.39, 0.625], enter: [0.425, 0.485], exit: [0.58, 0.625], pressureRole: "ceiling" },
  { id: "DeployBuses", chapter: "deploy", visible: [0.42, 0.625], enter: [0.46, 0.525], exit: [0.58, 0.625], pressureRole: "threshold" },
  { id: "DeployUplinks", chapter: "deploy", visible: [0.42, 0.625], enter: [0.445, 0.515], exit: [0.58, 0.625], pressureRole: "periphery" },
  { id: "DeployHeroSignAssembly", chapter: "deploy", visible: [0.45, 0.625], enter: [0.49, 0.54], exit: [0.58, 0.625], pressureRole: "right-wall" },
  { id: "ProtectBlade", chapter: "protect", visible: [0.505, 0.665], enter: [0.535, 0.612], exit: [0.618, 0.655], pressureRole: "right-wall" },
  { id: "ProtectGateAssembly", chapter: "protect", visible: [0.525, 0.715], enter: [0.54, 0.62], exit: [0.68, 0.715], pressureRole: "right-wall" },
  { id: "ProtectTiles", chapter: "protect", visible: [0.54, 0.715], enter: [0.552, 0.63], exit: [0.68, 0.715], pressureRole: "right-wall" },
  { id: "ProtectLockAssembly", chapter: "protect", visible: [0.55, 0.715], enter: [0.568, 0.638], exit: [0.68, 0.715], pressureRole: "right-wall" },
  { id: "OperateCanopy", chapter: "operate", visible: [0.655, 0.935], enter: [0.68, 0.755], exit: [0.855, 0.92], pressureRole: "ceiling" },
  { id: "OperateGimbal", chapter: "operate", visible: [0.675, 0.935], enter: [0.695, 0.77], exit: [0.855, 0.92], pressureRole: "centre-core" },
  { id: "OperateNetwork", chapter: "operate", visible: [0.69, 0.935], enter: [0.714, 0.805], exit: [0.855, 0.92], pressureRole: "periphery" },
  { id: "OperateNodes", chapter: "operate", visible: [0.72, 0.935], enter: [0.748, 0.823], exit: [0.855, 0.92], pressureRole: "periphery" },
  { id: "FinaleNucleus", chapter: "finale", visible: [0.835, 1], enter: [0.84, 0.885], pressureRole: "centre-core" },
  { id: "FinaleEnergyRings", chapter: "finale", visible: [0.845, 1], enter: [0.852, 0.915], pressureRole: "centre-core" },
  { id: "FinaleMechanicalRings", chapter: "finale", visible: [0.865, 1], enter: [0.878, 0.928], pressureRole: "centre-core" },
  { id: "FinaleBrandAssembly", chapter: "finale", visible: [0.88, 1], enter: [0.892, 0.938], pressureRole: "centre-core" },
  { id: "FinaleConduits", chapter: "finale", visible: [0.89, 1], enter: [0.905, 0.955], pressureRole: "periphery" },
  { id: "FinalePylons", chapter: "finale", visible: [0.89, 1], enter: [0.905, 0.95], pressureRole: "left-wall" },
  { id: "FinaleFragments", chapter: "finale", visible: [0.87, 1], enter: [0.885, 0.94], pressureRole: "periphery" },
] as const;

export const ACTOR_CUE_BY_ID = new Map(ACTOR_CUES.map((cue) => [cue.id, cue]));
