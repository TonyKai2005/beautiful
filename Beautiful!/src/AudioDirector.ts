export type AudioDirectorState = "armed" | "loading" | "playing" | "muted" | "suspended";

const reportAudioWarning = (message: string, error: unknown) => {
  if (error instanceof DOMException && error.name === "NotAllowedError") return;
  console.warn(message, error);
};

type CueName = "test" | "protect" | "finale";

interface CueWindow {
  name: CueName;
  start: number;
  trigger: number;
  end: number;
  cooldown: number;
}

interface CueState {
  inside: boolean;
  lastTriggeredAt: number;
}

interface MusicMixPoint {
  progress: number;
  frequency: number;
  gain: number;
  resonance: number;
}

const MUSIC_URL = "/assets/audio/deep-techno-ambience.mp3";
const CROSSFADE_SECONDS = 4;
const MUSIC_MASTER_GAIN = 0.3;

const CUE_WINDOWS: readonly CueWindow[] = [
  { name: "test", start: 0.296, trigger: 0.315, end: 0.338, cooldown: 0.72 },
  { name: "protect", start: 0.606, trigger: 0.622, end: 0.655, cooldown: 0.88 },
  { name: "finale", start: 0.915, trigger: 0.932, end: 0.95, cooldown: 0.84 },
];

const MUSIC_MIX: readonly MusicMixPoint[] = [
  { progress: 0, frequency: 900, gain: 0.54, resonance: 1.2 },
  { progress: 0.07, frequency: 1250, gain: 0.58, resonance: 1.35 },
  { progress: 0.24, frequency: 2400, gain: 0.72, resonance: 1.55 },
  { progress: 0.39, frequency: 3900, gain: 0.8, resonance: 1.75 },
  { progress: 0.58, frequency: 6600, gain: 0.95, resonance: 1.45 },
  { progress: 0.73, frequency: 7200, gain: 0.88, resonance: 1.65 },
  { progress: 0.88, frequency: 8700, gain: 0.94, resonance: 1.5 },
  { progress: 0.945, frequency: 11200, gain: 1, resonance: 1.25 },
  { progress: 1, frequency: 5200, gain: 0.72, resonance: 1.15 },
];

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const windowPulse = (progress: number, center: number, radius: number): number =>
  Math.max(0, 1 - Math.abs(progress - center) / radius);

const interpolateMix = (progress: number): MusicMixPoint => {
  const safe = clamp01(progress);
  const upperIndex = MUSIC_MIX.findIndex((point) => point.progress >= safe);
  if (upperIndex <= 0) return MUSIC_MIX[0];
  if (upperIndex === -1) return MUSIC_MIX[MUSIC_MIX.length - 1];

  const left = MUSIC_MIX[upperIndex - 1];
  const right = MUSIC_MIX[upperIndex];
  const span = Math.max(0.0001, right.progress - left.progress);
  const amount = (safe - left.progress) / span;
  return {
    progress: safe,
    frequency: left.frequency + (right.frequency - left.frequency) * amount,
    gain: left.gain + (right.gain - left.gain) * amount,
    resonance: left.resonance + (right.resonance - left.resonance) * amount,
  };
};

export class AudioDirector {
  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private musicFilter: BiquadFilterNode | null = null;
  private cueGain: GainNode | null = null;
  private transientNoise: AudioBuffer | null = null;
  private elements: [HTMLAudioElement, HTMLAudioElement] | null = null;
  private elementGains: [GainNode, GainNode] | null = null;
  private sourceNodes: [MediaElementAudioSourceNode, MediaElementAudioSourceNode] | null = null;
  private state: AudioDirectorState = "armed";
  private userMuted = false;
  private enableAttempt: Promise<boolean> | null = null;
  private resumeAfterSuspend = false;
  private activeTrack = 0;
  private crossfading = false;
  private crossfadeTimer: number | null = null;
  private crossfadeFinishTimer: number | null = null;
  private progress = 0;
  private orbitMode = false;
  private previousProgress: number | null = null;
  private lastGlobalCueAt = Number.NEGATIVE_INFINITY;
  private readonly cueStates: Record<CueName, CueState> = {
    test: { inside: false, lastTriggeredAt: Number.NEGATIVE_INFINITY },
    protect: { inside: false, lastTriggeredAt: Number.NEGATIVE_INFINITY },
    finale: { inside: false, lastTriggeredAt: Number.NEGATIVE_INFINITY },
  };

  constructor(private readonly onStateChange?: (state: AudioDirectorState) => void) {}

  preload(): void {
    this.ensureElements();
  }

