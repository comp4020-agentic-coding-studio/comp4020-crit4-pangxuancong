/**
 * Wiring only: creates the renderer, hands the canvas to pointer input, and
 * runs one requestAnimationFrame loop that reads gesture + analyser state and
 * draws. No audio or gesture logic lives here — see audio.ts / pointer.ts.
 */
import { getActiveVoiceCount, getAnalyser, getVoiceSnapshot } from "./audio";
import { initCursor, updateCursor } from "./cursor";
import { spawnParticles, initParticles, resizeParticles, updateAndDrawParticles } from "./particles";
import { drainSparkleEvents, getDebugGestures, getRenderPoints, initPointerInput } from "./pointer";
import { FluidRenderer, hueForPoint } from "./renderer";
import { TUNE } from "./tune";

const canvas = document.querySelector<HTMLCanvasElement>("#stage");
const sparkleCanvas = document.querySelector<HTMLCanvasElement>("#sparkles");

if (canvas) {
  let renderer: FluidRenderer | null = null;
  try {
    renderer = new FluidRenderer(canvas);
  } catch {
    // Graceful, minimal degrade: the instrument still sounds without WebGL,
    // and the canvas stays transparent over the page's own dark background
    // rather than showing an error to the player.
    renderer = null;
  }

  if (sparkleCanvas) initParticles(sparkleCanvas);
  initCursor(document.body);

  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  function resize(): void {
    if (!canvas) return;
    renderer?.resize(canvas.clientWidth, canvas.clientHeight, dpr);
    if (sparkleCanvas) resizeParticles(canvas.clientWidth, canvas.clientHeight, dpr);
  }
  window.addEventListener("resize", resize);
  resize();

  initPointerInput(canvas, {
    // The engine doesn't own the invite text's DOM — Chrome.tsx does. It only
    // announces the event; React decides how to react to it.
    onFirstInteraction: () => {
      window.dispatchEvent(new CustomEvent("fluid:first-interaction"));
    },
  });

  const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

  interface BandEnergies {
    low: number;
    mid: number;
    high: number;
  }

  let freqBins: Uint8Array<ArrayBuffer> | null = null;
  /**
   * A very faint background haze, not a spectrum display (see plan.md's
   * addendum): three band averages, not a per-bin readout, so there's
   * nothing shaped like a visualizer to recognise as one.
   */
  function readBandEnergies(): BandEnergies {
    const analyser = getAnalyser();
    if (!analyser) return { low: 0, mid: 0, high: 0 };
    if (!freqBins || freqBins.length !== analyser.frequencyBinCount) {
      freqBins = new Uint8Array(analyser.frequencyBinCount);
    }
    analyser.getByteFrequencyData(freqBins);

    const binHz = analyser.context.sampleRate / analyser.fftSize;
    let lowSum = 0;
    let lowCount = 0;
    let midSum = 0;
    let midCount = 0;
    let highSum = 0;
    let highCount = 0;

    for (let i = 0; i < freqBins.length; i += 1) {
      const hz = i * binHz;
      const value = (freqBins[i] ?? 0) / 255;
      if (hz < TUNE.bandLowMaxHz) {
        lowSum += value;
        lowCount += 1;
      } else if (hz < TUNE.bandMidMaxHz) {
        midSum += value;
        midCount += 1;
      } else {
        highSum += value;
        highCount += 1;
      }
    }

    return {
      low: lowCount ? lowSum / lowCount : 0,
      mid: midCount ? midSum / midCount : 0,
      high: highCount ? highSum / highCount : 0,
    };
  }

  const debugEl =
    new URLSearchParams(window.location.search).get("debug") === "true" ? createDebugOverlay() : null;

  let lastFrame = performance.now();
  let smoothedFps = 60;

  function frame(now: number): void {
    const dt = now - lastFrame;
    lastFrame = now;
    smoothedFps += (1000 / Math.max(1, dt) - smoothedFps) * 0.1;

    const points = getRenderPoints(now);
    const bands = readBandEnergies();
    renderer?.draw(now / 1000, points, bands, reducedMotionQuery.matches);

    for (const event of drainSparkleEvents()) {
      spawnParticles({
        x: event.x,
        y: event.y,
        vx: event.vx,
        vy: event.vy,
        hue: hueForPoint(event.brightness, event.energy),
        boost: event.boost,
      });
    }
    if (canvas) updateAndDrawParticles(dt / 1000, canvas.clientWidth, canvas.clientHeight);

    updateCursor();

    if (debugEl) updateDebugOverlay(debugEl, smoothedFps, bands);

    window.requestAnimationFrame(frame);
  }
  window.requestAnimationFrame(frame);
}

function createDebugOverlay(): HTMLElement {
  const el = document.createElement("pre");
  el.id = "debug";
  document.body.appendChild(el);
  return el;
}

function updateDebugOverlay(el: HTMLElement, fps: number, bands: { low: number; mid: number; high: number }): void {
  const lines = [
    `fps ${fps.toFixed(0)}`,
    `voices ${getActiveVoiceCount()}`,
    `bands low${bands.low.toFixed(2)} mid${bands.mid.toFixed(2)} high${bands.high.toFixed(2)}`,
    ...getDebugGestures().map((g) => {
      const snapshot = getVoiceSnapshot(g.id);
      const cutoff = snapshot ? Math.round(snapshot.cutoffHz) : "-";
      return `${g.id}  x${g.nx.toFixed(2)} y${g.ny.toFixed(2)}  v${g.speed.toFixed(0)}  midi${snapshot?.midi ?? g.midi}  cutoff${cutoff}`;
    }),
  ];
  el.textContent = lines.join("\n");
}
