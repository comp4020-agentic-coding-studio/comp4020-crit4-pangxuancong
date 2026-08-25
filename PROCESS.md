# Process overview

## What I built

FLUID is a browser-based audiovisual instrument: a full-screen WebGL fluid
field you play by touching it. Pressing or dragging anywhere sounds a note
synthesised live with the Web Audio API — no pre-recorded samples — quantised
to a pentatonic scale so nothing you do sounds wrong. Horizontal position
picks the pitch, vertical position sets filter brightness (which also drives
the field's colour), and gesture speed drives energy, glide, and a scatter of
particle sparkle. A low/mid/high breakdown of the instrument's own output
subtly moves the background field, so the space reads as breathing with the
sound rather than displaying it. It plays identically from a mouse, a
touchscreen, or the keyboard.

## The moments that mattered

1. **A loose idea produces a loose result; a real prompt plan doesn't.** My
   first attempt at the instrument skipped the engineering step: I described
   an idea to the agent and asked it to build it, without first pinning down
   the interaction model, the audio architecture, or the constraints the build
   had to hold to. It ran, `pnpm check` was green, and it still wasn't good —
   the build itself hadn't been under-specified in a way any test could catch
   ([`2a3faae`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-pangxuancong/commit/2a3faae)),
   so I rejected it and reverted rather than iterating on top of it
   ([`25ba1a4`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-pangxuancong/commit/25ba1a4)).
   For FLUID, I did the opposite: before any code, I worked out the product
   with ChatGPT, referencing concrete interaction and visual design I wanted,
   and turned that into a complete, detailed prompt plan — an explicit
   interaction model, a scoped Web Audio architecture, named tradeoffs, a
   definition of done — before the agent wrote a line
   ([`9f2699f`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-pangxuancong/commit/9f2699f)).
   That's what told me the difference was real: the implementation landed in
   one pass with `pnpm check` green throughout, and I approved it on the first
   listen — no revert needed this time
   ([`9f2699f...3e8f375`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-pangxuancong/compare/9f2699f...3e8f375)).
