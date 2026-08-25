/**
 * Every value worth adjusting by ear or by eye. Nothing tunable lives outside
 * this file — see plan.md's "Working rules": this is the tuning loop, and it
 * belongs to a person listening/watching, not to the agent that wrote it.
 */
export const TUNE = {
  // --- audio ---
  cutoffLowHz: 300,
  cutoffHighHz: 8000,
  filterQ: 0.9,
  detuneCents: 6,
  attackSec: 0.05,
  releaseMinSec: 0.3,
  releaseMaxSec: 1.2,
  glideMinMs: 30,
  glideMaxMs: 100,
  panRange: 0.3,
  delayTimeSec: 0.22,
  delayFeedback: 0.3,
  delayFeedbackLowpassHz: 2500,
  delayWet: 0.22,
  masterGain: 0.22,
  maxVoices: 5,
  targetSpeed: 1800, // px/s treated as "fast" for energy/glide/pan
  reverbSeconds: 2.2,
  reverbDecay: 3.2,
  reverbWet: 0.16, // kept low — delay + reverb stacked too hot turns to mud
  bandLowMaxHz: 200, // below this: the "large slow pulse" band
  bandMidMaxHz: 2000, // between low and this: the "main flow" band; above: shimmer

  // --- visual ---
  idleCycleSec: 11,
  pointerSmoothing: 0.18,
  wellRadius: 0.22, // fraction of min(viewport dimension)
  hueLow: 235, // indigo — low filter cutoff
  hueHigh: 190, // cyan/icy white — high filter cutoff
  fastHueShift: 285, // violet flash on fast gestures
  sparkleThreshold: 900, // px/s to seed a sparkle
  ghostDecaySec: 1.0,
  reducedMotionScale: 0.35,

  // --- particles (secondary; sparkle only, not the main visual) ---
  sparkleMaxCount: 60,
  sparkleLifetimeMinSec: 0.5,
  sparkleLifetimeMaxSec: 2.0,
  sparkleSize: 2.4,
  sparkleDrift: 40, // px/s-equivalent noise drift in normalized space
  sparkleNoteChangeThreshold: 0.15, // min energy for a note-change to sparkle

  // --- custom cursor ---
  cursorSmoothing: 0.25,

  // --- scale ---
  scaleDegrees: [0, 3, 5, 7, 10], // C minor pentatonic
  baseMidi: 48, // C3
  octaves: 2.5,
} as const;
