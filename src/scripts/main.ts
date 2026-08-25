/**
 * An accumulating looper.
 *
 * Press anywhere: a note sounds immediately, and on release it is committed to
 * a repeating loop that fades out over several cycles. One tap-and-hold carries
 * four dimensions — pitch (y), brightness (x), length (how long you hold), and
 * position in the loop (when you pressed).
 *
 * See plan.md for the design decisions and the constraints this holds to.
 */

// Every value worth adjusting by ear lives here. No magic numbers below this.
const TUNE = {
  loopSeconds: 4,
  attack: 0.015, // too small pops, too large smears
  release: 0.35,
  cutoffLow: 400, // brightness range, Hz
  cutoffHigh: 4000,
  filterQ: 1.1,
  waveform: "triangle" as OscillatorType,
  detune: 7, // cents, thickness of the oscillator pair
  delayFraction: 0.125, // delay time as a fraction of the loop
  delayFeedback: 0.35,
  delayMix: 0.25,
  livesFor: 8, // cycles a note survives before it is dropped
  scale: [0, 2, 4, 7, 9], // pentatonic degrees
  baseMidi: 48,
  octaves: 2,
  masterGain: 0.25,
  voiceGain: 0.5,
  maxVoices: 24,
  maxEvents: 96,
  minDurationSec: 0.08,
  maxDurationFraction: 0.75, // a note longer than this would overlap itself
  lookaheadMs: 25,
  scheduleAheadSec: 0.1,
  flashMs: 200,
  background: "#0b0e14",
  rowColor: "rgba(255, 255, 255, 0.045)",
  playheadColor: "rgba(255, 255, 255, 0.42)",
  hueLow: 196, // pitch maps onto hue across this span
  hueSpan: 128,
  dotRadius: 9,
  liveRadius: 16,
  inviteRadius: 34,
};

const DEGREES = TUNE.octaves * TUNE.scale.length;

interface LoopEvent {
  offsetSec: number;
  degree: number;
  midi: number;
  cutoffHz: number;
  durationSec: number;
  bornCycle: number;
  lastScheduledCycle: number;
  flashedCycle: number;
  flashUntil: number;
}

interface LiveNote {
  degree: number;
  midi: number;
  cutoffHz: number;
  offsetSec: number;
  bornCycle: number;
  startedAt: number;
  x: number;
  y: number;
  release: () => void;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

// --- pitch, brightness and their screen positions ------------------------

function midiForDegree(degree: number): number {
  const step = TUNE.scale[degree % TUNE.scale.length] ?? 0;
  return TUNE.baseMidi + Math.floor(degree / TUNE.scale.length) * 12 + step;
}

function degreeForY(y: number, height: number): number {
  return clamp(Math.floor((1 - y / height) * DEGREES), 0, DEGREES - 1);
}

function yForDegree(degree: number, height: number): number {
  return (1 - (degree + 0.5) / DEGREES) * height;
}

function cutoffForX(x: number, width: number): number {
  return (
    TUNE.cutoffLow + clamp(x / width, 0, 1) * (TUNE.cutoffHigh - TUNE.cutoffLow)
  );
}

function hueForDegree(degree: number): number {
  return TUNE.hueLow + (degree / Math.max(1, DEGREES - 1)) * TUNE.hueSpan;
}

// --- clock ---------------------------------------------------------------

// The playhead sweeps before the first gesture, when there is no AudioContext
// to read a clock from. Run off performance.now() until one exists, then hand
// over to the audio clock without letting the playhead jump.
const pageStart = performance.now();

let audio: AudioContext | null = null;
let voiceBus: GainNode | null = null;
let loopStartTime = 0;
let activeVoices = 0;

function elapsedSeconds(): number {
  return audio
    ? audio.currentTime - loopStartTime
    : (performance.now() - pageStart) / 1000;
}

function loopPosition(): { cycle: number; phase: number } {
  const t = elapsedSeconds();
  return {
    cycle: Math.floor(t / TUNE.loopSeconds),
    phase: (t % TUNE.loopSeconds) / TUNE.loopSeconds,
  };
}

// --- audio graph ---------------------------------------------------------

function ensureAudio(): AudioContext {
  if (audio) return audio;

  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  const ctx = new Ctor();

  const master = ctx.createGain();
  master.gain.value = TUNE.masterGain;
  master.connect(ctx.destination);

  const bus = ctx.createGain();
  bus.connect(master);

  // The feedback delay is the only effect: nothing is fetched, so the first
  // note has nothing to wait for.
  const delay = ctx.createDelay(TUNE.loopSeconds);
  delay.delayTime.value = TUNE.loopSeconds * TUNE.delayFraction;
  const feedback = ctx.createGain();
  feedback.gain.value = TUNE.delayFeedback;
  const mix = ctx.createGain();
  mix.gain.value = TUNE.delayMix;
  bus.connect(delay);
  delay.connect(feedback);
  feedback.connect(delay);
  delay.connect(mix);
  mix.connect(master);

  voiceBus = bus;
  loopStartTime = ctx.currentTime - (performance.now() - pageStart) / 1000;
  audio = ctx;
  void ctx.resume();
  window.setInterval(schedule, TUNE.lookaheadMs);
  return ctx;
}

interface Voice {
  gain: GainNode;
  end: (stopAt: number) => void;
}

function makeVoice(
  ctx: AudioContext,
  when: number,
  midi: number,
  cutoffHz: number,
  peak: number,
): Voice {
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, when);
  if (voiceBus) env.connect(voiceBus);

  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = cutoffHz;
  filter.Q.value = TUNE.filterQ;
  filter.connect(env);

