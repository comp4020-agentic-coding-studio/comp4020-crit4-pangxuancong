/**
 * A soft ring + dot replacing the OS cursor on precise pointers only —
 * hidden entirely on touch, where there's nothing to replace. Position is
 * smoothed the same way the shader's pointer wells are, so the cursor and
 * the field's glow read as the same gesture seen from two layers.
 */
import { TUNE } from "./tune";

let ring: HTMLDivElement | null = null;
let dot: HTMLDivElement | null = null;
let enabled = false;

let targetX = 0;
let targetY = 0;
let visualX = 0;
let visualY = 0;
let lastX = 0;
let lastY = 0;
let pressed = false;

export function initCursor(container: HTMLElement): void {
  if (!window.matchMedia("(pointer: fine)").matches) return; // touch devices get no cursor
  enabled = true;
  document.body.classList.add("custom-cursor");

  ring = document.createElement("div");
  ring.className = "cursor-ring";
  dot = document.createElement("div");
  dot.className = "cursor-dot";
  container.append(ring, dot);

  window.addEventListener("pointermove", (event) => {
    targetX = event.clientX;
    targetY = event.clientY;
  });
  window.addEventListener("pointerdown", () => {
    pressed = true;
  });
  const release = (): void => {
    pressed = false;
  };
  window.addEventListener("pointerup", release);
  window.addEventListener("pointercancel", release);
}

export function updateCursor(): void {
  if (!enabled || !ring || !dot) return;

  visualX += (targetX - visualX) * TUNE.cursorSmoothing;
  visualY += (targetY - visualY) * TUNE.cursorSmoothing;

  const dx = targetX - lastX;
  const dy = targetY - lastY;
  lastX = targetX;
  lastY = targetY;

  const stretch = Math.min(1.6, 1 + Math.hypot(dx, dy) / 40);
  const angle = Math.atan2(dy, dx);
  const scale = pressed ? 0.6 : 1;

  ring.style.transform =
    `translate(${visualX}px, ${visualY}px) translate(-50%, -50%) ` +
    `rotate(${angle}rad) scale(${stretch * scale}, ${scale})`;
  dot.style.transform =
    `translate(${visualX}px, ${visualY}px) translate(-50%, -50%) scale(${pressed ? 1.4 : 1})`;
}
