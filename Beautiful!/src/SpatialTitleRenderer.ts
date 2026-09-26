import * as THREE from "three";
import fontDataSource from "./assets/fonts/spatial-title-msdf.json";

export type SpatialTitleViewport = "desktop" | "mobile";
export type SpatialTitleAlignment = "left" | "center" | "right";

export interface SpatialTitleLayoutSpec {
  /** Explicit line breaks for this viewport. */
  lines: readonly string[];
  align: SpatialTitleAlignment;
  /** Fraction of the visible viewport width occupied by the title. */
  targetScreenWidth: number;
  /** Distance between baselines as a multiple of the font's native line height. */
  lineHeight?: number;
  /** Additional tracking in font em units. */
  tracking?: number;
}

export interface SpatialTitleSpec<Id extends string = string> {
  id: Id;
  desktop: SpatialTitleLayoutSpec;
  mobile: SpatialTitleLayoutSpec;
  color: THREE.ColorRepresentation;
  outlineColor?: THREE.ColorRepresentation;
  /** Outline thickness in physical screen pixels. */
  outlineWidth?: number;
  outlineOpacity?: number;
  depthTest?: boolean;
  renderOrder?: number;
}

export interface SpatialTitlePlacement {
  camera: THREE.PerspectiveCamera;
  viewport: SpatialTitleViewport;
  /** Positive distance forward from the camera, in world units. */
  depth: number;
  /** Optional one-off override for the selected layout's target width. */
  targetScreenWidth?: number;
  /** Offset measured as a fraction of full viewport width/height. */
  screenOffset?: Readonly<{ x: number; y: number }>;
  /** Additional camera-local offset in world units. */
  worldOffset?: Readonly<{ x: number; y: number }>;
  opacity?: number;
  revealScale?: number;
}

export interface SpatialTitleMetrics {
  width: number;
  height: number;
  lineCount: number;
  glyphCount: number;
  align: SpatialTitleAlignment;
  targetScreenWidth: number;
}

interface BitmapGlyph {
  id: number;
  char: string;
  width: number;
  height: number;
  xoffset: number;
  yoffset: number;
  xadvance: number;
  x: number;
  y: number;
}

interface BitmapKerning {
  first: number;
  second: number;
  amount: number;
}

interface BitmapFontData {
  chars: BitmapGlyph[];
  common: {
    lineHeight: number;
    base: number;
    scaleW: number;
    scaleH: number;
  };
  info: {
    size: number;
  };
  distanceField: {
    fieldType: string;
    distanceRange: number;
  };
  kernings: BitmapKerning[];
}

interface BuiltLayout {
  geometry: THREE.BufferGeometry;
  metrics: SpatialTitleMetrics;
}

interface TitleUniforms extends Record<string, THREE.IUniform> {
  uMap: THREE.Uniform<THREE.Texture>;
  uAtlasSize: THREE.Uniform<THREE.Vector2>;
  uDistanceRange: THREE.Uniform<number>;
  uColor: THREE.Uniform<THREE.Color>;
  uOutlineColor: THREE.Uniform<THREE.Color>;
  uOutlineWidth: THREE.Uniform<number>;
  uOutlineOpacity: THREE.Uniform<number>;
  uOpacity: THREE.Uniform<number>;
}

const fontData = fontDataSource as BitmapFontData;
const atlasUrl = new URL(
  "./assets/fonts/spatial-title-msdf.png",
  import.meta.url,
).href;

