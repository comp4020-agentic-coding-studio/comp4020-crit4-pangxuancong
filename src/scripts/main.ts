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

  let analyserBins: Uint8Array<ArrayBuffer> | null = null;
  function readAnalyserEnergy(): number {
    const analyser = getAnalyser();
    if (!analyser) return 0;
    if (!analyserBins || analyserBins.length !== analyser.fftSize) {
      analyserBins = new Uint8Array(analyser.fftSize);
    }
    analyser.getByteTimeDomainData(analyserBins);
    let sumSquares = 0;
    for (let i = 0; i < analyserBins.length; i += 1) {
      const sample = analyserBins[i] ?? 128;
      const v = (sample - 128) / 128;
      sumSquares += v * v;
    }
    return Math.sqrt(sumSquares / analyserBins.length);
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
    const analyserEnergy = readAnalyserEnergy();
    renderer?.draw(now / 1000, points, analyserEnergy, reducedMotionQuery.matches);

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

    if (debugEl) updateDebugOverlay(debugEl, smoothedFps);

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

function updateDebugOverlay(el: HTMLElement, fps: number): void {
  const lines = [
    `fps ${fps.toFixed(0)}`,
    `voices ${getActiveVoiceCount()}`,
    ...getDebugGestures().map((g) => {
      const snapshot = getVoiceSnapshot(g.id);
      const cutoff = snapshot ? Math.round(snapshot.cutoffHz) : "-";
      return `${g.id}  x${g.nx.toFixed(2)} y${g.ny.toFixed(2)}  v${g.speed.toFixed(0)}  midi${snapshot?.midi ?? g.midi}  cutoff${cutoff}`;
    }),
  ];
  el.textContent = lines.join("\n");
}
