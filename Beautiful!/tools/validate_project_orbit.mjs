#!/usr/bin/env node

/** Validate the generated PROJECT ORBIT Blender/web delivery. */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const orbitDir = path.join(root, "public/assets/orbit");
const manifestPath = path.join(orbitDir, "orbit-manifest.json");
const reportPath = path.join(orbitDir, "validation-report.json");
const balancedReportPath = path.join(orbitDir, "balanced-lod-report.json");
const expectedIds = ["transform", "build", "experience", "test", "deploy", "protect", "operate"];

const errors = [];
const warnings = [];
const checks = [];
const requireCheck = (condition, message, detail = undefined) => {
  checks.push({ pass: Boolean(condition), message, ...(detail === undefined ? {} : { detail }) });
  if (!condition) errors.push(message);
};

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function resolveAssetUrl(url) {
  requireCheck(typeof url === "string" && url.startsWith("/assets/orbit/"), `invalid orbit asset URL: ${url}`);
  return path.join(root, "public", String(url).replace(/^\//, ""));
}

function validateDescriptor(descriptor, label) {
  const filePath = resolveAssetUrl(descriptor?.url);
  requireCheck(fs.existsSync(filePath), `${label} is missing: ${filePath}`);
  if (!fs.existsSync(filePath)) return filePath;
  const stat = fs.statSync(filePath);
  requireCheck(stat.size === descriptor.bytes, `${label} byte count does not match manifest`, { actual: stat.size, manifest: descriptor.bytes });
  requireCheck(sha256(filePath) === descriptor.sha256, `${label} SHA-256 does not match manifest`);
  return filePath;
}

function parseGlb(filePath) {
  const buffer = fs.readFileSync(filePath);
  requireCheck(buffer.toString("ascii", 0, 4) === "glTF", `${path.basename(filePath)} has an invalid GLB magic header`);
  requireCheck(buffer.readUInt32LE(4) === 2, `${path.basename(filePath)} is not glTF 2.0`);
  requireCheck(buffer.readUInt32LE(8) === buffer.length, `${path.basename(filePath)} GLB length header is invalid`);
  let offset = 12;
  let json;
  let binary;
  while (offset < buffer.length) {
    const length = buffer.readUInt32LE(offset);
    const type = buffer.readUInt32LE(offset + 4);
    const payload = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) json = JSON.parse(payload.toString("utf8").replace(/\0+$/, ""));
    if (type === 0x004e4942) binary = payload;
    offset += 8 + length;
  }
  requireCheck(Boolean(json), `${path.basename(filePath)} has no JSON chunk`);
  requireCheck(Boolean(binary), `${path.basename(filePath)} has no binary chunk`);
  return { filePath, json, binary };
}

function inspectGlb(filePath) {
  const asset = parseGlb(filePath);
  const json = asset.json;
  const nodes = json.nodes ?? [];
  const accessors = json.accessors ?? [];
  const materials = json.materials ?? [];
  const images = json.images ?? [];
  const textures = json.textures ?? [];
  const nodeByName = new Map(nodes.map((node, index) => [node.name, { node, index }]));
  const parents = Array(nodes.length).fill(-1);
  nodes.forEach((node, parentIndex) => {
    for (const child of node.children ?? []) parents[child] = parentIndex;
  });
  const triangleCount = (json.meshes ?? []).reduce(
    (sum, mesh) => sum + (mesh.primitives ?? []).reduce((meshSum, primitive) => {
      const accessorIndex = primitive.indices ?? primitive.attributes?.POSITION;
      const count = accessors[accessorIndex]?.count ?? 0;
      const mode = primitive.mode ?? 4;
      return meshSum + (mode === 4 ? count / 3 : 0);
    }, 0),
    0,
  );
  const durations = (json.animations ?? []).map((animation) => {
    let end = 0;
    for (const sampler of animation.samplers ?? []) {
      const accessor = accessors[sampler.input];
      end = Math.max(end, accessor?.max?.[0] ?? 0);
    }
    return { name: animation.name ?? "unnamed", seconds: end };
  });
  const animationTargets = new Set();
  for (const animation of json.animations ?? []) {
    for (const channel of animation.channels ?? []) {
      const nodeName = nodes[channel.target?.node]?.name;
      if (nodeName) animationTargets.add(nodeName);
    }
  }
  const sceneRoots = (json.scenes?.[json.scene ?? 0]?.nodes ?? []).map((index) => nodes[index]?.name);
  return {
    ...asset,
    nodes,
    nodeByName,
    parents,
    triangleCount,
    meshCount: (json.meshes ?? []).length,
    materials,
    materialNames: materials.map((value) => value.name ?? ""),
    images,
    textures,
    normalMaterialCount: materials.filter((value) => Number.isInteger(value.normalTexture?.index)).length,
    metallicRoughnessMaterialCount: materials.filter((value) => Number.isInteger(value.pbrMetallicRoughness?.metallicRoughnessTexture?.index)).length,
    occlusionMaterialCount: materials.filter((value) => Number.isInteger(value.occlusionTexture?.index)).length,
    durations,
    animationTargets,
    sceneRoots,
  };
}

function hasName(inspector, pattern) {
  return [...inspector.nodeByName.keys()].some((name) => pattern.test(name));
}

function validateAnimationContract(inspector, label) {
  requireCheck(inspector.durations.length >= 1, `${label} has no authored animation`);
  const signature = inspector.durations.filter((animation) => animation.name.startsWith("SIGNATURE_"));
  requireCheck(signature.length >= 1, `${label} has no SIGNATURE_* animation`);
  for (const animation of signature) {
    requireCheck(animation.seconds >= 6.8 && animation.seconds <= 7.1, `${label} animation ${animation.name} is not seven seconds`, animation);
  }
}

function validateAssetPair(entry, kind) {
  const expectedRoot = entry.root;
  const ultraPath = validateDescriptor(entry.ultra, `${kind} ${entry.id} Ultra`);
  const balancedPath = validateDescriptor(entry.balanced, `${kind} ${entry.id} Balanced`);
  if (!fs.existsSync(ultraPath) || !fs.existsSync(balancedPath)) return undefined;
  const ultra = inspectGlb(ultraPath);
  const balanced = inspectGlb(balancedPath);
  requireCheck(ultra.sceneRoots.length === 1 && ultra.sceneRoots[0] === expectedRoot, `${entry.id} Ultra scene root must be ${expectedRoot}`, ultra.sceneRoots);
  requireCheck(balanced.sceneRoots.length === 1 && balanced.sceneRoots[0] === expectedRoot, `${entry.id} Balanced scene root must be ${expectedRoot}`, balanced.sceneRoots);
  for (const [inspector, lod] of [[ultra, 0], [balanced, 1]]) {
    const rootNode = inspector.nodeByName.get(expectedRoot)?.node;
    requireCheck(Boolean(rootNode), `${entry.id} ${lod === 0 ? "Ultra" : "Balanced"} is missing ${expectedRoot}`);
    requireCheck(rootNode?.extras?.orbitAsset === entry.id, `${expectedRoot} is missing orbitAsset=${entry.id}`);
    requireCheck(typeof rootNode?.extras?.designSignature === "string" && rootNode.extras.designSignature.length > 20, `${expectedRoot} lacks designSignature metadata`);
    requireCheck(hasName(inspector, new RegExp(`^${expectedRoot}_WEB_LOD${lod}$`)), `${entry.id} is missing WEB_LOD${lod}`);
    const collisionNodes = [...inspector.nodeByName.entries()].filter(([name]) => /_COLLISION$/.test(name));
    requireCheck(collisionNodes.length === 1, `${entry.id} must have exactly one collision proxy`, collisionNodes.map(([name]) => name));
    for (const [name, value] of collisionNodes) {
      requireCheck(value.node.mesh === undefined, `${entry.id} collision proxy ${name} must be metadata-only and own no mesh`);
      requireCheck(value.node.extras?.collisionOnly === true, `${entry.id} collision proxy ${name} lacks collisionOnly=true`);
      requireCheck(value.node.extras?.collisionShape === "sphere", `${entry.id} collision proxy ${name} lacks collisionShape=sphere`);
      requireCheck(Number(value.node.extras?.collisionRadius) > 0, `${entry.id} collision proxy ${name} lacks a positive collisionRadius`);
    }
    requireCheck(!hasName(inspector, /_COLLISION_SOURCE$/), `${entry.id} exported a hidden collision source mesh`);
    requireCheck(hasName(inspector, /_LABEL_ANCHOR$/), `${entry.id} is missing its label anchor`);
    requireCheck(hasName(inspector, /_FOCUS_ANCHOR$/), `${entry.id} is missing its camera focus anchor`);
    requireCheck(inspector.materialNames.some((name) => name.includes("Signal Orange")), `${entry.id} is missing the signal-orange PBR material`);
    requireCheck(inspector.images.length >= 2, `${entry.id} ${lod === 0 ? "Ultra" : "Balanced"} exported no usable PBR image library`, inspector.images.length);
    requireCheck(inspector.textures.length >= 2, `${entry.id} ${lod === 0 ? "Ultra" : "Balanced"} exported no usable PBR textures`, inspector.textures.length);
    requireCheck(inspector.normalMaterialCount >= 2, `${entry.id} ${lod === 0 ? "Ultra" : "Balanced"} lacks authored normal-textured materials`, inspector.normalMaterialCount);
    requireCheck(inspector.metallicRoughnessMaterialCount >= 2, `${entry.id} ${lod === 0 ? "Ultra" : "Balanced"} lacks authored metallic-roughness textures`, inspector.metallicRoughnessMaterialCount);
    for (const [imageIndex, image] of inspector.images.entries()) {
      requireCheck(Number.isInteger(image.bufferView), `${entry.id} image ${imageIndex} is not embedded in the GLB`);
      requireCheck(image.mimeType === "image/png", `${entry.id} image ${imageIndex} is not an embedded PNG`, image.mimeType);
    }
    validateAnimationContract(inspector, `${entry.id} ${lod === 0 ? "Ultra" : "Balanced"}`);
  }
  requireCheck(ultra.meshCount >= 12, `${entry.id} Ultra has too few separate mechanical mesh nodes`, ultra.meshCount);
  requireCheck(ultra.triangleCount >= 3500, `${entry.id} Ultra has insufficient authored geometry`, ultra.triangleCount);
  requireCheck(balanced.meshCount >= 2, `${entry.id} Balanced silhouette is empty`, balanced.meshCount);
  requireCheck(balanced.triangleCount < ultra.triangleCount, `${entry.id} Balanced is not lower complexity than Ultra`, { ultra: ultra.triangleCount, balanced: balanced.triangleCount });
  requireCheck(fs.statSync(balancedPath).size < fs.statSync(ultraPath).size, `${entry.id} Balanced GLB is not smaller than Ultra`);
  return {
    ultra: { bytes: fs.statSync(ultraPath).size, nodes: ultra.nodes.length, meshes: ultra.meshCount, triangles: ultra.triangleCount, animations: ultra.durations, images: ultra.images.length, textures: ultra.textures.length, normalMaterials: ultra.normalMaterialCount, metallicRoughnessMaterials: ultra.metallicRoughnessMaterialCount },
    balanced: { bytes: fs.statSync(balancedPath).size, nodes: balanced.nodes.length, meshes: balanced.meshCount, triangles: balanced.triangleCount, animations: balanced.durations, images: balanced.images.length, textures: balanced.textures.length, normalMaterials: balanced.normalMaterialCount, metallicRoughnessMaterials: balanced.metallicRoughnessMaterialCount },
    ultraInspector: ultra,
    balancedInspector: balanced,
  };
}

function pngDimensions(filePath) {
  const buffer = fs.readFileSync(filePath);
  const signature = "89504e470d0a1a0a";
  requireCheck(buffer.subarray(0, 8).toString("hex") === signature, `${path.basename(filePath)} is not a PNG`);
  requireCheck(buffer.toString("ascii", 12, 16) === "IHDR", `${path.basename(filePath)} has no PNG IHDR`);
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), bytes: buffer.length };
}