const vertexShader = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec2 uAtlasSize;
  uniform float uDistanceRange;
  uniform vec3 uColor;
  uniform vec3 uOutlineColor;
  uniform float uOutlineWidth;
  uniform float uOutlineOpacity;
  uniform float uOpacity;

  varying vec2 vUv;

  float median(float red, float green, float blue) {
    return max(min(red, green), min(max(red, green), blue));
  }

  float screenPixelRange() {
    vec2 unitRange = vec2(uDistanceRange) / uAtlasSize;
    vec2 screenTextureSize = vec2(1.0) / max(fwidth(vUv), vec2(0.000001));
    return max(0.5 * dot(unitRange, screenTextureSize), 1.0);
  }

  void main() {
    vec3 sampleValue = texture2D(uMap, vUv).rgb;
    float signedDistance = screenPixelRange() * (median(
      sampleValue.r,
      sampleValue.g,
      sampleValue.b
    ) - 0.5);
    float fillCoverage = smoothstep(-0.5, 0.5, signedDistance);
    float outlineCoverage = smoothstep(
      -uOutlineWidth - 0.5,
      -uOutlineWidth + 0.5,
      signedDistance
    );
    float alpha = max(fillCoverage, outlineCoverage * uOutlineOpacity) * uOpacity;

    if (alpha <= 0.001) discard;

    vec3 color = mix(uOutlineColor, uColor, fillCoverage);
    gl_FragColor = vec4(color, alpha);
  }
