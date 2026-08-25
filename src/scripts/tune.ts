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

  // --- scale ---
  scaleDegrees: [0, 3, 5, 7, 10], // C minor pentatonic
  baseMidi: 48, // C3
  octaves: 2.5,
} as const;
