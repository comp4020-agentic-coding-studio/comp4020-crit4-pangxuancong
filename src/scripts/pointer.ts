/**
 * Pointer + keyboard input, one gesture model for both. A gesture's position
 * drives pitch (x) and brightness (y); its smoothed velocity drives energy
 * and a rolling pan average that follows the gesture's *direction*, not its
 * absolute position — see plan.md §3 for why pan and pitch aren't bound to
 * the same axis.
 *
 * Also owns the stuck-note safety net (plan.md §4): pointercancel, blur, and
 * visibilitychange all force-release every voice, so nothing drones on
 * unattended.
 */
import { TUNE } from "./tune";
import {
  cutoffForBrightness,
  midiForNormalizedX,
  releaseAllVoices,
  releaseVoice,
  startVoice,
  updateVoice,
  type VoiceTarget,
} from "./audio";

const KEYS = "asdfghjk";

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

function energyForSpeed(speed: number): number {
  return smoothstep(0, 1, clamp(speed / TUNE.targetSpeed, 0, 1));
}

interface Gesture {
  x: number; // normalized 0..1
  y: number;
  lastX: number;
  lastY: number;
  lastT: number;
  startedAt: number;
  speed: number; // smoothed px/s — raw per-event velocity is too noisy to use directly
  vx: number; // normalized units/s, direction only — feeds particle drift
  vy: number;
  distanceAccum: number; // normalized path length, to tell a tap from a drag
  sparkledFast: boolean; // debounces the velocity-threshold sparkle
  pan: number; // rolling average, follows gesture direction rather than position
  brightness: number; // 0..1, 1 = bright/top; the single source both audio and visuals read
  midi: number;
}

export interface SparkleEvent {
  x: number;
  y: number;
  vx: number;
  vy: number;
  brightness: number;
  energy: number;
  /** 0..1 — a tap ("droplet") is a bigger burst than a threshold crossing or note change. */
  boost: number;
}

const sparkleQueue: SparkleEvent[] = [];

export interface RenderPoint {
  x: number;
  y: number;
  brightness: number;
  energy: number;
}

const gestures = new Map<string, Gesture>();
const ghosts = new Map<
  string,
  { x: number; y: number; brightness: number; energy: number; releasedAt: number }
>();

let canvasEl: HTMLCanvasElement | null = null;
let firstInteractionFired = false;
let onFirstInteraction: (() => void) | null = null;

function targetFor(g: Gesture): VoiceTarget {
  return {
    midi: g.midi,
    cutoffHz: cutoffForBrightness(g.brightness),
    pan: g.pan,
    energy: energyForSpeed(g.speed),
  };
}

function fireFirstInteraction(): void {
  if (firstInteractionFired) return;
  firstInteractionFired = true;
  onFirstInteraction?.();
}

function normalizedFromClient(clientX: number, clientY: number): { nx: number; ny: number } {
  if (!canvasEl) return { nx: 0.5, ny: 0.5 };
  const rect = canvasEl.getBoundingClientRect();
  return {
    nx: clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1),
    ny: clamp((clientY - rect.top) / Math.max(1, rect.height), 0, 1),
  };
}

function beginGesture(id: string, nx: number, ny: number, now: number): void {
  if (gestures.has(id)) return;
  fireFirstInteraction();

  const gesture: Gesture = {
    x: nx,
    y: ny,
    lastX: nx,
    lastY: ny,
    lastT: now,
    startedAt: now,
    speed: 0,
    vx: 0,
    vy: 0,
    distanceAccum: 0,
    sparkledFast: false,
    pan: 0,
    brightness: 1 - ny,
    midi: midiForNormalizedX(nx),
  };
  gestures.set(id, gesture);
  startVoice(id, targetFor(gesture));
}

function moveGesture(id: string, nx: number, ny: number, now: number): void {
  const gesture = gestures.get(id);
  if (!gesture) return;

  const dt = Math.max(0.001, (now - gesture.lastT) / 1000);
  const dx = nx - gesture.lastX;
  const dy = ny - gesture.lastY;
  const rawSpeed = Math.hypot(dx, dy) / dt;
  // Screen-space speed, not normalized — otherwise a small viewport would
  // read every gesture as "fast".
  const rawSpeedPx = rawSpeed * Math.max(canvasEl?.clientWidth ?? 1, canvasEl?.clientHeight ?? 1);
  gesture.speed += (rawSpeedPx - gesture.speed) * 0.35;
  gesture.vx = dx / dt;
  gesture.vy = dy / dt;
  gesture.distanceAccum += Math.hypot(dx, dy);

  const panTarget = clamp((nx - gesture.lastX) / dt, -1, 1) * TUNE.panRange;
  gesture.pan += (panTarget - gesture.pan) * 0.15;

  const previousMidi = gesture.midi;
  gesture.lastX = nx;
  gesture.lastY = ny;
  gesture.lastT = now;
  gesture.x = nx;
  gesture.y = ny;
  gesture.brightness = 1 - ny;
  gesture.midi = midiForNormalizedX(nx);

  const energy = energyForSpeed(gesture.speed);

  // A fast pass sparkles once per crossing, not once per frame above it.
  if (gesture.speed >= TUNE.sparkleThreshold) {
    if (!gesture.sparkledFast) {
      gesture.sparkledFast = true;
      queueSparkle(gesture, energy, energy);
    }
  } else if (gesture.speed < TUNE.sparkleThreshold * 0.6) {
    gesture.sparkledFast = false;
  }

  if (gesture.midi !== previousMidi && energy >= TUNE.sparkleNoteChangeThreshold) {
    queueSparkle(gesture, energy, 0.3);
  }

  updateVoice(id, targetFor(gesture));
}

