/**
 * Secondary sparkle, drawn on its own 2D canvas layered over the WebGL field
 * — a second cheap draw call, not a second renderer. A fixed-size pool avoids
 * per-spawn allocation; a pool exhausted by too many events just drops new
 * spawns rather than growing unbounded.
 */
import { TUNE } from "./tune";

interface Particle {
  active: boolean;
  x: number; // normalized 0..1, y-down — same convention as pointer.ts
  y: number;
  vx: number; // normalized units/s
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  hue: number;
}

export interface SparkleSpawn {
  x: number;
  y: number;
  vx: number;
  vy: number;
  hue: number;
  /** 0..1 — how big/bright the burst is. */
  boost: number;
}

const pool: Particle[] = Array.from({ length: TUNE.sparkleMaxCount }, () => ({
  active: false,
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
  life: 0,
  maxLife: 1,
  size: 1,
  hue: 200,
}));

let ctx2d: CanvasRenderingContext2D | null = null;
let canvasEl: HTMLCanvasElement | null = null;

export function initParticles(canvas: HTMLCanvasElement): void {
  canvasEl = canvas;
  ctx2d = canvas.getContext("2d");
}

export function resizeParticles(cssWidth: number, cssHeight: number, dpr: number): void {
  if (!canvasEl) return;
  canvasEl.width = Math.max(1, Math.round(cssWidth * dpr));
  canvasEl.height = Math.max(1, Math.round(cssHeight * dpr));
  ctx2d?.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function acquire(): Particle | undefined {
  return pool.find((particle) => !particle.active);
}

export function spawnParticles(spawn: SparkleSpawn): void {
  const count = 2 + Math.round(spawn.boost * 4);
  for (let i = 0; i < count; i += 1) {
    const particle = acquire();
    if (!particle) return; // pool exhausted — drop rather than grow the array

    particle.active = true;
    particle.x = spawn.x;
    particle.y = spawn.y;

    const angle = Math.atan2(spawn.vy, spawn.vx) + (Math.random() - 0.5) * 0.9;
    const speed = (0.15 + Math.random() * 0.25) * (0.4 + spawn.boost);
    particle.vx = Math.cos(angle) * speed;
    particle.vy = Math.sin(angle) * speed;

    particle.maxLife =
      TUNE.sparkleLifetimeMinSec + Math.random() * (TUNE.sparkleLifetimeMaxSec - TUNE.sparkleLifetimeMinSec);
    particle.life = particle.maxLife;
    particle.size = TUNE.sparkleSize * (0.7 + spawn.boost * 0.8) * (0.7 + Math.random() * 0.6);
    particle.hue = spawn.hue;
  }
}

export function updateAndDrawParticles(dtSec: number, cssWidth: number, cssHeight: number): void {
  if (!ctx2d) return;
  const drift = TUNE.sparkleDrift / 1000;

  ctx2d.clearRect(0, 0, cssWidth, cssHeight);
  ctx2d.globalCompositeOperation = "lighter";

  for (const particle of pool) {
    if (!particle.active) continue;

    particle.life -= dtSec;
    if (particle.life <= 0) {
      particle.active = false;
      continue;
    }

    // A little noise drift so trails don't read as mechanically straight
    // lines, plus a faint upward bias so sparkle feels light, not falling.
    particle.vx += (Math.random() - 0.5) * drift * dtSec;
    particle.vy += ((Math.random() - 0.5) * drift - 0.02) * dtSec;
    particle.x += particle.vx * dtSec;
    particle.y += particle.vy * dtSec;

    const lifeFrac = particle.life / particle.maxLife;
    ctx2d.fillStyle = `hsla(${particle.hue}, 85%, 72%, ${lifeFrac * 0.55})`;
    ctx2d.beginPath();
    ctx2d.arc(particle.x * cssWidth, particle.y * cssHeight, particle.size * lifeFrac, 0, Math.PI * 2);
    ctx2d.fill();
  }

  ctx2d.globalCompositeOperation = "source-over";
}