  getState(): AudioDirectorState {
    return this.state;
  }

  isEnabled(): boolean {
    return this.state === "playing" || this.state === "loading" || this.state === "suspended";
  }

  isUserMuted(): boolean {
    return this.userMuted;
  }

  enableFromGesture(): Promise<boolean> {
    if (this.userMuted) return Promise.resolve(false);
    if (this.state === "playing") return Promise.resolve(true);
    if (this.enableAttempt) return this.enableAttempt;

    try {
      this.ensureGraph();
    } catch (error) {
      console.warn("The local music graph could not be created", error);
      this.setState("armed");
      return Promise.resolve(false);
    }

    if (!this.context || !this.masterGain || !this.elements || !this.elementGains) {
      this.setState("armed");
      return Promise.resolve(false);
    }

    this.setState("loading");

    const active = this.elements[this.activeTrack];
    const inactive = this.elements[1 - this.activeTrack];
    inactive.pause();
    this.elementGains[this.activeTrack].gain.value = 1;
    this.elementGains[1 - this.activeTrack].gain.value = 0;

    // Both calls must be issued synchronously while the click/touch activation
    // is still live. Awaiting resume() before play() breaks media activation in
    // Safari and in stricter Chromium autoplay configurations.
    let resumePromise: Promise<void>;
    let playbackPromise: Promise<void>;
    try {
      resumePromise = this.context.resume();
      playbackPromise = active.play();
    } catch (error) {
      reportAudioWarning("The local music track could not start", error);
      this.setState(this.userMuted ? "muted" : "armed");
      return Promise.resolve(false);
    }

    const attempt = Promise.all([resumePromise, playbackPromise])
      .then(() => {
        if (this.userMuted) {
          active.pause();
          this.setState("muted");
          return false;
        }

        const now = this.context!.currentTime;
        this.masterGain!.gain.cancelScheduledValues(now);
        this.masterGain!.gain.setValueAtTime(0, now);
        this.masterGain!.gain.linearRampToValueAtTime(1, now + 1.2);
        this.setState("playing");
        this.startCrossfadeMonitor();
        this.setProgress(this.progress);
        return true;
      })
      .catch((error) => {
        reportAudioWarning("The local music track could not start", error);
        active.pause();
        // A browser-policy or transient media failure is not the same thing as
        // an explicit user mute. Return to "armed" so a later trusted gesture
        // can retry instead of permanently locking this visit to MUSIC OFF.
        this.setState(this.userMuted ? "muted" : "armed");
        return false;
      })
      .finally(() => {
        if (this.enableAttempt === attempt) this.enableAttempt = null;
      });

    this.enableAttempt = attempt;
    return attempt;
  }

  async setMuted(value: boolean): Promise<void> {
    if (!value) {
      this.userMuted = false;
      await this.enableFromGesture();
      return;
    }

    this.userMuted = true;
    if (this.context && this.masterGain) {
      const now = this.context.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setTargetAtTime(0, now, 0.09);
    }
    this.elements?.forEach((element) => element.pause());
    this.stopCrossfadeMonitor();
    this.setState("muted");
  }

  setProgress(progress: number): void {
    const nextProgress = clamp01(progress);
    const previousProgress = this.previousProgress;
    this.previousProgress = nextProgress;
    this.progress = nextProgress;

    if (this.orbitMode) return;

    if (this.context && this.musicFilter && this.musicGain) {
      const mix = interpolateMix(nextProgress);
      const testScan = windowPulse(nextProgress, 0.315, 0.04);
      const protectCut = windowPulse(nextProgress, 0.622, 0.028);
      const finaleSprint = windowPulse(nextProgress, 0.932, 0.05);
      const frequency = Math.max(
        420,
        mix.frequency + testScan * 900 + finaleSprint * 1800 - protectCut * (mix.frequency - 540),
      );
      const gain = MUSIC_MASTER_GAIN * mix.gain * (1 - protectCut * 0.72);
      const now = this.context.currentTime;
      this.musicFilter.frequency.setTargetAtTime(frequency, now, protectCut > 0.05 ? 0.035 : 0.11);
      this.musicFilter.Q.setTargetAtTime(mix.resonance + testScan * 1.1 + protectCut * 2.3, now, 0.08);
      this.musicGain.gain.setTargetAtTime(gain, now, protectCut > 0.05 ? 0.04 : 0.14);
    }

    if (previousProgress === null) {
      this.syncCueZones(nextProgress);
      return;
    }

    const delta = nextProgress - previousProgress;
    const direction = delta < 0 ? -1 : 1;
    const isContinuousMove = Math.abs(delta) > 0.00001 && Math.abs(delta) < 0.12;
    const now = this.context?.currentTime ?? 0;

    for (const cue of CUE_WINDOWS) {
      const state = this.cueStates[cue.name];
      const entered = !state.inside && nextProgress >= cue.start && nextProgress <= cue.end;
      const crossed = direction > 0
        ? previousProgress < cue.trigger && nextProgress >= cue.trigger
        : previousProgress > cue.trigger && nextProgress <= cue.trigger;
      const cueReady = now - state.lastTriggeredAt >= cue.cooldown && now - this.lastGlobalCueAt >= 0.14;

      if (this.state === "playing" && isContinuousMove && cueReady && (entered || crossed)) {
        this.playCue(cue.name, direction, now);
        state.lastTriggeredAt = now;
        this.lastGlobalCueAt = now;
        state.inside = true;
      }

      if (nextProgress >= cue.start && nextProgress <= cue.end) {
        state.inside = true;
      } else if (nextProgress < cue.start - 0.012 || nextProgress > cue.end + 0.012) {
        state.inside = false;
      }
    }
  }

