import fs from "node:fs";
import * as THREE from "three";

const assetPaths = [
  "public/assets/3d/egain-corridor.glb",
  "public/assets/3d/egain-corridor-balanced.glb",
];

const expectedGroups = [
  "BuildAssembly",
  "TestGate",
  "DeployArray",
  "ProtectPlane",
  "CloudTopology",
  "FinaleCore",
];

const expectedSemanticHierarchy = {
  BuildAssembly: ["BuildSourceField", "BuildShell", "BuildMechanics", "BuildCore", "BuildEnergy"],
  TestGate: ["TestPillars", "TestHeaderAssembly", "TestThresholdAssembly", "TestScannerAssembly", "TestGlassAssembly"],
  DeployArray: ["DeployCells", "DeployCrownAssembly", "DeployBuses", "DeployUplinks", "DeployHeroSignAssembly"],
  ProtectPlane: ["ProtectBlade", "ProtectGateAssembly", "ProtectTiles", "ProtectLockAssembly"],
  CloudTopology: ["OperateCanopy", "OperateGimbal", "OperateNetwork", "OperateNodes"],
  FinaleCore: ["FinaleNucleus", "FinaleEnergyRings", "FinaleMechanicalRings", "FinaleBrandAssembly", "FinaleConduits", "FinalePylons", "FinaleFragments"],
};

function parseGlb(path) {
  const file = fs.readFileSync(path);
  const jsonLength = file.readUInt32LE(12);
  const json = JSON.parse(file.subarray(20, 20 + jsonLength).toString("utf8").replace(/\0+$/, ""));
  const binaryHeader = 20 + jsonLength;
  const binaryLength = file.readUInt32LE(binaryHeader);
  const binary = file.subarray(binaryHeader + 8, binaryHeader + 8 + binaryLength);
  return { path, json, binary };
}

function createInspector(asset) {
  const { json, binary } = asset;
  const nodes = json.nodes ?? [];
  const meshes = json.meshes ?? [];
  const accessors = json.accessors ?? [];
  const bufferViews = json.bufferViews ?? [];
  const parents = Array(nodes.length).fill(-1);
  nodes.forEach((node, index) => {
    for (const child of node.children ?? []) parents[child] = index;
  });

  const worldMatrices = [];
  const localMatrix = (node) => {
    const matrix = new THREE.Matrix4();
    if (node.matrix) return matrix.fromArray(node.matrix);
    return matrix.compose(
      new THREE.Vector3(...(node.translation ?? [0, 0, 0])),
      new THREE.Quaternion(...(node.rotation ?? [0, 0, 0, 1])),
      new THREE.Vector3(...(node.scale ?? [1, 1, 1])),
    );
  };
  const worldMatrix = (index) => {
    if (worldMatrices[index]) return worldMatrices[index];
    const matrix = localMatrix(nodes[index]);
    if (parents[index] >= 0) matrix.premultiply(worldMatrix(parents[index]));
    worldMatrices[index] = matrix;
    return matrix;
  };
  const descendants = (index, output = []) => {
    output.push(index);
    for (const child of nodes[index].children ?? []) descendants(child, output);
    return output;
  };

  const componentSize = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 };
  const componentCount = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  const readAccessor = (accessorIndex) => {
    const accessor = accessors[accessorIndex];
    const view = bufferViews[accessor.bufferView];
    const size = componentSize[accessor.componentType];
    const count = componentCount[accessor.type];
    const offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const stride = view.byteStride ?? size * count;
    const read =
      accessor.componentType === 5121
        ? (cursor) => binary.readUInt8(cursor)
        : accessor.componentType === 5123
          ? (cursor) => binary.readUInt16LE(cursor)
          : accessor.componentType === 5125
            ? (cursor) => binary.readUInt32LE(cursor)
            : (cursor) => binary.readFloatLE(cursor);
    const values = [];
    for (let index = 0; index < accessor.count; index += 1) {
      const cursor = offset + index * stride;
      if (count === 1) values.push(read(cursor));
      else values.push(Array.from({ length: count }, (_, component) => read(cursor + component * size)));
    }
    return values;
  };

  const nodeIndex = (name) => nodes.findIndex((node) => node.name === name);
  const eachWorldVertex = (groupName, callback) => {
    const groupIndex = nodeIndex(groupName);
    for (const index of descendants(groupIndex, [])) {
      const node = nodes[index];
      if (node.mesh === undefined) continue;
      const matrix = worldMatrix(index);
      for (const primitive of meshes[node.mesh].primitives ?? []) {
        for (const value of readAccessor(primitive.attributes.POSITION)) {
          callback(new THREE.Vector3(...value).applyMatrix4(matrix), node, primitive, index);
        }
      }
    }
  };
  const bounds = (groupName) => {
    const box = new THREE.Box3();
    eachWorldVertex(groupName, (vertex) => box.expandByPoint(vertex));
    return box;
  };

  return {
    nodes,
    meshes,
    accessors,
    parents,
    nodeIndex,
    descendants,
    worldMatrix,
    readAccessor,
    eachWorldVertex,
    bounds,
  };
}

