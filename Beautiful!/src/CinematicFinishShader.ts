import { Color, Vector2, type IUniform } from "three";

export interface CinematicFinishUniforms extends Record<string, IUniform> {
  tDiffuse: IUniform<unknown>;
  uResolution: IUniform<Vector2>;
  uTime: IUniform<number>;
  uGrainAmount: IUniform<number>;
  uVignetteAmount: IUniform<number>;
  uVignetteFeather: IUniform<number>;
  uChromaticAberration: IUniform<number>;
  uProtectPulse: IUniform<number>;
  uProtectSweep: IUniform<number>;
  uProtectEdge: IUniform<number>;
  uProtectFlash: IUniform<number>;
  uProtectColor: IUniform<Color>;
  uShadowLift: IUniform<number>;
  uShadowTint: IUniform<Color>;
  /** 0..1 deterministic impact envelope supplied by the scroll director. */
  uSpeedImpact: IUniform<number>;
  /** Screen-space direction of travel. The sign may be reversed while scrubbing. */
  uSpeedDirection: IUniform<Vector2>;
  /** 1 while Project Orbit is active; skips film-only multi-tap edge work. */
  uOrbitMode: IUniform<number>;
  /** Retained for caller compatibility; the final direction intentionally ignores it. */
  uReducedMotion: IUniform<number>;
}

export interface CinematicFinishShaderDefinition {
  name: string;
  uniforms: CinematicFinishUniforms;
  vertexShader: string;
  fragmentShader: string;
}