`;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const getContrastOutline = (color: THREE.Color): THREE.Color => {
  const luminance = color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
  return new THREE.Color(luminance > 0.28 ? 0x050607 : 0xf8f6f0);
};

const getLineWidth = (
  line: string,
  glyphs: ReadonlyMap<string, BitmapGlyph>,
  kernings: ReadonlyMap<string, number>,
  trackingPixels: number,
): number => {
  let width = 0;
  let previousId: number | undefined;
  const characters = Array.from(line);

  characters.forEach((character, index) => {
    const glyph = glyphs.get(character);
    if (!glyph) throw new Error(`Spatial title atlas is missing glyph ${JSON.stringify(character)}`);
    if (previousId !== undefined) width += kernings.get(`${previousId}:${glyph.id}`) ?? 0;
    width += glyph.xadvance;
    if (index < characters.length - 1) width += trackingPixels;
    previousId = glyph.id;
  });

  return width;
};

const buildGeometry = (
  layout: SpatialTitleLayoutSpec,
  glyphs: ReadonlyMap<string, BitmapGlyph>,
  kernings: ReadonlyMap<string, number>,
): BuiltLayout => {
  if (!layout.lines.length) throw new Error("A spatial title needs at least one line");
  const unit = 1 / fontData.info.size;
  const trackingPixels = (layout.tracking ?? 0.008) * fontData.info.size;
  const baselineAdvance = fontData.common.lineHeight * (layout.lineHeight ?? 0.86);
  const lineWidths = layout.lines.map((line) =>
    getLineWidth(line, glyphs, kernings, trackingPixels),
  );
  const maxLineWidth = Math.max(...lineWidths);
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let vertexOffset = 0;
  let glyphCount = 0;
  let minimumY = Number.POSITIVE_INFINITY;
  let maximumY = Number.NEGATIVE_INFINITY;

  layout.lines.forEach((line, lineIndex) => {
    const lineWidth = lineWidths[lineIndex] ?? 0;
    const alignedOrigin =
      layout.align === "left" ? 0 : layout.align === "right" ? -lineWidth : -lineWidth * 0.5;
    const baseline = -lineIndex * baselineAdvance;
    let cursor = alignedOrigin;
    let previousId: number | undefined;
    const characters = Array.from(line);

    characters.forEach((character, characterIndex) => {
      const glyph = glyphs.get(character);
      if (!glyph) throw new Error(`Spatial title atlas is missing glyph ${JSON.stringify(character)}`);
      if (previousId !== undefined) cursor += kernings.get(`${previousId}:${glyph.id}`) ?? 0;

      if (glyph.width > 0 && glyph.height > 0) {
        const left = (cursor + glyph.xoffset) * unit;
        const right = (cursor + glyph.xoffset + glyph.width) * unit;
        const top = (baseline + fontData.common.base - glyph.yoffset) * unit;
        const bottom = (baseline + fontData.common.base - glyph.yoffset - glyph.height) * unit;
        const u0 = glyph.x / fontData.common.scaleW;
        const u1 = (glyph.x + glyph.width) / fontData.common.scaleW;
        const v0 = 1 - (glyph.y + glyph.height) / fontData.common.scaleH;
        const v1 = 1 - glyph.y / fontData.common.scaleH;

        positions.push(
          left, bottom, 0,
          right, bottom, 0,
          right, top, 0,
          left, top, 0,
        );
        uvs.push(u0, v0, u1, v0, u1, v1, u0, v1);
        indices.push(
          vertexOffset,
          vertexOffset + 1,
          vertexOffset + 2,
          vertexOffset,
          vertexOffset + 2,
          vertexOffset + 3,
        );
        vertexOffset += 4;
        glyphCount += 1;
        minimumY = Math.min(minimumY, bottom);
        maximumY = Math.max(maximumY, top);
      }

      cursor += glyph.xadvance;
      if (characterIndex < characters.length - 1) cursor += trackingPixels;
      previousId = glyph.id;
    });
  });

  if (!glyphCount) throw new Error("A spatial title cannot contain only whitespace");

  const verticalCenter = (minimumY + maximumY) * 0.5;
  for (let index = 1; index < positions.length; index += 3) positions[index] -= verticalCenter;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  return {
    geometry,
    metrics: {
      width: maxLineWidth * unit,
      height: (maximumY - minimumY) * unit,
      lineCount: layout.lines.length,
      glyphCount,
      align: layout.align,
      targetScreenWidth: layout.targetScreenWidth,
    },
  };
};

export class SpatialTitle<Id extends string = string> {
  readonly id: Id;
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly layouts: Record<SpatialTitleViewport, BuiltLayout>;
  private readonly uniforms: TitleUniforms;
  private readonly localOffset = new THREE.Vector3();
  private readonly automaticOutline: boolean;
  private viewport: SpatialTitleViewport = "desktop";

  constructor(
    spec: SpatialTitleSpec<Id>,
    atlas: THREE.Texture,
    glyphs: ReadonlyMap<string, BitmapGlyph>,
    kernings: ReadonlyMap<string, number>,
  ) {
    this.id = spec.id;
    this.automaticOutline = spec.outlineColor === undefined;
    this.layouts = {
      desktop: buildGeometry(spec.desktop, glyphs, kernings),
      mobile: buildGeometry(spec.mobile, glyphs, kernings),
    };
    this.uniforms = {
      uMap: new THREE.Uniform(atlas),
      uAtlasSize: new THREE.Uniform(
        new THREE.Vector2(fontData.common.scaleW, fontData.common.scaleH),
      ),
      uDistanceRange: new THREE.Uniform(fontData.distanceField.distanceRange),
      uColor: new THREE.Uniform(new THREE.Color(spec.color)),
      uOutlineColor: new THREE.Uniform(new THREE.Color()),
      uOutlineWidth: new THREE.Uniform(Math.max(0, spec.outlineWidth ?? 0.65)),
      uOutlineOpacity: new THREE.Uniform(clamp01(spec.outlineOpacity ?? 0.34)),
      uOpacity: new THREE.Uniform(0),
    };
    this.uniforms.uOutlineColor.value.copy(
      spec.outlineColor === undefined
        ? getContrastOutline(this.uniforms.uColor.value)
        : new THREE.Color(spec.outlineColor),
    );
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      depthTest: spec.depthTest ?? true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(this.layouts.desktop.geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = spec.renderOrder ?? 2;
    this.mesh.visible = false;
  }

  setViewport(viewport: SpatialTitleViewport): void {
    if (viewport === this.viewport) return;
    this.viewport = viewport;
    this.mesh.geometry = this.layouts[viewport].geometry;
  }

  getMetrics(viewport: SpatialTitleViewport = this.viewport): Readonly<SpatialTitleMetrics> {
    return this.layouts[viewport].metrics;
  }

  setColor(
    color: THREE.ColorRepresentation,
    outlineColor?: THREE.ColorRepresentation,
  ): void {
    this.uniforms.uColor.value.set(color);
    if (outlineColor !== undefined) {
      this.uniforms.uOutlineColor.value.set(outlineColor);
    } else if (this.automaticOutline) {
      this.uniforms.uOutlineColor.value.copy(getContrastOutline(this.uniforms.uColor.value));
    }
  }

  setOutline(
    width: number,
    opacity = this.uniforms.uOutlineOpacity.value,
    color?: THREE.ColorRepresentation,
  ): void {
    this.uniforms.uOutlineWidth.value = Math.max(0, width);
    this.uniforms.uOutlineOpacity.value = clamp01(opacity);
    if (color !== undefined) this.uniforms.uOutlineColor.value.set(color);
  }

  setOpacity(opacity: number): void {
    const nextOpacity = clamp01(opacity);
    this.uniforms.uOpacity.value = nextOpacity;
    this.mesh.visible = nextOpacity > 0.001;
  }

  /**
   * Places and scales the title on a camera-facing plane. The scale is derived
   * from actual FOV, aspect ratio, depth and the requested viewport-width share.
   */
  place(placement: SpatialTitlePlacement): number {
    this.setViewport(placement.viewport);
    const metrics = this.layouts[this.viewport].metrics;
    const depth = Math.max(0.001, placement.depth);
    const visibleHeight =
      2 * depth * Math.tan(THREE.MathUtils.degToRad(placement.camera.getEffectiveFOV()) * 0.5);
    const visibleWidth = visibleHeight * placement.camera.aspect;
    const targetScreenWidth = Math.max(
      0.001,
      placement.targetScreenWidth ?? metrics.targetScreenWidth,
    );
    const scale =
      (visibleWidth * targetScreenWidth * (placement.revealScale ?? 1)) /
      Math.max(0.001, metrics.width);
    const screenOffset = placement.screenOffset ?? { x: 0, y: 0 };
    const worldOffset = placement.worldOffset ?? { x: 0, y: 0 };
    this.localOffset.set(
      visibleWidth * screenOffset.x + worldOffset.x,
      visibleHeight * screenOffset.y + worldOffset.y,
      -depth,
    ).applyQuaternion(placement.camera.quaternion);

    this.mesh.position.copy(placement.camera.position).add(this.localOffset);
    this.mesh.quaternion.copy(placement.camera.quaternion);
    this.mesh.scale.setScalar(scale);
    if (placement.opacity !== undefined) this.setOpacity(placement.opacity);
    return scale;
  }

  dispose(): void {
    this.layouts.desktop.geometry.dispose();
    this.layouts.mobile.geometry.dispose();
    this.mesh.material.dispose();
  }
}

export class SpatialTitleRenderer {
  private readonly atlas: THREE.Texture;
  private readonly glyphs = new Map<string, BitmapGlyph>();
  private readonly kernings = new Map<string, number>();

  private constructor(atlas: THREE.Texture) {
    this.atlas = atlas;
    fontData.chars.forEach((glyph) => this.glyphs.set(glyph.char, glyph));
    fontData.kernings.forEach((kerning) => {
      this.kernings.set(`${kerning.first}:${kerning.second}`, kerning.amount);
    });
  }

  static async load(renderer?: THREE.WebGLRenderer): Promise<SpatialTitleRenderer> {
    if (fontData.distanceField.fieldType !== "msdf") {
      throw new Error("The spatial title atlas must be generated as MSDF");
    }
    const atlas = await new THREE.TextureLoader().loadAsync(atlasUrl);
    atlas.colorSpace = THREE.NoColorSpace;
    atlas.minFilter = THREE.LinearMipmapLinearFilter;
    atlas.magFilter = THREE.LinearFilter;
    atlas.generateMipmaps = true;
    atlas.anisotropy = renderer
      ? Math.min(8, renderer.capabilities.getMaxAnisotropy())
      : 4;
    atlas.needsUpdate = true;
    return new SpatialTitleRenderer(atlas);
  }

  createTitle<Id extends string>(spec: SpatialTitleSpec<Id>): SpatialTitle<Id> {
    return new SpatialTitle(spec, this.atlas, this.glyphs, this.kernings);
  }

  dispose(): void {
    this.atlas.dispose();
  }
}