function connectedComponents(vertices, indices) {
  const parents = Int32Array.from({ length: vertices.length }, (_, index) => index);
  const find = (value) => {
    while (parents[value] !== value) {
      parents[value] = parents[parents[value]];
      value = parents[value];
    }
    return value;
  };
  const union = (left, right) => {
    left = find(left);
    right = find(right);
    if (left !== right) parents[right] = left;
  };
  for (let index = 0; index < indices.length; index += 3) {
    union(indices[index], indices[index + 1]);
    union(indices[index], indices[index + 2]);
  }
  const components = new Map();
  vertices.forEach((_, index) => {
    const root = find(index);
    if (!components.has(root)) components.set(root, []);
    components.get(root).push(index);
  });
  return [...components.values()];
}

function inspectAsset(path) {
  const asset = parseGlb(path);
  const inspector = createInspector(asset);
  const { json } = asset;
  const errors = [];
  const requireCheck = (condition, message) => {
    if (!condition) errors.push(message);
  };

  for (const name of expectedGroups) requireCheck(inspector.nodeIndex(name) >= 0, `missing group ${name}`);

  const semanticSummary = {};
  for (const [chapterName, semanticNames] of Object.entries(expectedSemanticHierarchy)) {
    const chapterIndex = inspector.nodeIndex(chapterName);
    const chapterChildren = new Set(inspector.nodes[chapterIndex]?.children ?? []);
    semanticSummary[chapterName] = {};
    semanticNames.forEach((name, sequenceIndex) => {
      const index = inspector.nodeIndex(name);
      requireCheck(index >= 0, `missing semantic assembly ${name}`);
      if (index < 0) return;
      requireCheck(chapterChildren.has(index), `${name} is not a direct child of ${chapterName}`);
      requireCheck(inspector.parents[index] === chapterIndex, `${name} has incorrect parent`);
      requireCheck(inspector.nodes[index].extras?.sequenceIndex === sequenceIndex, `${name} sequenceIndex is not ${sequenceIndex}`);
      requireCheck(Boolean(inspector.nodes[index].extras?.semanticAssembly), `${name} is missing semanticAssembly metadata`);
      const meshNodes = inspector.descendants(index, []).filter((descendant) => inspector.nodes[descendant].mesh !== undefined);
      requireCheck(meshNodes.length > 0, `${name} has no renderable descendants`);
      semanticSummary[chapterName][name] = meshNodes.length;
    });
    const unexpectedRenderableChildren = [...chapterChildren]
      .filter((index) => inspector.nodes[index].mesh !== undefined)
      .map((index) => inspector.nodes[index].name);
    requireCheck(
      unexpectedRenderableChildren.length === 0,
      `${chapterName} still has chapter-level meshes: ${unexpectedRenderableChildren.join(", ")}`,
    );
  }

  const triangleCount = (json.meshes ?? []).reduce(
    (total, mesh) =>
      total +
      (mesh.primitives ?? []).reduce((meshTotal, primitive) => {
        const count = primitive.indices === undefined
          ? json.accessors[primitive.attributes.POSITION].count
          : json.accessors[primitive.indices].count;
        return meshTotal + count / 3;
      }, 0),
    0,
  );

  const cellBounds = [0, 1, 2].map((column) => inspector.bounds(`DeployCell_${column}_0`));
  const aisleWidth = cellBounds[2].min.x - cellBounds[1].max.x;
  const aisleCenter = (cellBounds[2].min.x + cellBounds[1].max.x) * 0.5;
  requireCheck(aisleWidth >= 4.2, `Deploy aisle is ${aisleWidth.toFixed(3)}m`);

  const leftPillar = inspector.bounds("TestPillar_L");
  const rightPillar = inspector.bounds("TestPillar_R");
  const testGateClearWidth = rightPillar.min.x - leftPillar.max.x;
  requireCheck(testGateClearWidth >= 2.4, `Test gate clear width is ${testGateClearWidth.toFixed(3)}m`);

  const cloudNode = inspector.nodes[inspector.nodeIndex("CloudTopology")];
  const authoredPassCenter = cloudNode.extras.cameraPassCenter;
  const passCenter = new THREE.Vector3(authoredPassCenter[0], authoredPassCenter[2], -authoredPassCenter[1]);
  let apertureRadius = Infinity;
  inspector.eachWorldVertex("CloudTopology", (vertex) => {
    if (Math.abs(vertex.z - passCenter.z) > 0.65) return;
    apertureRadius = Math.min(apertureRadius, Math.hypot(vertex.x - passCenter.x, vertex.y - passCenter.y));
  });
  requireCheck(apertureRadius * 2 >= 3, `Operate aperture is ${(apertureRadius * 2).toFixed(3)}m`);

  const finaleConduitsIndex = inspector.nodeIndex("FinaleConduits");
  const conduitClearances = [];
  for (const childIndex of inspector.descendants(finaleConduitsIndex, [])) {
    const node = inspector.nodes[childIndex];
    if (node.mesh === undefined) continue;
    for (const primitive of inspector.meshes[node.mesh].primitives ?? []) {
      if (primitive.indices === undefined) continue;
      const matrix = inspector.worldMatrix(childIndex);
      const vertices = inspector
        .readAccessor(primitive.attributes.POSITION)
        .map((value) => new THREE.Vector3(...value).applyMatrix4(matrix));
      const indices = inspector.readAccessor(primitive.indices);
      for (const component of connectedComponents(vertices, indices)) {
        const box = new THREE.Box3();
        let minimumAbsX = Infinity;
        for (const vertexIndex of component) {
          const vertex = vertices[vertexIndex];
          box.expandByPoint(vertex);
          minimumAbsX = Math.min(minimumAbsX, Math.abs(vertex.x));
        }
        if (box.max.z - box.min.z > 3.5) conduitClearances.push(minimumAbsX);
      }
    }
  }
  requireCheck(conduitClearances.length === 4, `found ${conduitClearances.length} longitudinal Finale conduits`);
  requireCheck(Math.min(...conduitClearances) >= 1.75, "a Finale conduit enters the protected centre");

  const groupSummary = Object.fromEntries(
    expectedGroups.map((name) => {
      const size = inspector.bounds(name).getSize(new THREE.Vector3());
      return [name, size.toArray().map((value) => Number(value.toFixed(3)))];
    }),
  );

  console.log(JSON.stringify({
    asset: path,
    nodes: inspector.nodes.length,
    meshes: inspector.meshes.length,
    triangles: Math.round(triangleCount),
    groups: groupSummary,
    semanticAssemblies: semanticSummary,
    test: { gateClearWidth: Number(testGateClearWidth.toFixed(3)) },
    deploy: { aisleWidth: Number(aisleWidth.toFixed(3)), aisleCenter: Number(aisleCenter.toFixed(3)) },
    operate: {
      passCenter: passCenter.toArray(),
      apertureDiameter: Number((apertureRadius * 2).toFixed(3)),
      cameraSurfaceClearance: Number((apertureRadius - 0.42).toFixed(3)),
    },
    finale: { conduitMinimumAbsX: conduitClearances.map((value) => Number(value.toFixed(3))) },
    result: errors.length === 0 ? "passed" : "failed",
    errors,
  }, null, 2));

  if (errors.length > 0) process.exitCode = 1;
}

for (const path of assetPaths) inspectAsset(path);