const vertexShader = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uGrainAmount;
  uniform float uVignetteAmount;
  uniform float uVignetteFeather;
  uniform float uChromaticAberration;
  uniform float uProtectPulse;
  uniform float uProtectSweep;
  uniform float uProtectEdge;
  uniform float uProtectFlash;
  uniform vec3 uProtectColor;
  uniform float uShadowLift;
  uniform vec3 uShadowTint;
  uniform float uSpeedImpact;
  uniform vec2 uSpeedDirection;
  uniform float uOrbitMode;

  varying vec2 vUv;

  float egainLuma(vec3 color) {
    return dot(color, vec3(0.2126, 0.7152, 0.0722));
  }

  float grainNoise(vec2 position, float frame) {
    vec3 seed = fract(vec3(position.xyx) * vec3(0.1031, 0.1030, 0.0973));
    seed += dot(seed, seed.yzx + 33.33 + frame * 0.013);
    return fract((seed.x + seed.y) * seed.z);
  }

  // Compress only values that would otherwise lose all highlight structure in
  // OutputPass. Scaling by the peak channel keeps signal-orange energy orange
  // instead of independently bending its RGB channels toward cream-white.
  vec3 huePreservingHighlightShoulder(vec3 inputColor) {
    vec3 safeColor = max(inputColor, vec3(0.0));
    float peak = max(max(safeColor.r, safeColor.g), safeColor.b);
    const float shoulderStart = 0.92;
    const float shoulderRange = 0.58;
    float compressedPeak = shoulderStart + shoulderRange * (
      1.0 - exp(-max(peak - shoulderStart, 0.0) / shoulderRange)
    );
    float peakScale = peak > shoulderStart
      ? compressedPeak / max(peak, 0.0001)
      : 1.0;
    return safeColor * peakScale;
  }

  float signalOrangeMask(vec3 inputColor) {
    vec3 safeColor = max(inputColor, vec3(0.0));
    float peak = max(max(safeColor.r, safeColor.g), safeColor.b);
    vec3 normalizedColor = safeColor / max(peak, 0.0001);
    float channelFloor = min(min(normalizedColor.r, normalizedColor.g), normalizedColor.b);
    float saturation = 1.0 - channelFloor;
    float redDominance = smoothstep(0.16, 0.42, normalizedColor.r - normalizedColor.g);
    float blueSeparation = smoothstep(0.12, 0.48, normalizedColor.r - normalizedColor.b);
    return redDominance * blueSeparation
      * smoothstep(0.18, 0.62, saturation)
      * smoothstep(0.08, 0.42, peak);
  }

  void main() {
    vec2 resolution = max(uResolution, vec2(1.0));
    vec2 texel = 1.0 / resolution;
    vec2 fromCenter = vUv - 0.5;
    float speedImpact = smoothstep(0.0, 1.0, clamp(uSpeedImpact, 0.0, 1.0));
    float orbitMode = step(0.5, uOrbitMode);
    vec2 speedDirection = normalize(uSpeedDirection + vec2(0.00001, 0.0));

    // One centre sample and two sub-pixel radial samples keep the aberration
    // optical rather than glitch-like.
    float aberrationPixels = max(uChromaticAberration, 0.0);
    float radialDistance = length(fromCenter * 2.0);
    vec2 radialDirection = fromCenter / max(length(fromCenter), 0.0001);
    vec2 chromaOffset = radialDirection * texel * aberrationPixels
      * (0.18 + radialDistance * radialDistance * 0.82);

    vec4 centreSample = texture2D(tDiffuse, vUv);
    vec3 positiveChromaSample = texture2D(
      tDiffuse,
      clamp(vUv + chromaOffset, texel, 1.0 - texel)
    ).rgb;
    vec3 negativeChromaSample = texture2D(
      tDiffuse,
      clamp(vUv - chromaOffset, texel, 1.0 - texel)
    ).rgb;
    vec3 color = vec3(
      positiveChromaSample.r,
      centreSample.g,
      negativeChromaSample.b
    );

    // A short, one-sided shutter smear communicates forward velocity without
    // turning the whole frame soft. It is resolution independent and is based
    // only on uSpeedImpact/uSpeedDirection, so reversing scroll is deterministic.
    float speedPixels = speedImpact * (3.0 + radialDistance * 8.0);
    vec2 speedStep = speedDirection * texel * speedPixels;
    if (orbitMode < 0.5 && speedImpact > 0.001) {
      vec3 speedSampleNear = texture2D(
        tDiffuse,
        clamp(vUv - speedStep * 0.32, texel, 1.0 - texel)
      ).rgb;
      vec3 speedSampleMiddle = texture2D(
        tDiffuse,
        clamp(vUv - speedStep * 0.68, texel, 1.0 - texel)
      ).rgb;
      vec3 speedSampleFar = texture2D(
        tDiffuse,
        clamp(vUv - speedStep, texel, 1.0 - texel)
      ).rgb;
      vec3 speedBlur = centreSample.rgb * 0.43;
      speedBlur += speedSampleNear * 0.28;
      speedBlur += speedSampleMiddle * 0.18;
      speedBlur += speedSampleFar * 0.11;
      float speedBlurMix = speedImpact * mix(0.1, 0.34, smoothstep(0.08, 1.25, radialDistance));
      color = mix(color, speedBlur, speedBlurMix);
    }

    // Neutral high-contrast details are overwhelmingly the spatial titles and
    // hard-surface seams. Four compact taps identify those edges independently
    // of their orientation, then restore the undispersed centre sample. Colored
    // energy and the rest of the frame retain the full optical treatment.
    float imageEdge = 0.0;
    if (orbitMode < 0.5) {
      vec2 edgeDirection = normalize(vec2(0.82, -0.57));
      vec2 edgePerpendicular = vec2(-edgeDirection.y, edgeDirection.x);
      vec2 detailOffsetA = edgeDirection * texel * 1.35;
      vec2 detailOffsetB = edgePerpendicular * texel * 1.35;
      vec3 neighbour = texture2D(tDiffuse, clamp(vUv + detailOffsetA, texel, 1.0 - texel)).rgb;
      vec3 oppositeNeighbour = texture2D(tDiffuse, clamp(vUv - detailOffsetA, texel, 1.0 - texel)).rgb;
      vec3 perpendicularNeighbour = texture2D(tDiffuse, clamp(vUv + detailOffsetB, texel, 1.0 - texel)).rgb;
      vec3 oppositePerpendicularNeighbour = texture2D(tDiffuse, clamp(vUv - detailOffsetB, texel, 1.0 - texel)).rgb;
      float centreLuma = egainLuma(centreSample.rgb);
      float neighbourLuma = egainLuma(neighbour);
      float oppositeNeighbourLuma = egainLuma(oppositeNeighbour);
      float perpendicularNeighbourLuma = egainLuma(perpendicularNeighbour);
      float oppositePerpendicularLuma = egainLuma(oppositePerpendicularNeighbour);
      float localPeakLuma = max(max(centreLuma, neighbourLuma), max(oppositeNeighbourLuma, max(perpendicularNeighbourLuma, oppositePerpendicularLuma)));
      float localContrast = max(
        max(abs(centreLuma - neighbourLuma), abs(centreLuma - oppositeNeighbourLuma)),
        max(abs(centreLuma - perpendicularNeighbourLuma), abs(centreLuma - oppositePerpendicularLuma))
      ) / max(localPeakLuma, 0.08);
      float centrePeak = max(max(centreSample.r, centreSample.g), centreSample.b);
      float centreFloor = min(min(centreSample.r, centreSample.g), centreSample.b);
      float centreSaturation = (centrePeak - centreFloor) / max(centrePeak, 0.08);
      float neutralDetailProtection = (1.0 - smoothstep(0.045, 0.18, centreSaturation))
        * smoothstep(0.16, 0.52, localContrast)
        * smoothstep(0.075, 0.24, localPeakLuma);
      float centreRestore = neutralDetailProtection * mix(0.78, 0.93, speedImpact);
      color = mix(color, centreSample.rgb, centreRestore);
      imageEdge = smoothstep(0.025, 0.19, abs(centreLuma - neighbourLuma));
    }

    float aspect = resolution.x / resolution.y;
    vec2 aspectUv = fromCenter * vec2(aspect, 1.0);
    float cornerRadius = length(vec2(0.5 * aspect, 0.5));
    float normalizedRadius = length(aspectUv) / max(cornerRadius, 0.0001);

    float vignetteStart = 1.0 - clamp(uVignetteFeather, 0.08, 0.95);
    float vignette = smoothstep(vignetteStart, 1.0, normalizedRadius);
    color *= 1.0 - vignette * clamp(uVignetteAmount, 0.0, 0.8);

    // Sparse procedural shutter streaks live mainly at the edge of frame. The
    // pattern is deliberately static: its presence and strength are controlled
    // entirely by scroll progress rather than wall-clock time.
    float alongSpeed = dot(fromCenter, speedDirection);
    float acrossSpeed = dot(fromCenter, vec2(-speedDirection.y, speedDirection.x));
    float laneCoordinate = acrossSpeed * 82.0;
    float laneIndex = floor(laneCoordinate);
    float laneDistance = abs(fract(laneCoordinate) - 0.5);
    float segmentIndex = floor((alongSpeed + 0.75) * 9.0);
    float laneSeed = grainNoise(vec2(laneIndex, segmentIndex), 0.0);
    float lineCore = 1.0 - smoothstep(0.025, 0.16, laneDistance);
    float dashPhase = fract((alongSpeed + 0.75) * 9.0 + laneSeed);
    float dashMask = smoothstep(0.04, 0.2, dashPhase)
      * (1.0 - smoothstep(0.6, 0.96, dashPhase));
    float sparseMask = step(0.77, laneSeed);
    float edgeMask = smoothstep(0.26, 0.78, radialDistance)
      * (1.0 - smoothstep(1.1, 1.48, radialDistance));
    float speedLine = lineCore * dashMask * sparseMask * edgeMask
      * speedImpact * speedImpact * 0.17;
    vec3 speedSignal = mix(vec3(1.0, 0.97, 0.91), uProtectColor, 0.18) * speedLine;
    color = 1.0 - (1.0 - color) * (1.0 - speedSignal);

    float protectPulse = smoothstep(0.0, 1.0, clamp(uProtectPulse, 0.0, 1.0));
    float sweepPosition = mix(-0.92, 0.92, clamp(uProtectSweep, 0.0, 1.0));
    float sweepAxis = dot(fromCenter, normalize(vec2(0.78, 0.62)));
    float sweepBand = 1.0 - smoothstep(0.018, 0.12, abs(sweepAxis - sweepPosition));
    float frameEdge = smoothstep(0.72, 1.0, normalizedRadius);
    float motionSafePulse = protectPulse;
    float protectEdge = (
      imageEdge * max(uProtectEdge, 0.0)
      + sweepBand * 0.34
      + frameEdge * 0.055
    ) * motionSafePulse;
    float protectFlash = max(uProtectFlash, 0.0) * motionSafePulse
      * (0.1 + sweepBand * 0.9);

    // Soft-screen addition preserves detail in bright metal and avoids a
    // clipped full-frame orange wash.
    vec3 protectSignal = clamp(
      uProtectColor * (protectEdge * 0.42 + protectFlash * 0.28),
      0.0,
      0.72
    );
    color = 1.0 - (1.0 - color) * (1.0 - protectSignal);

    // Lift only real, low-luminance geometry. Exact black remains black, so
    // the corridor keeps its pressure while graphite seams and bevels survive.
    float shadowLuma = egainLuma(color);
    float shadowPresence = smoothstep(0.006, 0.045, shadowLuma);
    float shadowRange = 1.0 - smoothstep(0.17, 0.42, shadowLuma);
    color += uShadowTint * max(uShadowLift, 0.0) * shadowPresence * shadowRange;

    // Screen-blended glow can reduce warm energy to pale cream. Restore a
    // restrained amount of chroma only where red clearly dominates, then use
    // a hue-preserving shoulder to retain detail in Test/Protect/Finale peaks.
    float orangeSignal = max(signalOrangeMask(centreSample.rgb), signalOrangeMask(color));
    float signalLuma = egainLuma(color);
    color = max(
      mix(vec3(signalLuma), color, 1.0 + orangeSignal * 0.14),
      vec3(0.0)
    );
    color = huePreservingHighlightShoulder(color);

    // Grain advances at a film-like cadence for every viewer so the cinematic
    // treatment remains identical across motion-preference settings.
    float grainFrame = floor(uTime * 24.0);
    float noise = grainNoise(gl_FragCoord.xy, grainFrame) - 0.5;
    float highlightProtection = 1.0 - smoothstep(0.56, 1.0, egainLuma(color));
    float grainStrength = max(uGrainAmount, 0.0)
      * mix(0.38, 1.0, highlightProtection);
    color += noise * grainStrength;

    gl_FragColor = vec4(max(color, 0.0), centreSample.a);
  }
