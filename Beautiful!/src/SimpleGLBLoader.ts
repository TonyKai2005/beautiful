import * as THREE from "three";

interface GlbBufferView {
  buffer: number;
  byteLength: number;
  byteOffset?: number;
}

interface GlbAccessor {
  bufferView: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  normalized?: boolean;
  type: "SCALAR" | "VEC2" | "VEC3" | "VEC4";
}

interface GlbPrimitive {
  attributes: Record<string, number>;
  indices?: number;
  material?: number;
  mode?: number;
}

interface GlbMesh {
  name?: string;
  primitives: GlbPrimitive[];
}

interface GlbNode {
  name?: string;
  children?: number[];
  mesh?: number;
  translation?: [number, number, number];
  rotation?: [number, number, number, number];
  scale?: [number, number, number];
  extras?: Record<string, unknown>;
}

interface GlbMaterial {
  name?: string;
  alphaMode?: "OPAQUE" | "MASK" | "BLEND";
  alphaCutoff?: number;
  doubleSided?: boolean;
  emissiveFactor?: [number, number, number];
  pbrMetallicRoughness?: {
    baseColorFactor?: [number, number, number, number];
    metallicFactor?: number;
    roughnessFactor?: number;
  };
  extensions?: {
    KHR_materials_transmission?: { transmissionFactor?: number };
    KHR_materials_emissive_strength?: { emissiveStrength?: number };
    KHR_materials_ior?: { ior?: number };
    KHR_materials_volume?: { thicknessFactor?: number };
  };
}

interface GlbJson {
  accessors: GlbAccessor[];
  bufferViews: GlbBufferView[];
  materials?: GlbMaterial[];
  meshes: GlbMesh[];
  nodes: GlbNode[];
  scene?: number;
  scenes: Array<{ name?: string; nodes?: number[] }>;
}

type NumericArray = Float32Array | Uint32Array | Uint16Array | Uint8Array | Int16Array | Int8Array;

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BINARY_CHUNK = 0x004e4942;

const componentCount = (type: GlbAccessor["type"]): number => {
  if (type === "SCALAR") return 1;
  if (type === "VEC2") return 2;
  if (type === "VEC3") return 3;
  return 4;
};

const typedArrayFor = (componentType: number, buffer: ArrayBuffer, byteOffset: number, length: number): NumericArray => {
  if (componentType === 5126) return new Float32Array(buffer, byteOffset, length);
  if (componentType === 5125) return new Uint32Array(buffer, byteOffset, length);
  if (componentType === 5123) return new Uint16Array(buffer, byteOffset, length);
  if (componentType === 5122) return new Int16Array(buffer, byteOffset, length);
  if (componentType === 5121) return new Uint8Array(buffer, byteOffset, length);
  if (componentType === 5120) return new Int8Array(buffer, byteOffset, length);
  throw new Error(`Unsupported glTF component type ${componentType}`);
};

const createMaterial = (definition: GlbMaterial | undefined): THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial => {
  const pbr = definition?.pbrMetallicRoughness;
  const [r, g, b, alpha] = pbr?.baseColorFactor ?? [1, 1, 1, 1];
  const transmission = definition?.extensions?.KHR_materials_transmission?.transmissionFactor ?? 0;
  const options: THREE.MeshPhysicalMaterialParameters = {
    color: new THREE.Color().setRGB(r, g, b),
    metalness: pbr?.metallicFactor ?? 1,
    roughness: pbr?.roughnessFactor ?? 1,
    opacity: alpha,
    transparent: definition?.alphaMode === "BLEND" || alpha < 1 || transmission > 0,
    side: definition?.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    depthWrite: definition?.alphaMode !== "BLEND" && transmission <= 0,
  };
  const material = transmission > 0 ? new THREE.MeshPhysicalMaterial(options) : new THREE.MeshStandardMaterial(options);
  material.name = definition?.name ?? "e Gain material";
  if (definition?.emissiveFactor) material.emissive.setRGB(...definition.emissiveFactor);
  material.emissiveIntensity = definition?.extensions?.KHR_materials_emissive_strength?.emissiveStrength ?? 1;
  material.alphaTest = definition?.alphaMode === "MASK" ? definition.alphaCutoff ?? 0.5 : 0;
  if (material instanceof THREE.MeshPhysicalMaterial) {
    material.transmission = transmission;
    material.ior = definition?.extensions?.KHR_materials_ior?.ior ?? 1.5;
    material.thickness = definition?.extensions?.KHR_materials_volume?.thicknessFactor ?? 0;
  }
  return material;
};

