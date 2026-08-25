/**
 * The voice graph. One AudioContext, lazily created on the first gesture so
 * that gesture both unlocks audio and sounds the first note — no "click to
 * enable" step. See plan.md §5.
 *
 *   per voice: osc(fundamental) + osc(detuned harmonic)
 *              -> gain envelope -> lowpass filter -> stereo panner -> bus
 *   bus -> analyser (visual reactivity only)
 *   bus -> master gain -> compressor -> destination
 *   bus -> delay -> lowpass feedback -> delay (loop) -> wet gain -> master
 */
import { TUNE } from "./tune";

interface LegacyWindow {
  webkitAudioContext?: typeof AudioContext;
}

interface Voice {
  osc1: OscillatorNode;
  osc2: OscillatorNode;
  filter: BiquadFilterNode;
  panner: StereoPannerNode;
  env: GainNode;
  midi: number;
  cutoffHz: number;
  startedAt: number;
  stopped: boolean;
}

let ctx: AudioContext | null = null;
let voiceBus: GainNode | null = null;
let analyser: AnalyserNode | null = null;
const voices = new Map<string, Voice>();

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** Creates the graph on first use. Idempotent — safe to call every gesture. */
export function ensureAudio(): AudioContext {
  if (ctx) return ctx;

  const Ctor = window.AudioContext ?? (window as unknown as LegacyWindow).webkitAudioContext;
  if (!Ctor) throw new Error("Web Audio API is not supported in this browser.");
  const audioCtx = new Ctor();

  const compressor = audioCtx.createDynamicsCompressor();
  compressor.connect(audioCtx.destination);

  const master = audioCtx.createGain();
  master.gain.value = TUNE.masterGain;
  master.connect(compressor);

  const bus = audioCtx.createGain();
  bus.connect(master);

  const analyserNode = audioCtx.createAnalyser();
  analyserNode.fftSize = 256;
  analyserNode.smoothingTimeConstant = 0.75;
  bus.connect(analyserNode);

  // The only effect: a feedback delay with a lowpass in its loop, which does
  // most of the "liquid space" work without the cost of convolution reverb.
  const delay = audioCtx.createDelay(1);
  delay.delayTime.value = TUNE.delayTimeSec;
  const feedbackFilter = audioCtx.createBiquadFilter();
  feedbackFilter.type = "lowpass";
  feedbackFilter.frequency.value = TUNE.delayFeedbackLowpassHz;
  const feedback = audioCtx.createGain();
  feedback.gain.value = TUNE.delayFeedback;
  const wet = audioCtx.createGain();
  wet.gain.value = TUNE.delayWet;

  bus.connect(delay);
  delay.connect(feedbackFilter);
  feedbackFilter.connect(feedback);
  feedback.connect(delay);
  delay.connect(wet);
  wet.connect(master);

  ctx = audioCtx;
  voiceBus = bus;
  analyser = analyserNode;
  void audioCtx.resume();
  return audioCtx;
}

export function getAnalyser(): AnalyserNode | null {
  return analyser;
}

export function getActiveVoiceCount(): number {
  return voices.size;
}

export function getVoiceSnapshot(id: string): { midi: number; cutoffHz: number } | undefined {
  const voice = voices.get(id);
  return voice ? { midi: voice.midi, cutoffHz: voice.cutoffHz } : undefined;
}

// --- music utilities -------------------------------------------------------
// Kept in one place, deliberately, rather than scattered through gesture or
// render code (plan.md §5/§6).

/** Quantised pitch from a normalised horizontal position (0..1). */
export function midiForNormalizedX(normX: number): number {
  const degrees = TUNE.scaleDegrees.length;
  const totalSteps = Math.max(1, Math.round(TUNE.octaves * degrees));
  const step = clamp(Math.floor(normX * totalSteps), 0, totalSteps - 1);
  const octave = Math.floor(step / degrees);
  const degree = TUNE.scaleDegrees[step % degrees] ?? 0;
  return TUNE.baseMidi + octave * 12 + degree;
}