`;

/**
 * A reusable shader definition for Three.js ShaderPass.
 *
 * ShaderPass clones these uniforms, so the exported singleton is suitable for
 * one or more composers. Use createCinematicFinishShader() when a caller needs
 * an explicitly isolated definition before constructing a pass.
 */
export const CinematicFinishShader: CinematicFinishShaderDefinition = {
  name: "CinematicFinishShader",
  uniforms: {
    tDiffuse: { value: null },
    uResolution: { value: new Vector2(1, 1) },
    uTime: { value: 0 },
    uGrainAmount: { value: 0.018 },
    uVignetteAmount: { value: 0.2 },
    uVignetteFeather: { value: 0.52 },
    uChromaticAberration: { value: 0.55 },
    uProtectPulse: { value: 0 },
    uProtectSweep: { value: 0.5 },
    uProtectEdge: { value: 0.58 },
    uProtectFlash: { value: 0.18 },
    uProtectColor: { value: new Color(0xff3d00) },
    uShadowLift: { value: 0 },
    uShadowTint: { value: new Color(0xb8c7d9) },
    uSpeedImpact: { value: 0 },
    uSpeedDirection: { value: new Vector2(0, -1) },
    uOrbitMode: { value: 0 },
    uReducedMotion: { value: 0 },
  },
  vertexShader,
  fragmentShader,
};

export const createCinematicFinishShader = (): CinematicFinishShaderDefinition => ({
  ...CinematicFinishShader,
  uniforms: {
    ...CinematicFinishShader.uniforms,
    tDiffuse: { value: null },
    uResolution: { value: CinematicFinishShader.uniforms.uResolution.value.clone() },
    uProtectColor: { value: CinematicFinishShader.uniforms.uProtectColor.value.clone() },
    uShadowTint: { value: CinematicFinishShader.uniforms.uShadowTint.value.clone() },
    uSpeedDirection: { value: CinematicFinishShader.uniforms.uSpeedDirection.value.clone() },
    uOrbitMode: { value: 0 },
  },
});