  setOrbitMode(active: boolean): void {
    this.orbitMode = active;
    if (!this.context || !this.musicFilter || !this.musicGain) return;
    const now = this.context.currentTime;
    if (active) {
      this.musicFilter.frequency.setTargetAtTime(6800, now, 0.28);
      this.musicFilter.Q.setTargetAtTime(1.9, now, 0.22);
      this.musicGain.gain.setTargetAtTime(MUSIC_MASTER_GAIN * 0.88, now, 0.35);
      if (this.state === "playing") {
        this.scheduleTone(now + 0.04, 0.62, 48, 182, "sine", 0.062, 1, 0.025);
        this.scheduleNoise(now + 0.12, 0.52, 260, 2800, 0.035, 1, 3.6);
      }
    } else {
      this.setProgress(this.progress);
    }
  }

  playOrbitLock(kind: "focus" | "select" | "step" | "submit" = "focus"): void {
    if (this.state !== "playing" || !this.context) return;
    const now = this.context.currentTime;
    if (kind === "focus") {
      this.scheduleTone(now, 0.12, 138, 210, "triangle", 0.026, 1, 0.008);
      return;
    }
    if (kind === "select") {
      this.scheduleTone(now, 0.2, 185, 420, "sine", 0.038, 1, 0.012);
      this.scheduleTone(now + 0.055, 0.16, 360, 720, "triangle", 0.024, 1, 0.008);
      return;
    }
    if (kind === "step") {
      this.scheduleTone(now, 0.24, 110, 320, "sine", 0.04, 1, 0.014);
      this.scheduleNoise(now + 0.05, 0.18, 900, 2500, 0.024, 1, 5.2);
      return;
    }
    this.scheduleNoise(now, 0.72, 180, 5400, 0.065, 1, 3.3);
    this.scheduleTone(now + 0.06, 0.68, 58, 260, "sine", 0.078, 1, 0.025);
  }

  async suspend(): Promise<void> {
    if (!this.context || this.state === "suspended") return;
    this.resumeAfterSuspend = this.state === "playing" || this.state === "loading";
    if (!this.resumeAfterSuspend) return;

    this.elements?.forEach((element) => element.pause());
    this.stopCrossfadeMonitor();
    await this.context.suspend();
    this.setState("suspended");
  }

  async resume(): Promise<void> {
    if (!this.context || !this.resumeAfterSuspend || this.userMuted || !this.elements || !this.masterGain) return;
    this.resumeAfterSuspend = false;
    try {
      await this.context.resume();
      await this.elements[this.activeTrack].play();
      const now = this.context.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setValueAtTime(0, now);
      this.masterGain.gain.linearRampToValueAtTime(1, now + 0.65);
      this.setState("playing");
      this.startCrossfadeMonitor();
    } catch (error) {
      reportAudioWarning("Music resume was blocked", error);
      this.setState(this.userMuted ? "muted" : "armed");
    }
  }

  destroy(): void {
    this.stopCrossfadeMonitor();
    this.elements?.forEach((element) => {
      element.pause();
      element.removeAttribute("src");
      element.load();
    });
    this.sourceNodes?.forEach((source) => source.disconnect());
    this.elementGains?.forEach((gain) => gain.disconnect());
    this.musicFilter?.disconnect();
    this.musicGain?.disconnect();
    this.cueGain?.disconnect();
    this.masterGain?.disconnect();
    void this.context?.close();
  }

