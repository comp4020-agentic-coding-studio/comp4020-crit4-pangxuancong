# Implementation plan — C4 "An instrument"

My plan for this week's prototype, written as the brief I hand to the agent.
The fixed contract is the published spec on the course website
(`/crits/04-instrument/`); this file records *my* decisions about how to answer
it, and the constraints the implementation has to hold to.

Read the whole document before writing any code. Implement it in **one pass** —
the tuning loop belongs to me, not to the agent (see
[Working rules](#working-rules)).

---

## 1. What to build

An **accumulating looper**. The player taps or holds anywhere on a full-bleed
canvas; each gesture sounds immediately and is then committed to a repeating
loop, so the instrument builds up under the player's hands and thins out again
on its own.

A single tap-and-hold carries **four** expressive dimensions, with no parameter
automation anywhere:

| Input | Maps to |
| --- | --- |
| Press `y` position | Pitch, quantised to a pentatonic scale over `TUNE.octaves` |
| Press `x` position | Brightness (lowpass cutoff), fixed for the life of that note |
| Hold duration | Note length |
| Moment of the press | The note's position within the loop |

Committed notes fade out over `TUNE.livesFor` cycles and are then dropped. This
is deliberate and replaces a clear button: the loop can never turn to permanent
mud, there is no UI to explain, and the instrument resets itself between players
— which matters, because at the crit several people play it in sequence.

## 2. Interaction contract

- **Cold open.** The playhead is already sweeping, silently, on page load. Nothing
  else moves except one slow breathing shape near the centre that invites a
  touch. This establishes the loop metaphor before the player touches anything,
  and costs nothing, because it is purely visual.
- **No audio gate.** There must be no "click to enable sound" step. The first
  `pointerdown` / `keydown` both creates the `AudioContext` *and* sounds the
  first note, inside the same handler.
- **Immediate response.** No network requests at runtime. Synthesis only — no
  audio files to fetch, so the first note has nothing to wait for.
- **No fail state.** Pitches are quantised to a pentatonic scale, so nothing the
  player does can sound wrong. No score, no timer, no failure of any kind.

## 3. Audio architecture

One `AudioContext`, created lazily inside the first gesture handler (an iOS
Safari requirement, not a stylistic choice).

```
per voice:  OscillatorNode ×2 (detuned ±TUNE.detune cents)
              → BiquadFilterNode (lowpass, cutoff = brightness)
              → GainNode (ADSR-ish envelope)
              → voiceBus

voiceBus  → masterGain → destination
voiceBus  → DelayNode ⇄ feedbackGain      (feedback loop)
            DelayNode → delayMixGain → masterGain
```

- Oscillators are one-shot: create per note, `stop()` at the end of the release,
  release references in `onended`.
- Voice count is bounded — drop the oldest voice past a sane ceiling rather than
  letting the graph grow without limit.
- The feedback delay is the only effect. It is ~8 lines and carries most of the
  perceived polish; there is no reverb (see [Out of scope](#6-out-of-scope)).

### Pitch mapping

```js
const degrees = TUNE.octaves * TUNE.scale.length;
const i = clamp(Math.floor((1 - y / height) * degrees), 0, degrees - 1);
const midi =
  TUNE.baseMidi +
  Math.floor(i / TUNE.scale.length) * 12 +
  TUNE.scale[i % TUNE.scale.length];
const hz = 440 * 2 ** ((midi - 69) / 12);
```

### Brightness mapping

```js
const cutoff = TUNE.cutoffLow + (x / width) * (TUNE.cutoffHigh - TUNE.cutoffLow);
```

## 4. Non-negotiables

These three decide whether the result sounds considered or cheap, and they map
directly onto the spec's "latency, feel" line. Do not deviate.

1. **Ramp every gain change.** Attack `TUNE.attack`, release `TUNE.release`, via
   `linearRampToValueAtTime` / `setTargetAtTime`. Never start or stop an
   oscillator at full gain — the resulting click is the single most common reason
   a browser synth sounds like a toy.
2. **Schedule against `audioContext.currentTime`, never `setTimeout`.** Use a
   lookahead scheduler (the standard "A Tale of Two Clocks" pattern): a
   `setInterval` every `TUNE.lookaheadMs` that looks `TUNE.scheduleAheadSec` into
   the future and schedules any loop events falling inside that window at exact
   audio-clock times. Anything sequenced by `setTimeout` will audibly jitter.
3. **Derive the visual playhead from the audio clock too.** Position is
   `((audioContext.currentTime - loopStartTime) % TUNE.loopSeconds) / TUNE.loopSeconds`.
   Do not accumulate time in `requestAnimationFrame`. This is what makes a dot
   flash on exactly the frame you hear it.

### Scheduler detail

Events are stored as
`{ offsetSec, midi, durationSec, cutoffHz, bornCycle, lastScheduledCycle }`.

On each tick, for each event, compute the absolute time of its next occurrence.
If that time falls inside `[now, now + scheduleAheadSec]` and its cycle index is
greater than `lastScheduledCycle`, schedule the voice and update
`lastScheduledCycle`. Guarding on the cycle index is what prevents an event from
being scheduled twice when consecutive ticks overlap the same window.

Gain multiplier for a replay is a function of `age = cycle - bornCycle`; drop the
event once `age >= TUNE.livesFor`.

### Clock before audio exists

The playhead sweeps before the first gesture, at which point there is no
`AudioContext`. Run it off `performance.now()` until the context exists, then
switch to the audio clock. Keep the handover seamless — set `loopStartTime` so
the playhead does not jump on the first press.

### Flash timing

Schedule-time and sound-time differ by up to `scheduleAheadSec`, so a dot must
**not** flash when its voice is scheduled. Flash it in the render loop, when the
playhead crosses its x. Because the playhead is driven by the audio clock, this
lands on the right frame for free.

## 5. Tunable constants

Every value a human might want to adjust by ear lives in one block at the top of
the instrument module. **No magic numbers anywhere else in the file.** I tune
these myself, by ear, without the agent.

```js
const TUNE = {
  loopSeconds:      4,
  attack:           0.015,   // too small pops, too large smears
  release:          0.35,
  cutoffLow:        400,     // brightness range, Hz
  cutoffHigh:       4000,
  detune:           7,       // cents, thickness of the pair
  delayFraction:    0.5,     // delay time as a fraction of the loop
  delayFeedback:    0.35,
  delayMix:         0.25,
  livesFor:         8,       // cycles a note survives before it is dropped
  scale:            [0, 2, 4, 7, 9],   // pentatonic degrees
  baseMidi:         48,
  octaves:          2,
  masterGain:       0.25,
  maxVoices:        24,
  lookaheadMs:      25,
  scheduleAheadSec: 0.1,
};
```

## 6. Input paths

The spec requires it to be playable with whatever is at hand.

- **Mouse and touch — one code path.** Pointer Events
  (`pointerdown` / `pointerup` / `pointercancel`) with `setPointerCapture`. The
  canvas needs `touch-action: none` in CSS or scrolling steals the gesture.
  Polyphony comes free from a `Map` keyed on `pointerId`.
- **Keyboard.** `a s d f g h j k` → eight ascending scale degrees from
  `TUNE.baseMidi`. `keydown` (ignoring `event.repeat`) starts the note and
  commits it at the current playhead; `keyup` ends it, so hold duration works
  identically to pointer input. Keyboard notes use a mid-range cutoff. Ignore
  events with modifier keys held.
- Both paths must go through the same "start note / end note" functions. Do not
  fork the voice logic.

## 7. Visual

Canvas 2D, sized to the viewport and `devicePixelRatio`-aware, redrawn in a
`requestAnimationFrame` loop.

- Sweeping playhead line.
- Committed notes as dots: `x` from `offsetSec`, `y` from pitch, radius and alpha
  from remaining life so the decay is visible.
- A brief flash when the playhead crosses a dot.
- A bright marker at the pointer (or the key's implied position) while a note is
  held.

Respect `prefers-reduced-motion`: keep the playhead, which is functional rather
than decorative, and drop the breathing invite and the flashes.

### The invariants constrain the cold open

`spec/invariants.test.ts` requires **exactly one `<h1>`** and a **`<nav>`
landmark** on every built page, so a full-bleed canvas cannot be the only thing
on the page. Handle this honestly:

- Keep a real, understated header — small type, low contrast, cornered, and
  allowed to recede once the player is playing.
- Do **not** hide the `<nav>` with `.sr-only` or equivalent to satisfy the check.
  Gaming an invariant is worse than the layout compromise.

Also pass a real `description` to `Layout.astro` in place of the starter
placeholder — it is what a shared link shows, and the invariants check it.

## 8. Files

| File | Action |
| --- | --- |
| `src/scripts/main.ts` | Replace with the instrument (TUNE block, audio graph, scheduler, input, render loop) |
| `src/pages/index.astro` | Replace the starter markup; pass a real `description` to `Layout` |
| `src/styles/global.css` | Full-bleed canvas, `touch-action: none`, understated header |
| `spec/starter.test.ts` | **Delete.** It describes the starter page's `data-testid="intro"` and is designed to be removed once that page is gone (`spec/README.md`) |
| `spec/invariants.test.ts` | Do not touch |
| `spec/instrument.test.ts` | Do not touch — this is the week's spec turned into checks |
| `src/layouts/Layout.astro` | Only if the description needs threading through |

No new dependencies. No `pnpm add`.

## 9. Out of scope

Explicitly not in this build. Do not add them, and do not propose them.

- Pitch bend, drag-while-held, or any recorded parameter curve — cut deliberately
  as the most expensive part of the design for the least certain return.
- Convolver reverb. The feedback delay is the only effect.
- A clear button, a reset, or any transport controls — auto-decay covers it.
- Settings UI, presets, scale pickers, visual themes.
- Any library or framework addition.
- `PROCESS.md` and `reflections/crit-4.md` — I write those; they are assessed as
  my account of my own process.
- Refactoring, abstraction layers, or "while I was here" cleanups.

## 10. Definition of done

Mechanically checkable — `pnpm check` green except where noted:

- [ ] `pnpm check` passes, with `spec/starter.test.ts` deleted rather than made
      to pass
- [ ] `spec/instrument.test.ts` green: an `AudioContext` in the shipped code, no
      `<audio>`/`<video>` element, and a keyboard or touch path alongside pointer
      input
- [ ] Invariants green, including one `<h1>`, a `<nav>`, and a real meta
      description
- [ ] No runtime network requests
- [ ] No console errors on load or during play

Judged by ear and by a person, and therefore mine to verify, not the agent's:

- [ ] The first press sounds instantly, with no gate and no audible click
- [ ] Two different players produce audibly different results
- [ ] A stranger, given no instruction and no spoken help, makes a sound within
      seconds and keeps playing
- [ ] Nothing the player can do sounds wrong
- [ ] Works at 1920×1080 and 390×844, with touch input genuinely working on a
      real device rather than in DevTools emulation

## Working rules

The tuning loop is mine. The agent cannot hear the result, so any round trip
about how it *sounds* is the agent guessing at my expense.

- Implement in a **single pass**. Do not iterate on aesthetics.
- Run `pnpm check` **once**, at the end. Fix what it reports; change nothing else.
- Do not re-read files already in context. Do not survey the repository — it was
  set up for this week and its contents are known.
- Keep the instrument in **one file** so that reading it back stays cheap.
- Every tunable value goes in `TUNE`, so I can adjust by ear with no agent
  involvement.
- When finished, report what was built and what `pnpm check` said, then hand
  tuning back to me. Do not offer to tune it.

**Division of labour after the first pass:** if the fix is a number, I make it.
If the fix is a behaviour or a bug — a note that never releases, a loop that
drifts, touch input that does not register — that is the agent's.