requireCheck(fs.existsSync(manifestPath), "orbit-manifest.json is missing");
if (!fs.existsSync(manifestPath)) {
  console.error(errors.join("\n"));
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
requireCheck(/^1\./.test(manifest.version), "manifest version must be 1.x");
requireCheck(manifest.system?.root === "OrbitSystem_ROOT", "manifest system root must be OrbitSystem_ROOT");
requireCheck(manifest.star?.root === "ReactorSun_ROOT", "manifest star root must be ReactorSun_ROOT");
requireCheck(Array.isArray(manifest.planets) && manifest.planets.length === 7, "manifest must contain seven planets");
requireCheck(JSON.stringify(manifest.planets?.map((planet) => planet.id)) === JSON.stringify(expectedIds), "manifest planet order/IDs are invalid", manifest.planets?.map((planet) => planet.id));
requireCheck(manifest.system?.flythrough?.durationSeconds === 60, "Blender master must declare the 60-second fly-through camera");

const masterPath = validateDescriptor(manifest.blenderMaster, "Blender master");
if (fs.existsSync(masterPath)) requireCheck(fs.statSync(masterPath).size > 500_000, "Blender master is unexpectedly small", fs.statSync(masterPath).size);

const textureEntries = Object.entries(manifest.textureLibrary?.images ?? {});
requireCheck(manifest.textureLibrary?.resolution === 512, "texture library resolution must be 512px", manifest.textureLibrary?.resolution);
requireCheck(textureEntries.length === 5, "manifest must declare five authored PBR texture images", textureEntries.map(([id]) => id));
const textureStats = {};
for (const [textureId, descriptor] of textureEntries) {
  const texturePath = validateDescriptor(descriptor, `PBR texture ${textureId}`);
  if (!fs.existsSync(texturePath)) continue;
  const dimensions = pngDimensions(texturePath);
  requireCheck(dimensions.width === 512 && dimensions.height === 512, `${textureId} must be 512x512`, dimensions);
  requireCheck(dimensions.bytes > 2_000, `${textureId} texture is suspiciously small`, dimensions.bytes);
  textureStats[textureId] = dimensions;
}

const stats = { assets: {}, renders: {}, textures: textureStats };
const starStats = validateAssetPair(manifest.star, "star");
if (starStats) stats.assets.star = { ultra: starStats.ultra, balanced: starStats.balanced };

const signatureRequirements = {
  transform: [/LegacyShell/, /FutureShell/, /ConversionSlideRail/, /HeroFastener/, /InterfacePort/],
  build: [/FoundryCore/, /FoundryDistrict_/, /DistrictLoadRib_/, /ForgeTunnelCollar_/, /ForgeMouthSector_/, /GantryMast_/, /GantryTensionRib_/],
  experience: [/DeepOpticalBody/, /RearOpticalBody/, /PRIMARY_LensGroup/, /SECONDARY_LensGroup/, /FrameSector_/, /BarrelRail_/, /IrisBlade_/, /IrisHinge_/, /ActuatorRam_/, /HoodVaneLoadPath_/],
  test: [/MeasurementRing/, /CalibrationArm/, /CalibrationJaw/, /ScannerAssembly/],
  deploy: [/EquatorialDock/, /DockArm/, /Container_/, /RackContinent/],
  protect: [/SolidCitadelCore/, /RearPressureHull/, /FrontArmourBed/, /ShieldBastion_/, /ShieldBastionFace_/, /CitadelWall_/, /WallArmourPanel_/, /EmbeddedVent_/, /ShieldLoadHinge_/, /BastionLoadRib_/, /LockCollar_/, /LockTunnelRail_/, /LockRearHousing/, /LockHousing/, /AuditInterlock_/, /LockJaw_/],
  operate: [/InferenceGimbal_/, /RailSector_/, /BearingDrum_/, /InferenceComputeBanks/, /ComputeBank_/, /ComputeBankSpine_/, /CausalKernel/, /CausalProcessorCollar/, /CausalProcessorFace/, /Operate_Node_/, /CausalLink_/, /BusFeed_/],
};
const balancedSignatureRequirements = {
  transform: [/Transform_MID_Legacy_ArmourTile/, /Transform_MID_Future_ArmourTile/, /Transform_MID_SlideRail/, /Transform_MID_RailLock/, /Transform_MID_LoadStrut/],
  build: [/Build_MID_Core/, /Build_MID_District_/, /Build_MID_DistrictRib_/, /Build_MID_ForgeTunnel_/, /Build_MID_Gantry_/],
  experience: [/Experience_MID_DeepOpticalBody/, /Experience_MID_PRIMARY_LensGroup/, /Experience_MID_SECONDARY_LensGroup/, /Experience_MID_OpticalVolume/, /Experience_MID_.*_Frame_/, /Experience_MID_IrisBlade_/, /Experience_MID_HoodVane_/],
  test: [/Test_MID_Shell_A_ArmourTile/, /Test_MID_Shell_B_ArmourTile/, /Test_MID_Ring/, /Test_MID_Clamp/],
  deploy: [/Deploy_MID_ArmourTile/, /Deploy_MID_Dock/, /Deploy_MID_Arm_/, /Deploy_MID_ArmSupport/],
  protect: [/Protect_MID_SolidCitadelCore/, /Protect_MID_RearPressureHull/, /Protect_MID_ShieldBastion_/, /Protect_MID_CitadelWall_/, /Protect_MID_ShieldLoadHinge_/, /Protect_MID_LockCollar_/, /Protect_MID_LockHousing/, /Protect_MID_AuditCore/, /Protect_MID_LockJaw_/],
  operate: [/Operate_MID_Gimbal_.*RailSector_/, /Operate_MID_Gimbal_.*BearingDrum_/, /Operate_MID_Processor/, /Operate_MID_ComputeBank_/, /Operate_MID_BankSpine_/, /Operate_MID_Node_/, /Operate_MID_CausalLink_/],
};
const signatures = new Set();
for (const planet of manifest.planets) {
  const result = validateAssetPair(planet, "planet");
  if (!result) continue;
  stats.assets[planet.id] = { ultra: result.ultra, balanced: result.balanced };
  const rootNode = result.ultraInspector.nodeByName.get(planet.root)?.node;
  signatures.add(rootNode?.extras?.designSignature);
  for (const pattern of signatureRequirements[planet.id]) {
    requireCheck(hasName(result.ultraInspector, pattern), `${planet.id} lacks distinctive authored part ${pattern}`);
  }
  for (const pattern of balancedSignatureRequirements[planet.id]) {
    requireCheck(hasName(result.balancedInspector, pattern), `${planet.id} Balanced lacks signature-preserving part ${pattern}`);
  }
  if (planet.id === "build") {
    const ultraNames = [...result.ultraInspector.nodeByName.keys()];
    const balancedNames = [...result.balancedInspector.nodeByName.keys()];
    requireCheck(ultraNames.filter((name) => /^Build_FoundryDistrict_(NORTH|WEST|EAST|SOUTH_WEST|SOUTH_EAST)$/.test(name)).length === 5, "build Ultra must retain five named interlocking foundry districts");
    requireCheck(ultraNames.filter((name) => /^Build_DistrictLoadRib_.+_[AB]$/.test(name)).length === 10, "build Ultra foundry districts lack paired load ribs");
    requireCheck(ultraNames.filter((name) => /^Build_ForgeTunnelCollar_\d+$/.test(name)).length === 4, "build Ultra forge throat lacks four receding structural collars");
    requireCheck(ultraNames.filter((name) => /^Build_ForgeMouthSector_\d{2}$/.test(name)).length === 8, "build Ultra forge mouth is not mechanically segmented");
    requireCheck(ultraNames.filter((name) => /^Build_GantryMast_\d+$/.test(name)).length === 4, "build Ultra must retain four bridge gantries");
    requireCheck(ultraNames.filter((name) => /^Build_GantryTensionRib_\d+$/.test(name)).length === 4, "build Ultra gantries lack explicit tension ribs");
    requireCheck(balancedNames.filter((name) => /^Build_MID_District_(NORTH|WEST|EAST|SOUTH_WEST|SOUTH_EAST)$/.test(name)).length === 5, "build Balanced must preserve the five-district foundry silhouette");
    requireCheck(balancedNames.filter((name) => /^Build_MID_DistrictRib_.+$/.test(name)).length === 5, "build Balanced districts lack visible load ribs");
    requireCheck(balancedNames.filter((name) => /^Build_MID_ForgeTunnel_\d+$/.test(name)).length === 3, "build Balanced forge throat lacks three receding collars");
    requireCheck(balancedNames.filter((name) => /^Build_MID_Gantry_\d+$/.test(name)).length === 4, "build Balanced must retain four silhouette gantries");
  }
  if (planet.id === "experience") {
    const ultraNames = [...result.ultraInspector.nodeByName.keys()];
    const balancedNames = [...result.balancedInspector.nodeByName.keys()];
    requireCheck(ultraNames.filter((name) => /^Experience_(PRIMARY|SECONDARY)_LensGroup$/.test(name)).length === 2, "experience Ultra must retain its asymmetric primary and secondary lens groups");
    requireCheck(ultraNames.filter((name) => /^Experience_(PRIMARY|SECONDARY)_FrameSector_\d_\d{2}$/.test(name)).length === 48, "experience Ultra twin optics lack three deep segmented frame layers");
    requireCheck(ultraNames.filter((name) => /^Experience_(PRIMARY|SECONDARY)_OpticalVolume_\d$/.test(name) || name === "Experience_OpticalVolume").length === 6, "experience Ultra must retain six nested optical volumes");
    requireCheck(ultraNames.filter((name) => /^Experience_(PRIMARY|SECONDARY)_BarrelRail_\d$/.test(name)).length === 8, "experience Ultra twin optics lack eight barrel load rails");
    requireCheck(ultraNames.filter((name) => /^Experience_IrisBlade_\d{2}$/.test(name)).length === 7, "experience Ultra primary optic lacks its seven-leaf iris");
    requireCheck(ultraNames.filter((name) => /^Experience_IrisHinge_\d{2}$/.test(name)).length === 7, "experience Ultra iris leaves lack dedicated bearing hinges");
    requireCheck(hasName(result.ultraInspector, /^Experience_ApertureBearing$/), "experience Ultra lacks a recessed primary aperture bearing");
    requireCheck(ultraNames.filter((name) => /^Experience_ActuatorRam_\d{2}$/.test(name)).length === 4, "experience Ultra lacks the four exposed optical actuators");
    requireCheck(ultraNames.filter((name) => /^Experience_HoodVane_(PRIMARY_TOP|PRIMARY_BOTTOM|SECONDARY_TOP|SECONDARY_OUTER)$/.test(name)).length === 4, "experience Ultra lacks its asymmetric split optical hood");
    requireCheck(ultraNames.filter((name) => /^Experience_HoodVaneLoadPath_\d{2}$/.test(name)).length === 4, "experience Ultra hood vanes lack explicit load paths");
    requireCheck(balancedNames.filter((name) => /^Experience_MID_(PRIMARY|SECONDARY)_LensGroup$/.test(name)).length === 2, "experience Balanced must preserve both asymmetric lens groups");
    requireCheck(balancedNames.filter((name) => /^Experience_MID_(PRIMARY|SECONDARY)_Frame_\d{2}$/.test(name)).length === 16, "experience Balanced twin optics lack segmented frames");
    requireCheck(balancedNames.filter((name) => /^Experience_MID_(PRIMARY|SECONDARY)_OpticalVolume_\d$/.test(name) || name === "Experience_MID_OpticalVolume").length === 4, "experience Balanced must retain four nested optical volumes");
    requireCheck(balancedNames.filter((name) => /^Experience_MID_IrisBlade_\d{2}$/.test(name)).length === 6, "experience Balanced primary optic lacks its six-leaf iris");
    requireCheck(balancedNames.filter((name) => /^Experience_MID_HoodVane_(PRIMARY_TOP|PRIMARY_BOTTOM|SECONDARY_TOP|SECONDARY_OUTER)$/.test(name)).length === 4, "experience Balanced lacks its asymmetric split optical hood");
  }
  if (planet.id === "protect") {
    const ultraNames = [...result.ultraInspector.nodeByName.keys()];
    const balancedNames = [...result.balancedInspector.nodeByName.keys()];
    requireCheck(ultraNames.filter((name) => /^Protect_ShieldBastion_\d{2}$/.test(name)).length === 6, "protect Ultra must retain six thick shield bastions");
    requireCheck(ultraNames.filter((name) => /^Protect_ShieldBastionFace_\d{2}$/.test(name)).length === 6, "protect Ultra bastions lack layered armour faces");
    requireCheck(ultraNames.filter((name) => /^Protect_CitadelWall_\d{2}$/.test(name)).length === 6, "protect Ultra bastions are not joined by a continuous six-sided citadel wall");
    requireCheck(ultraNames.filter((name) => /^Protect_CitadelWallFace_\d{2}$/.test(name)).length === 6, "protect Ultra citadel wall lacks layered armour faces");
    requireCheck(ultraNames.filter((name) => /^Protect_WallArmourPanel_\d{2}_[01]$/.test(name)).length === 12, "protect Ultra citadel walls lack twelve inset armour service panels");
    requireCheck(ultraNames.filter((name) => /^Protect_EmbeddedVent_\d{2}_\d$/.test(name)).length === 24, "protect Ultra citadel walls lack twenty-four recessed ventilation slots");
    requireCheck(ultraNames.filter((name) => /^Protect_ShieldLoadHinge_\d{2}$/.test(name)).length === 6, "protect Ultra bastions lack six structural load bearings");
    requireCheck(ultraNames.filter((name) => /^Protect_BastionLoadRib_\d{2}_[01]$/.test(name)).length === 12, "protect Ultra bastions lack paired causal load ribs");
    requireCheck(ultraNames.filter((name) => /^Protect_LockCollar_\d_\d{2}$/.test(name)).length === 40, "protect Ultra lock tunnel lacks four stepped decagonal collars");
    requireCheck(ultraNames.filter((name) => /^Protect_LockTunnelRail_\d$/.test(name)).length === 4, "protect Ultra lock tunnel lacks four continuous load rails");
    requireCheck(ultraNames.filter((name) => /^Protect_AuditInterlock_\d$/.test(name)).length === 4, "protect Ultra lock tunnel lacks four audit interlocks");
    requireCheck(ultraNames.filter((name) => /^Protect_LockJaw_[NSEW]$/.test(name)).length === 4, "protect Ultra lock mouth lacks four engineered locking jaws");
    requireCheck(balancedNames.filter((name) => /^Protect_MID_ShieldBastion_\d{2}$/.test(name)).length === 6, "protect Balanced must preserve the six-bastion silhouette");
    requireCheck(balancedNames.filter((name) => /^Protect_MID_CitadelWall_\d{2}$/.test(name)).length === 6, "protect Balanced bastions are not joined by the six-sided citadel wall");
    requireCheck(balancedNames.filter((name) => /^Protect_MID_ShieldLoadHinge_\d{2}$/.test(name)).length === 6, "protect Balanced bastions lack structural load bearings");
    requireCheck(balancedNames.filter((name) => /^Protect_MID_LockCollar_\d_\d{2}$/.test(name)).length === 24, "protect Balanced lock tunnel lacks three stepped segmented collars");
    requireCheck(balancedNames.filter((name) => /^Protect_MID_LockJaw_[NSEW]$/.test(name)).length === 4, "protect Balanced lock mouth lacks four animated internal jaws");
  }
  if (planet.id === "operate") {
    requireCheck(!hasName(result.ultraInspector, /Shell|PlanetBody|Silhouette/), "operate Ultra contains a forbidden solid shell/body");
    requireCheck(!hasName(result.balancedInspector, /Shell|PlanetBody|Silhouette/), "operate Balanced contains a forbidden solid shell/body");
    const ultraNames = [...result.ultraInspector.nodeByName.keys()];
    const balancedNames = [...result.balancedInspector.nodeByName.keys()];
    requireCheck(ultraNames.filter((name) => /^Operate_InferenceGimbal_\d_ACTION$/.test(name)).length === 3, "operate Ultra must retain three articulated inference gimbals");
    requireCheck(ultraNames.filter((name) => /^Operate_InferenceGimbal_\d_RailSector_\d{2}$/.test(name)).length === 30, "operate Ultra gimbals lack thirty machined rail sectors");
    requireCheck(ultraNames.filter((name) => /^Operate_InferenceGimbal_\d_BearingDrum_\d{2}$/.test(name)).length === 15, "operate Ultra gimbals lack fifteen visible bearing drums");
    requireCheck(ultraNames.filter((name) => /^Operate_ComputeBank_\d{2}$/.test(name)).length === 6, "operate Ultra must retain six inference compute banks");
    requireCheck(ultraNames.filter((name) => /^Operate_ComputeBankSpine_\d{2}$/.test(name)).length === 6, "operate Ultra compute banks lack radial load spines");
    requireCheck(ultraNames.filter((name) => /^Operate_Node_\d{2}$/.test(name)).length === 15, "operate Ultra must retain fifteen deliberately routed service nodes");
    requireCheck(ultraNames.filter((name) => /^Operate_CausalLink_\d_\d$/.test(name)).length === 12, "operate Ultra must retain three four-link causal buses");
    requireCheck(ultraNames.filter((name) => /^Operate_BusFeed_\d_[AB]$/.test(name)).length === 6, "operate Ultra causal buses must feed all six compute banks");
    requireCheck(hasName(result.ultraInspector, /^Operate_CausalProcessorCollar$/) && hasName(result.ultraInspector, /^Operate_CausalProcessorFace$/), "operate Ultra lacks its layered deep optical processor");
    requireCheck(balancedNames.filter((name) => /^Operate_MID_Gimbal_\d_ACTION$/.test(name)).length === 3, "operate Balanced must preserve three articulated inference gimbals");
    requireCheck(balancedNames.filter((name) => /^Operate_MID_Gimbal_\d_RailSector_\d{2}$/.test(name)).length === 24, "operate Balanced must retain twenty-four machined rail sectors");
    requireCheck(balancedNames.filter((name) => /^Operate_MID_Gimbal_\d_BearingDrum_\d{2}$/.test(name)).length === 12, "operate Balanced gimbals lack twelve visible bearing drums");
    requireCheck(balancedNames.filter((name) => /^Operate_MID_ComputeBank_\d{2}$/.test(name)).length === 6, "operate Balanced must preserve six compute banks");
    requireCheck(balancedNames.filter((name) => /^Operate_MID_BankSpine_\d{2}$/.test(name)).length === 6, "operate Balanced compute banks lack load spines");
    requireCheck(balancedNames.filter((name) => /^Operate_MID_Node_\d_\d$/.test(name)).length === 12, "operate Balanced must preserve twelve routed service nodes");
    requireCheck(balancedNames.filter((name) => /^Operate_MID_CausalLink_\d_\d$/.test(name)).length === 9, "operate Balanced must preserve three causal buses");
  }
  if (["experience", "protect", "operate"].includes(planet.id)) {
    const lodRoot = `${planet.root}_WEB_LOD1`;
    const articulatedTargets = [...result.balancedInspector.animationTargets].filter((name) => name !== planet.root && name !== lodRoot);
    requireCheck(articulatedTargets.length >= 2, `${planet.id} Balanced signature action must articulate internal child assemblies`, articulatedTargets);
  }
}
requireCheck(signatures.size === 7, "the seven planets do not have unique design signatures", [...signatures]);

const systemUltraPath = validateDescriptor(manifest.system.ultra, "system Ultra");
const systemBalancedPath = validateDescriptor(manifest.system.balanced, "system Balanced");
if (fs.existsSync(systemUltraPath) && fs.existsSync(systemBalancedPath)) {
  const ultra = inspectGlb(systemUltraPath);
  const balanced = inspectGlb(systemBalancedPath);
  requireCheck(ultra.sceneRoots.length === 1 && ultra.sceneRoots[0] === "OrbitSystem_ROOT", "system Ultra root is not OrbitSystem_ROOT", ultra.sceneRoots);
  requireCheck(balanced.sceneRoots.length === 1 && balanced.sceneRoots[0] === "OrbitSystem_ROOT", "system Balanced root is not OrbitSystem_ROOT", balanced.sceneRoots);
  for (const name of ["ReactorSun_ROOT", ...expectedIds.map((id) => `Planet_${id}_ROOT`), "OrbitInfrastructure_ROOT"]) {
    requireCheck(ultra.nodeByName.has(name), `system Ultra is missing ${name}`);
    requireCheck(balanced.nodeByName.has(name), `system Balanced is missing ${name}`);
  }
  for (const inspector of [ultra, balanced]) {
    requireCheck(!hasName(inspector, /_COLLISION_SOURCE$/), "system GLB exported a hidden collision source mesh");
    requireCheck(inspector.images.length >= 5, "system GLB must embed the complete five-image PBR texture library", inspector.images.length);
    requireCheck(inspector.normalMaterialCount >= 6, "system GLB has too few normal-textured material families", inspector.normalMaterialCount);
    requireCheck(inspector.metallicRoughnessMaterialCount >= 6, "system GLB has too few metallic-roughness-textured material families", inspector.metallicRoughnessMaterialCount);
    const collisionNodes = [...inspector.nodeByName.entries()].filter(([name]) => /_COLLISION$/.test(name));
    requireCheck(collisionNodes.length === 8, "system GLB must contain eight metadata-only collision proxies", collisionNodes.map(([name]) => name));
    for (const [name, value] of collisionNodes) {
      requireCheck(value.node.mesh === undefined, `system collision proxy ${name} owns visible geometry`);
      requireCheck(value.node.extras?.collisionOnly === true, `system collision proxy ${name} lacks collisionOnly=true`);
    }
  }
  requireCheck(ultra.meshCount >= 700, "system Ultra has fewer than 700 authored mesh nodes", ultra.meshCount);
  requireCheck(ultra.triangleCount >= 70_000, "system Ultra geometric detail is below acceptance", ultra.triangleCount);
  requireCheck(balanced.triangleCount < ultra.triangleCount * 0.45, "system Balanced is not materially cheaper than Ultra", { ultra: ultra.triangleCount, balanced: balanced.triangleCount });
  requireCheck(ultra.durations.length >= 10, "system Ultra does not include all signature actions", ultra.durations.length);
  requireCheck(balanced.durations.length >= 8, "system Balanced does not include star plus seven planet actions", balanced.durations.length);
  stats.system = {
    ultra: { bytes: fs.statSync(systemUltraPath).size, nodes: ultra.nodes.length, meshes: ultra.meshCount, triangles: ultra.triangleCount, animations: ultra.durations.length, images: ultra.images.length, textures: ultra.textures.length, normalMaterials: ultra.normalMaterialCount, metallicRoughnessMaterials: ultra.metallicRoughnessMaterialCount },
    balanced: { bytes: fs.statSync(systemBalancedPath).size, nodes: balanced.nodes.length, meshes: balanced.meshCount, triangles: balanced.triangleCount, animations: balanced.durations.length, images: balanced.images.length, textures: balanced.textures.length, normalMaterials: balanced.normalMaterialCount, metallicRoughnessMaterials: balanced.metallicRoughnessMaterialCount },
  };
}

const renderEntries = [
  ["star", manifest.star.hero],
  ...manifest.planets.map((planet) => [planet.id, planet.hero]),
  ["system-overview", manifest.renders?.systemOverview],
];
for (const [id, descriptor] of renderEntries) {
  const renderPath = validateDescriptor(descriptor, `${id} 4K acceptance frame`);
  if (!fs.existsSync(renderPath)) continue;
  const dimensions = pngDimensions(renderPath);
  requireCheck(dimensions.width === 4096 && dimensions.height === 2560, `${id} frame is not 4096x2560`, dimensions);
  requireCheck(dimensions.bytes > 150_000, `${id} frame is suspiciously small`, dimensions.bytes);
  requireCheck(descriptor.renderer === "Eevee Next", `${id} renderer metadata must be Eevee Next`);
  requireCheck(String(descriptor.viewTransform).startsWith("AgX"), `${id} render metadata must declare AgX`);
  stats.renders[id] = dimensions;
}

const report = {
  pass: errors.length === 0,
  result: errors.length === 0 ? "Blender asset approval: passed" : "Blender asset approval: failed",
  generatedAt: new Date().toISOString(),
  checks: checks.length,
  errors,
  warnings,
  stats,
};
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

const balancedChanges = {
  star: ["compact reactor core", "segmented armour", "three-axis load cage", "radiator fins and feed locks"],
  transform: ["asymmetric legacy and modular hemispheres", "gapped curved armour", "conversion rails and rail locks", "visible load struts"],
  build: ["five foundry districts", "deep forge tunnel", "district load ribs", "four coherent bridge gantries"],
  experience: ["asymmetric deep optical body", "primary and secondary nested optics", "articulated primary iris", "split optical hood"],
  test: ["two distinct measurement shells", "segmented inspection armour", "thick scanner rings", "calibration clamps"],
  deploy: ["segmented cloud armour", "thick equatorial dock", "supported deployment arms", "signal rail separated from structural rail"],
  protect: ["six faceted shield bastions", "paired causal load ribs", "deep segmented lock tunnel", "audit interlock bearings"],
  operate: ["no solid shell", "three segmented articulated gimbals", "six inference compute banks", "three routed service buses", "deep optical processor"],
};
const balancedAssets = {};
for (const [id, value] of Object.entries(stats.assets)) {
  balancedAssets[id] = {
    ultra: { bytes: value.ultra.bytes, meshes: value.ultra.meshes, triangles: value.ultra.triangles },
    balanced: { bytes: value.balanced.bytes, meshes: value.balanced.meshes, triangles: value.balanced.triangles },
    triangleRatio: value.ultra.triangles ? value.balanced.triangles / value.ultra.triangles : null,
    changes: balancedChanges[id] ?? [],
  };
}
fs.writeFileSync(balancedReportPath, `${JSON.stringify({
  generatedAt: report.generatedAt,
  result: report.result,
  system: stats.system,
  assets: balancedAssets,
}, null, 2)}\n`);

if (errors.length) {
  console.error("Blender asset approval: failed");
  errors.forEach((error) => console.error(`- ${error}`));
  console.error(`Validation report: ${reportPath}`);
  process.exit(1);
}

console.log("Blender asset approval: passed");
console.log(`Validated ${manifest.planets.length} structurally distinct planets, star, system GLBs, LOD pairs and nine 4K frames.`);
console.log(`PBR library: ${Object.keys(stats.textures).length} external 512px PNG sources; system GLB embeds ${stats.system.ultra.images} images / ${stats.system.ultra.textures} textures.`);
console.log(`System Ultra: ${stats.system.ultra.meshes} meshes / ${Math.round(stats.system.ultra.triangles).toLocaleString()} triangles / ${(stats.system.ultra.bytes / 1_048_576).toFixed(2)} MiB`);
console.log(`System Balanced: ${stats.system.balanced.meshes} meshes / ${Math.round(stats.system.balanced.triangles).toLocaleString()} triangles / ${(stats.system.balanced.bytes / 1_048_576).toFixed(2)} MiB`);
console.log(`Validation report: ${reportPath}`);