  private ensureElements(): void {
    if (this.elements) return;
    const createTrack = () => {
      const audio = new Audio(MUSIC_URL);
      audio.preload = "auto";
      audio.loop = false;
      audio.setAttribute("playsinline", "");
      audio.load();
      return audio;
    };
    this.elements = [createTrack(), createTrack()];
  }

  private ensureGraph(): void {
    if (this.context) return;
    this.ensureElements();
    if (!this.elements) return;

    this.context = new AudioContext({ latencyHint: "interactive" });
    this.masterGain = this.context.createGain();
    this.masterGain.gain.value = 0;
    this.masterGain.connect(this.context.destination);

    this.musicGain = this.context.createGain();
    this.musicGain.gain.value = MUSIC_MASTER_GAIN * MUSIC_MIX[0].gain;

    const compressor = this.context.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 12;
    compressor.ratio.value = 3;
    compressor.attack.value = 0.006;
    compressor.release.value = 0.32;

    this.musicFilter = this.context.createBiquadFilter();
    this.musicFilter.type = "lowpass";
    this.musicFilter.frequency.value = MUSIC_MIX[0].frequency;
    this.musicFilter.Q.value = MUSIC_MIX[0].resonance;
    this.musicFilter.connect(compressor).connect(this.musicGain).connect(this.masterGain);

    const gains: [GainNode, GainNode] = [this.context.createGain(), this.context.createGain()];
    gains[0].gain.value = 1;
    gains[1].gain.value = 0;
    const sources: [MediaElementAudioSourceNode, MediaElementAudioSourceNode] = [
      this.context.createMediaElementSource(this.elements[0]),
      this.context.createMediaElementSource(this.elements[1]),
    ];
    sources.forEach((source, index) => source.connect(gains[index]).connect(this.musicFilter!));
    this.elementGains = gains;
    this.sourceNodes = sources;

    this.cueGain = this.context.createGain();
    this.cueGain.gain.value = 0.82;
    this.cueGain.connect(this.masterGain);

    const noiseBuffer = this.context.createBuffer(1, this.context.sampleRate * 2, this.context.sampleRate);
    const noise = noiseBuffer.getChannelData(0);
    let noiseSeed = 0x45a1f2d3;
    for (let index = 0; index < noise.length; index += 1) {
      noiseSeed = (Math.imul(noiseSeed, 1664525) + 1013904223) | 0;
      noise[index] = ((noiseSeed >>> 0) / 0xffffffff * 2 - 1) * 0.22;
    }
    this.transientNoise = noiseBuffer;
  }

  private startCrossfadeMonitor(): void {
    if (this.crossfadeTimer !== null) return;
    this.crossfadeTimer = window.setInterval(() => this.monitorLoop(), 120);
  }

  private stopCrossfadeMonitor(): void {
    if (this.crossfadeTimer !== null) window.clearInterval(this.crossfadeTimer);
    if (this.crossfadeFinishTimer !== null) window.clearTimeout(this.crossfadeFinishTimer);
    this.crossfadeTimer = null;
    this.crossfadeFinishTimer = null;
    this.crossfading = false;
  }

  private monitorLoop(): void {
    if (this.crossfading || this.state !== "playing" || !this.elements) return;
    const active = this.elements[this.activeTrack];
    if (!Number.isFinite(active.duration) || active.duration <= CROSSFADE_SECONDS + 1) return;
    const remaining = active.duration - active.currentTime;
    if (remaining <= CROSSFADE_SECONDS + 0.08 && remaining > 0.08) {
      void this.beginCrossfade(Math.max(0.6, Math.min(CROSSFADE_SECONDS, remaining)));
    }
  }

  private async beginCrossfade(duration: number): Promise<void> {
    if (!this.context || !this.elements || !this.elementGains || this.crossfading) return;
    this.crossfading = true;
    const fromIndex = this.activeTrack;
    const toIndex = 1 - fromIndex;
    const from = this.elements[fromIndex];
    const to = this.elements[toIndex];
    const fromGain = this.elementGains[fromIndex].gain;
    const toGain = this.elementGains[toIndex].gain;
    to.currentTime = 0;

    try {
      await to.play();
    } catch (error) {
      console.warn("Seamless music loop fell back to native looping", error);
      from.loop = true;
      this.crossfading = false;
      return;
    }

    const now = this.context.currentTime;
    const samples = 64;
    const fadeOut = new Float32Array(samples);
    const fadeIn = new Float32Array(samples);
    for (let index = 0; index < samples; index += 1) {
      const amount = index / (samples - 1);
      fadeOut[index] = Math.cos(amount * Math.PI * 0.5);
      fadeIn[index] = Math.sin(amount * Math.PI * 0.5);
    }
    fromGain.cancelScheduledValues(now);
    toGain.cancelScheduledValues(now);
    fromGain.setValueCurveAtTime(fadeOut, now, duration);
    toGain.setValueCurveAtTime(fadeIn, now, duration);

    this.crossfadeFinishTimer = window.setTimeout(() => {
      from.pause();
      from.currentTime = 0;
      fromGain.value = 0;
      toGain.value = 1;
      this.activeTrack = toIndex;
      this.crossfading = false;
      this.crossfadeFinishTimer = null;
    }, duration * 1000 + 60);
  }