  const hz = 440 * 2 ** ((midi - 69) / 12);
  const lead = ctx.createOscillator();
  const pair = ctx.createOscillator();
  for (const [osc, cents] of [
    [lead, -TUNE.detune],
    [pair, TUNE.detune],
  ] as const) {
    osc.type = TUNE.waveform;
    osc.frequency.value = hz;
    osc.detune.value = cents;
    osc.connect(filter);
    osc.start(when);
  }

  // Never reach full gain instantly: the click that causes is the main reason
  // a browser synth sounds like a toy.
  env.gain.linearRampToValueAtTime(peak, when + TUNE.attack);

  activeVoices += 1;
  let ended = false;
  return {
    gain: env,
    end(stopAt: number) {
      if (ended) return;
      ended = true;
      lead.stop(stopAt);
      pair.stop(stopAt);
      lead.onended = () => {
        activeVoices -= 1;
        lead.disconnect();
        pair.disconnect();
        filter.disconnect();
        env.disconnect();
      };
    },
  };
}

/** A note whose whole envelope is known up front — a loop replay. */
function scheduleVoice(
  ctx: AudioContext,
  when: number,
  event: LoopEvent,
  peak: number,
): void {
  const voice = makeVoice(ctx, when, event.midi, event.cutoffHz, peak);
  const holdUntil = when + Math.max(TUNE.attack, event.durationSec);
  voice.gain.gain.setValueAtTime(peak, holdUntil);
  voice.gain.gain.linearRampToValueAtTime(0, holdUntil + TUNE.release);
  voice.end(holdUntil + TUNE.release + 0.02);
}

/** A note the player is still holding — length is not known yet. */
function startLiveVoice(
  ctx: AudioContext,
  midi: number,
  cutoffHz: number,
): () => void {
  const voice = makeVoice(ctx, ctx.currentTime, midi, cutoffHz, TUNE.voiceGain);
  return () => {
    const now = ctx.currentTime;
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
    voice.gain.gain.linearRampToValueAtTime(0, now + TUNE.release);
    voice.end(now + TUNE.release + 0.02);
  };
}

// --- the loop ------------------------------------------------------------

const events: LoopEvent[] = [];
const live = new Map<string, LiveNote>();

/**
 * Lookahead scheduler. Everything is placed against audio-clock times, never
 * setTimeout, or the rhythm audibly jitters. Guarding on the cycle index is
 * what stops consecutive ticks from scheduling the same occurrence twice.
 */
function schedule(): void {
  const ctx = audio;
  if (!ctx) return;

  const now = ctx.currentTime;
  const horizon = now + TUNE.scheduleAheadSec;

  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (!event) continue;

    let cycle = Math.ceil(
      (now - loopStartTime - event.offsetSec) / TUNE.loopSeconds,
    );
    if (cycle <= event.lastScheduledCycle) cycle = event.lastScheduledCycle + 1;

    const when = loopStartTime + cycle * TUNE.loopSeconds + event.offsetSec;
    if (when > horizon) continue;

    const age = cycle - event.bornCycle;
    if (age >= TUNE.livesFor) {
      events.splice(i, 1);
      continue;
    }

    event.lastScheduledCycle = cycle;
    // The player's own touch always sounds; it is the replays that yield when
    // the graph is busy.
    if (activeVoices >= TUNE.maxVoices) continue;
    scheduleVoice(ctx, when, event, TUNE.voiceGain * (1 - age / TUNE.livesFor));
  }
}

function startNote(
  id: string,
  degree: number,
  cutoffHz: number,
  x: number,
  y: number,
): void {
  if (live.has(id)) return;

  // Creating the context inside the gesture handler is an iOS Safari
  // requirement, and it means the first press is also the first sound: there
  // is no "click to enable audio" step.
  const ctx = ensureAudio();
  const { cycle, phase } = loopPosition();
  const midi = midiForDegree(degree);

  live.set(id, {
    degree,
    midi,
    cutoffHz,
    offsetSec: phase * TUNE.loopSeconds,
    bornCycle: cycle,
    startedAt: ctx.currentTime,
    x,
    y,
    release: startLiveVoice(ctx, midi, cutoffHz),
  });
}

