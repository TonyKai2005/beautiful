export type PerformanceLevel = 0 | 1 | 2 | 3 | 4 | 5;

export type PerformanceState =
  | "warming"
  | "stable"
  | "under-pressure"
  | "recovering"
  | "degraded"
  | "restored";

export interface PerformanceGovernorConfig {
  warmupSeconds: number;
  lowFpsThreshold: number;
  lowWindowSeconds: number;
  lowWindowsRequired: number;
  highFpsThreshold: number;
  highWindowSeconds: number;
  highWindowsRequired: number;
  maximumLevel: PerformanceLevel;
}

export interface PerformanceGovernorSnapshot {
  level: PerformanceLevel;
  state: PerformanceState;
  fps: number | null;
  levelChanged: boolean;
  lowWindows: number;
  highWindows: number;
  warmupRemaining: number;
}

export interface PerformanceQualityProfile {
  speedEffectScale: number;
  bloomResolutionScale: number;
  bloomIntensityScale: number;
  particleScale: number;
  realtimeShadows: boolean;
  maximumPixelRatio: number | null;
}

const DEFAULT_CONFIG: PerformanceGovernorConfig = {
  warmupSeconds: 3,
  lowFpsThreshold: 46,
  lowWindowSeconds: 2.5,
  lowWindowsRequired: 2,
  highFpsThreshold: 55,
  highWindowSeconds: 3,
  highWindowsRequired: 2,
  maximumLevel: 5,
};

const clampLevel = (value: number, maximum: PerformanceLevel): PerformanceLevel => (
  Math.min(maximum, Math.max(0, Math.round(value))) as PerformanceLevel
);

/**
 * Deterministic, renderer-agnostic performance state machine.
 *
 * Monitoring starts only after `resetAfterPrewarm()` and its warm-up window.
 * Low- and high-FPS decisions intentionally use independent sample windows so
 * recovery is exactly two 3 s windows rather than an approximation based on
 * the 2.5 s degradation window.
 */
export class PerformanceGovernor {
  private readonly config: PerformanceGovernorConfig;
  private level: PerformanceLevel;
  private state: PerformanceState = "warming";
  private warmupRemaining: number;
  private lowElapsed = 0;
  private lowFrames = 0;
  private highElapsed = 0;
  private highFrames = 0;
  private consecutiveLowWindows = 0;
  private consecutiveHighWindows = 0;
  private latestFps: number | null = null;

  constructor(
    config: Partial<PerformanceGovernorConfig> = {},
    initialLevel: PerformanceLevel = 0,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.validateConfig();
    this.level = clampLevel(initialLevel, this.config.maximumLevel);
    this.warmupRemaining = this.config.warmupSeconds;
  }

  /** Call after assets are uploaded and shaders/environments are prewarmed. */
  resetAfterPrewarm(initialLevel: PerformanceLevel = this.level): PerformanceGovernorSnapshot {
    this.level = clampLevel(initialLevel, this.config.maximumLevel);
    this.state = "warming";
    this.warmupRemaining = this.config.warmupSeconds;
    this.latestFps = null;
    this.clearSamples();
    return this.snapshot(false);
  }

  sample(deltaSeconds: number): PerformanceGovernorSnapshot {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return this.snapshot(false);

    if (this.warmupRemaining > 0) {
      this.warmupRemaining = Math.max(0, this.warmupRemaining - deltaSeconds);
      this.state = this.warmupRemaining > 0 ? "warming" : "stable";
      this.clearSamples();
      return this.snapshot(false);
    }

    this.lowElapsed += deltaSeconds;
    this.lowFrames += 1;
    this.highElapsed += deltaSeconds;
    this.highFrames += 1;

    let levelChanged = false;
    if (this.lowElapsed >= this.config.lowWindowSeconds) {
      const fps = this.lowFrames / this.lowElapsed;
      this.latestFps = fps;
      this.lowElapsed = 0;
      this.lowFrames = 0;

      if (fps < this.config.lowFpsThreshold) {
        this.consecutiveLowWindows += 1;
        this.consecutiveHighWindows = 0;
        this.state = "under-pressure";
      } else {
        this.consecutiveLowWindows = 0;
        if (this.state === "under-pressure") this.state = "stable";
      }

      if (
        this.consecutiveLowWindows >= this.config.lowWindowsRequired
        && this.level < this.config.maximumLevel
      ) {
        this.level = clampLevel(this.level + 1, this.config.maximumLevel);
        this.state = "degraded";
        levelChanged = true;
        this.clearSamples();
      }
    }

    if (!levelChanged && this.highElapsed >= this.config.highWindowSeconds) {
      const fps = this.highFrames / this.highElapsed;
      this.latestFps = fps;
      this.highElapsed = 0;
      this.highFrames = 0;

      if (fps > this.config.highFpsThreshold) {
        this.consecutiveHighWindows += 1;
        this.consecutiveLowWindows = 0;
        this.state = "recovering";
      } else {
        this.consecutiveHighWindows = 0;
        if (this.state === "recovering") this.state = "stable";
      }

      if (this.consecutiveHighWindows >= this.config.highWindowsRequired && this.level > 0) {
        this.level = clampLevel(this.level - 1, this.config.maximumLevel);
        this.state = "restored";
        levelChanged = true;
        this.clearSamples();
      }
    }

    return this.snapshot(levelChanged);
  }

  getSnapshot(): PerformanceGovernorSnapshot {
    return this.snapshot(false);
  }

  private snapshot(levelChanged: boolean): PerformanceGovernorSnapshot {
    return {
      level: this.level,
      state: this.state,
      fps: this.latestFps,
      levelChanged,
      lowWindows: this.consecutiveLowWindows,
      highWindows: this.consecutiveHighWindows,
      warmupRemaining: this.warmupRemaining,
    };
  }

  private clearSamples(): void {
    this.lowElapsed = 0;
    this.lowFrames = 0;
    this.highElapsed = 0;
    this.highFrames = 0;
    this.consecutiveLowWindows = 0;
    this.consecutiveHighWindows = 0;
  }

  private validateConfig(): void {
    const positiveValues = [
      this.config.warmupSeconds,
      this.config.lowFpsThreshold,
      this.config.lowWindowSeconds,
      this.config.lowWindowsRequired,
      this.config.highFpsThreshold,
      this.config.highWindowSeconds,
      this.config.highWindowsRequired,
    ];
    if (positiveValues.some((value) => !Number.isFinite(value) || value <= 0)) {
      throw new Error("Performance governor timing and thresholds must be positive finite values.");
    }
    if (this.config.maximumLevel < 1 || this.config.maximumLevel > 5) {
      throw new Error("Performance governor maximumLevel must be between 1 and 5.");
    }
  }
}

/** Ordered quality reductions: one concern changes at each degradation level. */
export const getPerformanceQualityProfile = (level: PerformanceLevel): PerformanceQualityProfile => ({
  speedEffectScale: level >= 1 ? 0.55 : 1,
  // Preserve bloom at every level, but make its mip chain genuinely cheap
  // once the governor has already confirmed sustained pressure.
  bloomResolutionScale: level >= 5 ? 0.35 : level >= 4 ? 0.48 : level >= 2 ? 0.65 : 1,
  bloomIntensityScale: level >= 2 ? 0.65 : 1,
  particleScale: level >= 3 ? 0.55 : 1,
  realtimeShadows: level < 4,
  maximumPixelRatio: level >= 5 ? 0.75 : null,
});