export function frequencyForMidi(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/** Exponential map so the perceived brightness change feels linear. */
export function cutoffForBrightness(brightness01: number): number {
  const b = clamp(brightness01, 0, 1);
  return TUNE.cutoffLowHz * (TUNE.cutoffHighHz / TUNE.cutoffLowHz) ** b;
}

// --- voice lifecycle --------------------------------------------------------

export interface VoiceTarget {
  midi: number;
  cutoffHz: number;
  pan: number;
  /** 0..1, drives harmonic richness and how sharply pitch/filter glide. */
  energy: number;
}

export function startVoice(id: string, target: VoiceTarget): void {
  const audioCtx = ensureAudio();
  if (voices.has(id)) return;
  if (voices.size >= TUNE.maxVoices) return;

  const now = audioCtx.currentTime;
  const freq = frequencyForMidi(target.midi);

  const filter = audioCtx.createBiquadFilter();
  filter.type = "lowpass";
  filter.Q.value = TUNE.filterQ;
  filter.frequency.setValueAtTime(target.cutoffHz, now);

  const panner = audioCtx.createStereoPanner();
  panner.pan.setValueAtTime(clamp(target.pan, -1, 1), now);

  const env = audioCtx.createGain();
  env.gain.setValueAtTime(0, now);
  // Ramped, never instant: an unramped gain jump is the click that makes a
  // browser synth sound cheap.
  env.gain.linearRampToValueAtTime(1, now + TUNE.attackSec);

  filter.connect(panner);
  panner.connect(env);
  if (voiceBus) env.connect(voiceBus);

  const osc1 = audioCtx.createOscillator();
  osc1.type = "triangle";
  osc1.frequency.setValueAtTime(freq, now);

  const osc2 = audioCtx.createOscillator();
  osc2.type = "sine";
  osc2.frequency.setValueAtTime(freq, now);
  osc2.detune.setValueAtTime(TUNE.detuneCents, now);

  const harmonicGain = audioCtx.createGain();
  harmonicGain.gain.setValueAtTime(0.15 + target.energy * 0.2, now);
  osc1.connect(filter);
  osc2.connect(harmonicGain);
  harmonicGain.connect(filter);

  osc1.start(now);
  osc2.start(now);

  voices.set(id, {
    osc1,
    osc2,
    filter,
    panner,
    env,
    midi: target.midi,
    cutoffHz: target.cutoffHz,
    startedAt: now,
    stopped: false,
  });
}

export function updateVoice(id: string, target: VoiceTarget): void {
  const voice = voices.get(id);
  const audioCtx = ctx;
  if (!voice || !audioCtx || voice.stopped) return;

  const now = audioCtx.currentTime;
  const freq = frequencyForMidi(target.midi);

  // Fast gestures snap between notes; slow ones glide — a fixed glide time
  // would smear a fast swipe across every scale step it crosses.
  const glideMs = TUNE.glideMaxMs - (TUNE.glideMaxMs - TUNE.glideMinMs) * clamp(target.energy, 0, 1);
  const glideSec = glideMs / 1000;

  if (voice.midi !== target.midi) {
    voice.osc1.frequency.cancelScheduledValues(now);
    voice.osc1.frequency.setValueAtTime(voice.osc1.frequency.value, now);
    voice.osc1.frequency.linearRampToValueAtTime(freq, now + glideSec);
    voice.osc2.frequency.cancelScheduledValues(now);
    voice.osc2.frequency.setValueAtTime(voice.osc2.frequency.value, now);
    voice.osc2.frequency.linearRampToValueAtTime(freq, now + glideSec);
    voice.midi = target.midi;
  }

  voice.filter.frequency.cancelScheduledValues(now);
  voice.filter.frequency.setTargetAtTime(target.cutoffHz, now, 0.05);
  voice.cutoffHz = target.cutoffHz;

  voice.panner.pan.setTargetAtTime(clamp(target.pan, -1, 1), now, 0.08);
}

export function releaseVoice(id: string): void {
  const voice = voices.get(id);
  const audioCtx = ctx;
  if (!voice || !audioCtx || voice.stopped) return;
  voice.stopped = true;

  const now = audioCtx.currentTime;
  const heldFor = now - voice.startedAt;
  // A tone that settled releases slower than a quick tap.
  const releaseSec =
    TUNE.releaseMinSec + (TUNE.releaseMaxSec - TUNE.releaseMinSec) * clamp(heldFor / 2, 0, 1);

  voice.env.gain.cancelScheduledValues(now);
  voice.env.gain.setValueAtTime(voice.env.gain.value, now);
  voice.env.gain.linearRampToValueAtTime(0, now + releaseSec);

  const stopAt = now + releaseSec + 0.05;
  voice.osc1.stop(stopAt);
  voice.osc2.stop(stopAt);
  voice.osc1.onended = () => {
    voice.osc1.disconnect();
    voice.osc2.disconnect();
    voice.filter.disconnect();
    voice.panner.disconnect();
    voice.env.disconnect();
    voices.delete(id);
  };
}

/** The stuck-note safety net: force every voice off, e.g. on blur/hidden. */
export function releaseAllVoices(): void {
  for (const id of [...voices.keys()]) releaseVoice(id);
}
