# Implementation plan — C4 "FLUID"

An audiovisual instrument: touching and sculpting sound inside a living fluid
field. No visible controls — the field itself is the interface. This file
scopes the original design brief down to what fits the time and budget left,
and resolves the places where the brief conflicts with this repo's fixed
contract (`spec/invariants.test.ts`, `spec/instrument.test.ts`) or with itself.

Read the whole document before writing any code. Implement it in the phase
order below, checking in after each phase rather than building everything then
debugging once (see [Working rules](#working-rules)).

---

## 1. What survives from the original brief, and what doesn't

The original brief specified a two-week production (WebGL + Canvas2D fallback,
a standalone particle system, custom cursor, procedural reverb, React,
a 12-file `src/audio|interaction|visuals|utils|components` tree, debug mode).
The budget is one evening. Scope is cut to what decides the ten criteria in
the brief's own §30 (make sound in 2–3s, discover that movement changes sound,
experiment voluntarily, two people sound different, no wrong note, latency
feels immediate, visual reads as physically connected to sound) — not to what
looks most impressive on paper.

**Kept:**
- Single-pass WebGL fragment shader for the fluid field (simpler and faster
  than faking the same look in Canvas2D, provided it stays one pass with no
  framebuffer ping-pong)
- Pentatonic pitch quantisation with glide, Y-axis filter brightness, envelope,
  velocity → energy
- One delay line with a lowpass in the feedback path (does most of the "liquid
  space" work reverb was brought in for)
- AnalyserNode driving shader uniforms only — no visible frequency bars
- Debug overlay behind `?debug=true` — this is not polish, it's how I diagnose
  problems by describing them precisely instead of paying for guesses
- Keyboard input (see §2 below — this is a correction to the brief, not a cut)

**Cut initially, then reinstated once the core was built and heard/seen to
work** (confirmed after the first pass shipped): standalone particle system,
custom cursor, procedural convolution reverb. Each is additive to the
architecture above rather than a redesign, which is exactly why they were
safe to defer — see the addendum after §11 for how each was actually built.

**Still cut:**
- **12-directory source tree** → files: `tune.ts` (every tunable constant —
  see [Tuning](#7-tuning)), `audio.ts`, `pointer.ts`, `renderer.ts` (shader
  source as a template string — no glsl loader to configure), `particles.ts`,
  `cursor.ts`, `main.ts` (wiring). One voice class lives in `audio.ts`; it
  doesn't need its own file at this size.
- **React** — pending a specific answer to "animate what, exactly": this
  repo has no React today, and adding it is a real architectural change (a
  new dependency, an Astro integration, and — critically — something with
  component lifecycle sitting next to a 60fps loop that was deliberately kept
  out of any framework's hands). See the addendum for the resolution.

## 2. Resolving conflicts with this repo's fixed contract

The brief was written without reference to this repo. Three things it misses
outright would otherwise cost a wasted round trip each.

**No keyboard path.** The brief specifies mouse/trackpad/touch only. But the
published spec for this deliverable says "playable with whatever is at hand —
mouse, **keyboard** or touch", and `spec/instrument.test.ts` (written last
week, before this brief existed) asserts a `keydown`/`keyup` or
`touchstart`/`touchend` path exists alongside pointer input. Pointer Events
alone fail that check, and a tutor at the crit may well reach for the keyboard
before the mouse. **Fix:** `a s d f g h j k` play the pentatonic degrees
directly (bypassing X→pitch quantisation, since there's no pointer X to read),
held notes work exactly like a held pointer, arrow keys nudge filter
brightness. This is an addition, not a compromise on the brief's identity —
the field still looks and sounds identical either way.

**`<h1>` and `<nav>`.** `spec/invariants.test.ts` requires exactly one
top-level heading and a navigation landmark on every built page — brief §1
forbids visible navigation chrome. These aren't actually in tension: brief §24
already allows "FLUID in a tiny corner at very low opacity", which serves as
the `<h1>`. For `<nav>`, one real link at the same low-opacity corner, pointing
at this deliverable's published brief — a genuine destination, not
`aria-label="Primary"` theatre, and not `.sr-only`'d out of sight to game the
check. Gaming an invariant is worse than the ten pixels it costs.

**Meta description.** `Layout.astro` currently carries the starter placeholder.
Replace it with one real sentence — it's what a shared link shows, and the
invariant checks it's non-empty.

## 3. Two internal contradictions in the brief, resolved

**Pan and pitch were both bound to X** (§22: X → quantised pitch, and
separately X → pan −0.65…+0.65). That locks high notes to always arrive from
the right — an artificial constraint that shrinks the expressive range and
becomes obvious on headphones within a minute. **Decision (confirmed):** pan
follows **gesture direction** — a short rolling average of recent pointer
velocity, scaled into a narrow ±0.3 range — rather than absolute position. This
reads as the material moving with the gesture, which is closer to the brief's
own §33 metaphor ("movement bends it") than a fixed left-right map is.

**Colour was described against two different axes** (§10's "lower/higher
tones → deep blue/cyan" implies pitch=X drives colour, but "darker/brighter"
is literally the Y-axis filter brightness). Driving colour from both axes at
once would blur the causality the brief spends all of §14 insisting on.
**Decision (confirmed):** hue follows **filter brightness (Y)** — darker/lower
Y reads as deep indigo, brighter/higher Y reads as cyan/icy white — because
brightness is the axis the word actually describes. Pitch (X) drives
horizontal position and the field's local scale instead, so moving left/right
and moving up/down each change one clearly distinct thing.

## 4. Things the brief doesn't cover, that will bite in a crit if unhandled

**A stuck sustained tone is the one failure mode that kills a crit outright.**
If a drag ends outside the window before release, or the tab loses focus mid
gesture, a naive implementation never gets a `pointerup` and the tone drones
forever in front of the pod. Three layers, not one: `setPointerCapture` on
`pointerdown` (so the pointer keeps reporting to the canvas even off-window),
`pointercancel` handled identically to `pointerup`, and a `blur` /
`visibilitychange` listener that force-releases every active voice. This is
the single highest-priority correctness item in the whole build.

**Glide erases quantisation if it isn't gated.** A fast horizontal swipe
crosses several scale steps in well under 100ms; if every step glides for a
fixed 30–100ms, consecutive glides overlap into a chromatic smear and the
whole point of quantising is lost. **Fix:** glide time scales inversely with
gesture speed (`glideMs = lerp(maxGlideMs, minGlideMs, energy)`) — a slow move
glides smoothly between two notes, a fast swipe snaps.

**Gain structure needs a real ceiling, not just "conservative".** With up to
`maxVoices` voices plus a feedback delay landing in a compressor, worst case is
several fingers down at once — this needs to be tested with a full hand of
touches, not assumed safe from the node graph alone.

**The field must settle fully between players.** At the crit, the pod plays
this one after another. If residual motion or a lingering echo carries over
from the previous player, the second person's "make a sound in 2 seconds"
moment is muddied by someone else's leftover gesture. The field's idle
relaxation must return to a clean, quiet baseline — not just "low energy" —
within a few seconds of the last release.

**iOS hardware mute switch silences Web Audio.** Nothing to fix; noted so it
isn't mistaken for a bug during testing.

## 5. Audio architecture

```
per voice:
  oscillator 1 (fundamental, triangle)
  oscillator 2 (quiet upper harmonic, sine, detuned ±TUNE.detuneCents)
    → gain envelope
    → BiquadFilterNode (lowpass, cutoff from Y, exponential mapping)
    → StereoPannerNode (pan from gesture-direction rolling average)
    → voice bus

voice bus → analyser (energy → shader uniforms, no visible bars)
voice bus → master gain
voice bus → delay → feedback (through a lowpass) → delay (loop)
                  → wet gain → master gain
master gain → DynamicsCompressorNode → destination
```

- One `AudioContext`, created lazily on the first `pointerdown`/`keydown` —
  this is what removes the "click to enable audio" step: the first gesture
  both creates the context and sounds the first note.
- Envelope: attack ~20–80ms, release scaled 300–1200ms by gesture energy at
  release time (a held, settled tone releases slower than a quick tap).
  Every gain and frequency change is a ramp
  (`linearRampToValueAtTime`/`setTargetAtTime`/`exponentialRampToValueAtTime`)
  — never an instant jump; that's the click that makes a browser synth sound
  cheap.
- Pitch: `positionToFrequency(x)` quantises to C minor pentatonic (MIDI pitch
  classes 0, 3, 5, 7, 10 relative to a base) across ~2.5 octaves, glide time
  inversely scaled by speed as above.
- Filter cutoff: exponential map from Y, roughly 300Hz (bottom) to 8000Hz
  (top), moderate Q, never resonant enough to hurt.
- Velocity → energy: `energy = smoothstep(0, 1, clamp(speed / targetSpeed, 0, 1))`
  — never raw gain; energy instead feeds harmonic gain, a subtle delay send,
  and shader turbulence.
- Voice cap (`TUNE.maxVoices`, default 5): a `Map<pointerId | key, Voice>` plus
  the same map by key for keyboard notes; polyphony is naturally bounded by
  how many fingers/keys are actually down.

## 6. Visual field

Single fullscreen-quad fragment shader (WebGL, no framebuffer feedback pass —
any accumulation effect is faked with exponential decay of uniforms on the CPU
side, not multi-pass rendering). Inputs: time, up to `maxVoices` pointer
positions with a decaying "energy" per point, analyser bands (low/mid/high +
RMS), and a `prefers-reduced-motion` flag.

- Idle: slow domain-warped noise flow, 8–15s cycle, restrained enough to read
  as breathing rather than animating.
- Per active point: a smoothstep-falloff displacement well plus a soft glow;
  interpolate the *visual* pointer toward the *raw* pointer position each
  frame (`visual += (target - visual) * smoothing`) rather than locking to it
  exactly, for the "physical inertia" the brief asks for.
- Colour: hue driven by filter brightness (Y) — deep indigo at low Y, cyan/icy
  white at high Y (§3 above). Fast gestures briefly desaturate toward a violet
  highlight, decaying over ~300ms. Background stays near-black
  (`#080A0E`-family), never pure `#000`.
- Sparkle in place of a particle system: seeded at tap and at velocity-
  threshold crossings, rendered as bright points with their own short-lived
  decay term — same pass, same draw call.
- Release: energy for that point decays over ~1s (the "ghost trail"), not an
  instant cut.
- `prefers-reduced-motion`: cut turbulence and idle drift amplitude
  substantially, keep the direct pointer-response displacement (it's
  functional, not decorative) at reduced intensity.

## 7. Tuning

Every value worth adjusting by ear or by eye lives in `tune.ts`. I tune these
myself; the agent does not iterate on feel (see [Working rules](#working-rules)).

```ts
export const TUNE = {
  // audio
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
  targetSpeed: 1800, // px/s treated as "fast"

  // visual
  idleCycleSec: 11,
  pointerSmoothing: 0.18,
  wellRadius: 0.22, // fraction of viewport
  hueLow: 235, // indigo
  hueHigh: 190, // cyan
  fastHueShift: 285, // violet
  sparkleThreshold: 900, // px/s to seed a sparkle
  ghostDecaySec: 1.0,
  reducedMotionScale: 0.35,

  // scale
  scaleDegrees: [0, 3, 5, 7, 10], // C minor pentatonic
  baseMidi: 48,
  octaves: 2.5,
};
```

## 8. Input paths

- **Pointer Events**, multi-touch via `Map<pointerId, Voice>`, capped at
  `TUNE.maxVoices`. `setPointerCapture` on down. `touch-action: none` on the
  canvas.
- **Keyboard** (the brief's gap, closed per §2): `a s d f g h j k` → the eight
  ascending pentatonic degrees from `baseMidi`; `keydown` (ignoring
  `event.repeat`) starts a note at a mid-range cutoff, `keyup` ends it exactly
  like a pointer release; arrow up/down nudge cutoff for the currently-held
  keyboard notes.
- Both paths call the same `startVoice`/`updateVoice`/`releaseVoice` functions
  — no forked voice logic.
- Release safety net (§4): `pointercancel` treated identically to `pointerup`;
  `window` `blur` and `visibilitychange` (hidden) force-release every entry in
  both voice maps.

## 9. Files

| File | Contents |
| --- | --- |
| `src/scripts/tune.ts` | Every constant in §7 — nothing tunable lives anywhere else |
| `src/scripts/audio.ts` | AudioContext, voice graph, `positionToFrequency`, effects bus, `startVoice`/`updateVoice`/`releaseVoice` |
| `src/scripts/pointer.ts` | Pointer + keyboard event wiring, gesture velocity smoothing, the release-safety-net listeners |
| `src/scripts/renderer.ts` | WebGL setup, shader source (template string), per-frame uniform updates from pointer + analyser state |
| `src/scripts/main.ts` | Wires the three above together; the only file that imports the other three |
| `src/pages/index.astro` | Full-bleed canvas, corner `<h1>FLUID</h1>` + `<nav>` link to the brief, `"touch the sound"` invite text (fades out after first gesture), real meta description |
| `src/styles/global.css` | Full-bleed canvas, `touch-action: none`, near-black background, low-opacity corner chrome |
| `spec/starter.test.ts` | **Delete** — describes the starter page this replaces |

No new dependencies. WebGL via the browser API directly, no library.

## 10. Out of scope

Not in this build; do not add these, and do not propose them.

- Multi-pass / framebuffer feedback rendering
- Debug-mode features beyond FPS, pointer coords, speed, current note, cutoff,
  voice count
- Any preset system, settings UI, or visual themes
- `PROCESS.md` and `reflections/crit-4.md` — written by me, not the agent

## 11. Definition of done

Mechanically checkable:

- [ ] `pnpm check` passes, with `spec/starter.test.ts` deleted rather than made
      to pass
- [ ] `spec/instrument.test.ts` green: `AudioContext` present, no
      `<audio>`/`<video>` element, keyboard or touch path alongside pointer
- [ ] Invariants green: one `<h1>`, one `<nav>`, real meta description
- [ ] No runtime network requests, no console errors on load or during play

Judged by ear/eye, mine to verify:

- [ ] First gesture sounds instantly, no gate, no audible click
- [ ] A full hand of simultaneous touches doesn't distort or clip
- [ ] Releasing outside the window, or switching tabs mid-gesture, never
      leaves a note stuck on
- [ ] Fast swipes snap between notes; slow moves glide — no chromatic smear
- [ ] Two people produce audibly and visibly different performances
- [ ] The field returns to a clean idle within a few seconds of release, so a
      second player at the crit isn't inheriting the first player's residue
- [ ] Works at 1920×1080 and 390×844; touch verified on a real device

## Addendum: reinstating particles, cursor, reverb

Requested after the first pass was built, heard, and approved. Each slots
into the existing architecture without touching §5/§6's core:

- **Particle system** (`particles.ts`): a fixed-size pool (`TUNE.sparkleMaxCount`),
  drawn on its own 2D canvas layered over the WebGL one — a second cheap
  draw call, not a second renderer. Spawned by `pointer.ts` on three events
  (a tap, a velocity-threshold crossing, a note change mid-drag), each
  carrying the gesture's direction so particles inherit it, colour matched
  via the same brightness→hue mapping the shader uses
  (`renderer.hueForPoint`, extracted so there's one formula, not two).
  Pool-exhaustion drops new spawns rather than growing the array — bounded
  by construction, not by discipline.
- **Custom cursor** (`cursor.ts`): two DOM elements (ring + dot), hidden
  entirely when `(pointer: fine)` doesn't match (touch devices get no
  cursor, per the original brief). Position is smoothed the same way the
  shader's pointer wells are (`target += (goal - target) * smoothing`); the
  ring compresses on press and stretches along the direction of fast motion.
  It replaces the OS cursor, not the shader's glow — both read as the same
  gesture from two different layers now, which is a stronger visual than
  either alone.
- **Reverb** (`audio.ts`): a `ConvolverNode` fed by a procedurally generated
  stereo impulse response (filtered noise, exponential decay — no fetched
  asset, so it costs nothing at first paint), running in parallel with the
  existing delay rather than replacing it. `TUNE.reverbSeconds`,
  `TUNE.reverbDecay`, `TUNE.reverbWet` control it; wet level starts low
  because two spatial effects stacking is the fastest way back to mud.
- **React** (`src/components/Chrome.tsx`, `@astrojs/react`): scoped to exactly
  what was confirmed — the corner FLUID/nav chrome and the "touch the sound"
  invite, both UI-state transitions rather than the instrument itself. The
  engine still owns no DOM inside this component; it dispatches a
  `fluid:first-interaction` window event on the first gesture, and the
  component's own `useEffect` decides what to do with it. Astro server-renders
  the island, so the `<h1>`/`<nav>` invariants check are present in the built
  HTML with no client JS required — `client:load` only adds the transition on
  top of markup that already exists.

## Addendum: band-driven ambient haze

Requested as a "background audio visualizer" — resolved, after checking the
intent against §8's explicit "no visible frequency bars", as an extension of
the existing analyser→shader coupling rather than a literal spectrum display.
`getAnalyser()`'s single RMS scalar became three band averages (low <200Hz,
mid 200Hz–2kHz, high >2kHz — `TUNE.bandLowMaxHz`/`bandMidMaxHz`), each driving
a distinct, already-organic shader behaviour rather than a bar or a wedge:

- **low** → a large, slow-moving coarse-noise swell across the whole field
  (bass reads as a broad pulse, not a local flicker)
- **mid** → the existing idle flow's amplitude and speed (the background's
  primary wave gets stronger and quicker with mid-band energy)
- **high** → a fine, sparse shimmer (`pow(noise, 4)`, so it stays sparkly
  rather than washing the whole field)

All three are additive and kept subtle (`ambient` in the shader) — the field
should read as "the space is breathing with the sound," not "there's a
visualizer in the background." fftSize raised 256 → 1024 for enough bins
below 200Hz for the low band to mean anything; still cheap, since the browser
computes the FFT regardless of how many bins get read.

## Working rules

The tuning loop is mine. The agent cannot hear or see the result in motion, so
any round trip about how it *feels* is the agent guessing at my expense.

- Build in the phase order implied by §5–§9 (audio engine sounding right on
  its own before the shader is wired to it), but as **one continuous pass per
  phase checkpoint** — not a line-by-line negotiation.
- Run `pnpm check` once per phase checkpoint, not after every file.
- Do not re-read files already in context; do not survey the repository.
- Every tunable value goes in `tune.ts`. No magic numbers anywhere else.
- When finished, report what was built, what `pnpm check` said, and which
  Definition of Done items still need my eyes/ears — then stop. Do not offer
  to tune it.

**Division of labour after a build:** if the fix is a number in `tune.ts`, I
make it. If it's a behaviour or a bug — a stuck note, a wrong keyboard
mapping, a shader that doesn't compile on a real device — that's the agent's.
