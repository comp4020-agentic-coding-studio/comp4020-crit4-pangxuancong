import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// This week's published spec (crit 4: "An instrument") turned into checks —
// only the lines a machine can verify. The rest — is it expressive, does a
// stranger "get it" uninstructed, is there truly no fail state, does the
// player's own account of directing/grounding/correcting the work hold up —
// only a person can judge, and that happens at the crit, not here.
//
// These run against the BUILT site (dist/), so they check what actually
// ships, not how the source is organised — the synth code or the input
// handlers could end up inlined in the page or split into a bundled chunk.

const DIST = resolve("dist");

function files(dir: string = DIST): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

const htmlFiles = files().filter((path) => path.endsWith(".html"));
const shipped = files()
  .filter((path) => path.endsWith(".html") || path.endsWith(".js"))
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");

describe("crit 4 spec: an instrument", () => {
  it("makes sound with the Web Audio API — synthesised live, not played back", () => {
    expect(
      /\bAudioContext\b/.test(shipped),
      "no AudioContext found in the shipped code — the spec asks for sound made live in the page by the player, not played back",
    ).toBe(true);
  });

  it("does not ship an <audio>/<video> element as the sound source", () => {
    for (const page of htmlFiles) {
      const html = readFileSync(page, "utf8");
      expect(
        /<audio[\s>]|<video[\s>]/i.test(html),
        `${page} ships an <audio>/<video> element — the spec asks for sound synthesised live, not played back from a file`,
      ).toBe(false);
    }
  });

  it("isn't locked to a mouse — listens for keyboard or touch input too", () => {
    const hasPointerish = /pointerdown|mousedown|addEventListener\(["']click["']/.test(shipped);
    const hasKeyboard = /keydown|keyup/.test(shipped);
    const hasTouch = /touchstart|touchend/.test(shipped);
    expect(
      hasPointerish,
      "no click/pointer/mouse handling found in the shipped code",
    ).toBe(true);
    expect(
      hasKeyboard || hasTouch,
      "only mouse handling found — the spec asks for it to be playable with whatever is at hand (mouse, keyboard or touch); add a keydown/keyup or touchstart/touchend path so it isn't mouse-only",
    ).toBe(true);
  });
});