function queueSparkle(gesture: Gesture, energy: number, boost: number): void {
  sparkleQueue.push({
    x: gesture.x,
    y: gesture.y,
    vx: gesture.vx,
    vy: gesture.vy,
    brightness: gesture.brightness,
    energy,
    boost,
  });
}

function endGesture(id: string): void {
  const gesture = gestures.get(id);
  if (!gesture) return;
  gestures.delete(id);
  releaseVoice(id);

  // A short, mostly-still press-release reads as a tap — a bigger "droplet"
  // burst than the sparkles a drag seeds along the way.
  const heldFor = performance.now() - gesture.startedAt;
  if (heldFor < 180 && gesture.distanceAccum < 0.02) {
    queueSparkle(gesture, 0.4, 1);
  }

  ghosts.set(id, {
    x: gesture.x,
    y: gesture.y,
    brightness: gesture.brightness,
    energy: energyForSpeed(gesture.speed),
    releasedAt: performance.now(),
  });
}

export function drainSparkleEvents(): SparkleEvent[] {
  const events = sparkleQueue.splice(0, sparkleQueue.length);
  return events;
}

/** Force every gesture and voice off — the stuck-note safety net. */
function forceReleaseAll(): void {
  for (const id of [...gestures.keys()]) endGesture(id);
  releaseAllVoices();
}

function beginKeyboardNote(key: string, now: number): void {
  const index = KEYS.indexOf(key);
  if (index < 0) return;
  const id = `k:${key}`;
  if (gestures.has(id)) return;
  fireFirstInteraction();

  const degrees = TUNE.scaleDegrees.length;
  const midi =
    TUNE.baseMidi + (TUNE.scaleDegrees[index % degrees] ?? 0) + Math.floor(index / degrees) * 12;
  const nx = KEYS.length > 1 ? index / (KEYS.length - 1) : 0.5;
  const brightness = 0.5;

  const gesture: Gesture = {
    x: nx,
    y: 1 - brightness,
    lastX: nx,
    lastY: 1 - brightness,
    lastT: now,
    startedAt: now,
    speed: 0,
    vx: 0,
    vy: 0,
    distanceAccum: 1, // never reads as a tap — keyboard notes don't sparkle on release
    sparkledFast: false,
    pan: 0,
    brightness,
    midi,
  };
  gestures.set(id, gesture);
  startVoice(id, targetFor(gesture));
}

function nudgeBrightness(id: string, delta: number): void {
  const gesture = gestures.get(id);
  if (!gesture) return;
  gesture.brightness = clamp(gesture.brightness + delta, 0, 1);
  updateVoice(id, targetFor(gesture));
}

export function initPointerInput(canvas: HTMLCanvasElement, opts: { onFirstInteraction: () => void }): void {
  canvasEl = canvas;
  onFirstInteraction = opts.onFirstInteraction;

  canvas.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    const { nx, ny } = normalizedFromClient(event.clientX, event.clientY);
    beginGesture(`p:${event.pointerId}`, nx, ny, performance.now());
  });

  canvas.addEventListener("pointermove", (event) => {
    const id = `p:${event.pointerId}`;
    if (!gestures.has(id)) return;
    const { nx, ny } = normalizedFromClient(event.clientX, event.clientY);
    moveGesture(id, nx, ny, performance.now());
  });

  const lift = (event: PointerEvent): void => endGesture(`p:${event.pointerId}`);
  canvas.addEventListener("pointerup", lift);
  canvas.addEventListener("pointercancel", lift);

  window.addEventListener("keydown", (event) => {
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key.toLowerCase();

    if (key === "arrowup" || key === "arrowdown") {
      event.preventDefault();
      const delta = key === "arrowup" ? 0.08 : -0.08;
      for (const id of gestures.keys()) {
        if (id.startsWith("k:")) nudgeBrightness(id, delta);
      }
      return;
    }

    if (KEYS.includes(key)) {
      event.preventDefault();
      beginKeyboardNote(key, performance.now());
    }
  });

  window.addEventListener("keyup", (event) => {
    const key = event.key.toLowerCase();
    if (KEYS.includes(key)) endGesture(`k:${key}`);
  });

  window.addEventListener("blur", forceReleaseAll);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) forceReleaseAll();
  });
}

export function getRenderPoints(nowMs: number): RenderPoint[] {
  const points: RenderPoint[] = [];

  for (const gesture of gestures.values()) {
    points.push({
      x: gesture.x,
      y: gesture.y,
      brightness: gesture.brightness,
      energy: energyForSpeed(gesture.speed),
    });
  }

  for (const [id, ghost] of ghosts) {
    const age = (nowMs - ghost.releasedAt) / 1000;
    if (age >= TUNE.ghostDecaySec) {
      ghosts.delete(id);
      continue;
    }
    const life = 1 - age / TUNE.ghostDecaySec;
    points.push({
      x: ghost.x,
      y: ghost.y,
      brightness: ghost.brightness,
      energy: ghost.energy * life * 0.6,
    });
  }

  return points;
}

export interface DebugGesture {
  id: string;
  nx: number;
  ny: number;
  speed: number;
  midi: number;
}

export function getDebugGestures(): DebugGesture[] {
  return [...gestures.entries()].map(([id, g]) => ({
    id,
    nx: g.x,
    ny: g.y,
    speed: g.speed,
    midi: g.midi,
  }));
}