function endNote(id: string): void {
  const note = live.get(id);
  if (!note) return;
  live.delete(id);
  note.release();

  const ctx = audio;
  if (!ctx) return;

  events.push({
    offsetSec: note.offsetSec,
    degree: note.degree,
    midi: note.midi,
    cutoffHz: note.cutoffHz,
    durationSec: clamp(
      ctx.currentTime - note.startedAt,
      TUNE.minDurationSec,
      TUNE.loopSeconds * TUNE.maxDurationFraction,
    ),
    bornCycle: note.bornCycle,
    lastScheduledCycle: note.bornCycle,
    flashedCycle: note.bornCycle,
    flashUntil: performance.now() + TUNE.flashMs,
  });
  if (events.length > TUNE.maxEvents) events.shift();
}

// --- input ---------------------------------------------------------------

const canvas = document.querySelector<HTMLCanvasElement>("#stage");
const surface = canvas?.getContext("2d") ?? null;

// One code path for mouse and touch; polyphony falls out of the pointer id.
const KEYS = "asdfghjk";

if (canvas && surface) {
  canvas.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    startNote(
      `p:${event.pointerId}`,
      degreeForY(y, rect.height),
      cutoffForX(x, rect.width),
      x,
      y,
    );
  });

  const lift = (event: PointerEvent): void => {
    endNote(`p:${event.pointerId}`);
  };
  canvas.addEventListener("pointerup", lift);
  canvas.addEventListener("pointercancel", lift);

  window.addEventListener("keydown", (event) => {
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
    const index = KEYS.indexOf(event.key.toLowerCase());
    if (index < 0) return;
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const degree = clamp(index, 0, DEGREES - 1);
    startNote(
      `k:${event.key.toLowerCase()}`,
      degree,
      (TUNE.cutoffLow + TUNE.cutoffHigh) / 2,
      rect.width / 2,
      yForDegree(degree, rect.height),
    );
  });

  window.addEventListener("keyup", (event) => {
    endNote(`k:${event.key.toLowerCase()}`);
  });

  // --- render ------------------------------------------------------------

  const stillness = window.matchMedia("(prefers-reduced-motion: reduce)");

  function resize(): void {
    if (!canvas || !surface) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
    surface.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw(): void {
    if (!canvas || !surface) return;

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const nowMs = performance.now();
    const calm = stillness.matches;
    const { cycle, phase } = loopPosition();

    surface.fillStyle = TUNE.background;
    surface.fillRect(0, 0, width, height);

    // One row per scale degree: the rows are why nothing can sound wrong.
    surface.fillStyle = TUNE.rowColor;
    for (let degree = 0; degree < DEGREES; degree += 1) {
      surface.fillRect(0, yForDegree(degree, height), width, 1);
    }

    for (const event of events) {
      const eventPhase = event.offsetSec / TUNE.loopSeconds;

      // Flash when the playhead crosses the dot, not when the voice was
      // scheduled — those differ by up to scheduleAheadSec. The playhead runs
      // off the audio clock, so this lands on the right frame for free.
      if (event.flashedCycle < cycle && phase >= eventPhase) {
        event.flashUntil = nowMs + TUNE.flashMs;
        event.flashedCycle = cycle;
      }

      const life = Math.max(0, 1 - (cycle - event.bornCycle) / TUNE.livesFor);
      const flash = calm
        ? 0
        : Math.max(0, (event.flashUntil - nowMs) / TUNE.flashMs);

      surface.globalAlpha = 0.2 + 0.8 * life;
      surface.fillStyle = `hsl(${hueForDegree(event.degree)}, 82%, ${55 + flash * 22}%)`;
      surface.beginPath();
      surface.arc(
        eventPhase * width,
        yForDegree(event.degree, height),
        TUNE.dotRadius * (0.55 + 0.45 * life) * (1 + flash * 1.5),
        0,
        Math.PI * 2,
      );
      surface.fill();
    }
    surface.globalAlpha = 1;

    surface.fillStyle = TUNE.playheadColor;
    surface.fillRect(Math.round(phase * width), 0, 1.5, height);

    for (const note of live.values()) {
      const pulse = calm ? 1 : 1 + 0.14 * Math.sin(nowMs / 90);
      surface.strokeStyle = `hsl(${hueForDegree(note.degree)}, 90%, 72%)`;
      surface.lineWidth = 2;
      surface.beginPath();
      surface.arc(note.x, note.y, TUNE.liveRadius * pulse, 0, Math.PI * 2);
      surface.stroke();
    }

    // Before the first gesture the loop is already sweeping, silently, so the
    // idea arrives before the player touches anything.
    if (!audio) {
      const breath = calm ? 1 : 1 + 0.11 * Math.sin(nowMs / 700);
      surface.strokeStyle = "hsl(200, 70%, 74%)";
      surface.globalAlpha = 0.55;
      surface.lineWidth = 1.5;
      surface.beginPath();
      surface.arc(
        width / 2,
        height / 2,
        TUNE.inviteRadius * breath,
        0,
        Math.PI * 2,
      );
      surface.stroke();
      surface.globalAlpha = 1;
    }

    window.requestAnimationFrame(draw);
  }

  window.addEventListener("resize", resize);
  resize();
  window.requestAnimationFrame(draw);
}