  private syncCueZones(progress: number): void {
    for (const cue of CUE_WINDOWS) {
      this.cueStates[cue.name].inside = progress >= cue.start && progress <= cue.end;
    }
  }

  private playCue(name: CueName, direction: number, now: number): void {
    if (name === "test") {
      this.scheduleTone(now, 0.27, 1320, 330, "sine", 0.052, direction, 0.012);
      this.scheduleTone(now + 0.025, 0.14, 240, 92, "triangle", 0.038, direction, 0.006);
      this.scheduleNoise(now, 0.25, 2700, 760, 0.042, direction, 7.5);
      return;
    }

    if (name === "protect") {
      this.scheduleNoise(now, 0.44, 5600, 280, 0.092, direction, 4.8);
      this.scheduleTone(now, 0.48, 195, 48, "sawtooth", 0.068, direction, 0.008);
      this.scheduleTone(now + 0.035, 0.21, 780, 150, "square", 0.02, direction, 0.004);
      return;
    }

    this.scheduleNoise(now, 0.56, 360, 6200, 0.074, direction, 3.1);
    this.scheduleTone(now, 0.58, 52, 235, "sine", 0.078, direction, 0.032);
    this.scheduleTone(now + 0.08, 0.31, 135, 880, "triangle", 0.036, direction, 0.018);
  }

  private scheduleTone(
    when: number,
    duration: number,
    forwardStartFrequency: number,
    forwardEndFrequency: number,
    type: OscillatorType,
    peak: number,
    direction: number,
    attack: number,
  ): void {
    if (!this.context || !this.cueGain) return;
    const oscillator = this.context.createOscillator();
    const toneFilter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    const startFrequency = direction >= 0 ? forwardStartFrequency : forwardEndFrequency;
    const endFrequency = direction >= 0 ? forwardEndFrequency : forwardStartFrequency;
    const releaseAt = when + duration;

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(Math.max(20, startFrequency), when);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), releaseAt);
    toneFilter.type = "lowpass";
    toneFilter.frequency.value = Math.max(900, Math.max(startFrequency, endFrequency) * 2.4);
    toneFilter.Q.value = 0.8;
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), when + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, releaseAt);
    oscillator.connect(toneFilter).connect(gain).connect(this.cueGain);
    oscillator.start(when);
    oscillator.stop(releaseAt + 0.04);
    oscillator.addEventListener("ended", () => {
      oscillator.disconnect();
      toneFilter.disconnect();
      gain.disconnect();
    }, { once: true });
  }

  private scheduleNoise(
    when: number,
    duration: number,
    forwardStartFrequency: number,
    forwardEndFrequency: number,
    peak: number,
    direction: number,
    resonance: number,
  ): void {
    if (!this.context || !this.cueGain || !this.transientNoise) return;
    const source = this.context.createBufferSource();
    const band = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    const startFrequency = direction >= 0 ? forwardStartFrequency : forwardEndFrequency;
    const endFrequency = direction >= 0 ? forwardEndFrequency : forwardStartFrequency;
    const releaseAt = when + duration;

    source.buffer = this.transientNoise;
    band.type = "bandpass";
    band.frequency.setValueAtTime(Math.max(40, startFrequency), when);
    band.frequency.exponentialRampToValueAtTime(Math.max(40, endFrequency), releaseAt);
    band.Q.value = resonance;
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), when + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, releaseAt);
    source.connect(band).connect(gain).connect(this.cueGain);
    source.start(when);
    source.stop(releaseAt + 0.04);
    source.addEventListener("ended", () => {
      source.disconnect();
      band.disconnect();
      gain.disconnect();
    }, { once: true });
  }

  private setState(state: AudioDirectorState): void {
    if (state === this.state) return;
    this.state = state;
    this.onStateChange?.(state);
  }
}