/**
 * Narrow, allocation-light loader for the locally generated e Gain GLB.
 * The Blender export contains embedded triangle buffers and PBR factors only;
 * avoiding generic loader plugins keeps decoding deterministic during boot.
 */
export function parseSimpleGlb(buffer: ArrayBuffer): THREE.Group {
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== GLB_MAGIC) throw new Error("Invalid GLB header");

  let cursor = 12;
  let json: GlbJson | null = null;
  let binaryOffset = -1;
  while (cursor < buffer.byteLength) {
    const chunkLength = view.getUint32(cursor, true);
    const chunkType = view.getUint32(cursor + 4, true);
    const chunkOffset = cursor + 8;
    if (chunkType === JSON_CHUNK) {
      const bytes = new Uint8Array(buffer, chunkOffset, chunkLength);
      json = JSON.parse(new TextDecoder().decode(bytes).trim()) as GlbJson;
    } else if (chunkType === BINARY_CHUNK) {
      binaryOffset = chunkOffset;
    }
    cursor = chunkOffset + chunkLength;
  }
  if (!json || binaryOffset < 0) throw new Error("GLB is missing JSON or binary data");

  const attributeFor = (accessorIndex: number): THREE.BufferAttribute => {
    const accessor = json!.accessors[accessorIndex];
    const bufferView = json!.bufferViews[accessor.bufferView];
    if (bufferView.buffer !== 0) throw new Error("External GLB buffers are not supported");
    const itemSize = componentCount(accessor.type);
    const byteOffset = binaryOffset + (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    return new THREE.BufferAttribute(
      typedArrayFor(accessor.componentType, buffer, byteOffset, accessor.count * itemSize),
      itemSize,
      accessor.normalized ?? false,
    );
  };

  const materials = (json.materials ?? []).map(createMaterial);
  const fallbackMaterial = new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 0.7, metalness: 0.3 });
  const geometryTemplates = json.meshes.map((meshDefinition) =>
    meshDefinition.primitives.map((primitive) => {
      if (primitive.mode !== undefined && primitive.mode !== 4) throw new Error("Only triangle GLB primitives are supported");
      const geometry = new THREE.BufferGeometry();
      Object.entries(primitive.attributes).forEach(([semantic, accessorIndex]) => {
        const attributeName = semantic === "POSITION" ? "position" : semantic === "NORMAL" ? "normal" : semantic === "TEXCOORD_0" ? "uv" : null;
        if (attributeName) geometry.setAttribute(attributeName, attributeFor(accessorIndex));
      });
      if (primitive.indices !== undefined) geometry.setIndex(attributeFor(primitive.indices));
      geometry.computeBoundingSphere();
      return { geometry, material: materials[primitive.material ?? -1] ?? fallbackMaterial };
    }),
  );

  const buildNode = (nodeIndex: number): THREE.Object3D => {
    const definition = json!.nodes[nodeIndex];
    const object = new THREE.Group();
    object.name = definition.name ?? `Node_${nodeIndex}`;
    if (definition.translation) object.position.fromArray(definition.translation);
    if (definition.rotation) object.quaternion.fromArray(definition.rotation);
    if (definition.scale) object.scale.fromArray(definition.scale);
    if (definition.extras) object.userData = { ...definition.extras };

    if (definition.mesh !== undefined) {
      const primitives = geometryTemplates[definition.mesh];
      primitives.forEach(({ geometry, material }, primitiveIndex) => {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = primitives.length === 1 ? object.name : `${object.name}_Primitive_${primitiveIndex}`;
        object.add(mesh);
      });
    }
    definition.children?.forEach((childIndex) => object.add(buildNode(childIndex)));
    return object;
  };

  const sceneDefinition = json.scenes[json.scene ?? 0];
  const root = new THREE.Group();
  root.name = sceneDefinition.name ?? "eGain Deployment Corridor";
  sceneDefinition.nodes?.forEach((nodeIndex) => root.add(buildNode(nodeIndex)));
  return root;
}
