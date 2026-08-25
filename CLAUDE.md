# COMP4020 prototype

Your starter repo for a COMP4020 prototype: a static site built with Astro
(HTML/CSS/TypeScript underneath) that builds to plain HTML/CSS/JS and deploys to
GitHub Pages. The deployed site is what gets marked, not this repo.

The
[course website](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/)
publishes this deliverable's brief and spec, and this repo's name tells you
which deliverable applies. Read both before you plan or build.

## How to work in here

- Keep the dev server running (`pnpm dev`) so you see changes as you make them.
- Run `pnpm check` before you push.
- Open the page in a browser and look at it. The rendered page is the truth;
  your mental model of it isn't.
- When a check fails, read its output before you change anything.
- Never commit a red state.

## The link-preview card

`public/card.png` (1200x630) is the image a shared link shows;
`src/layouts/Layout.astro` points at it via the `title`/`description` props
every page passes in. Replace the image and pass a real per-page description;
the card URL resolves as an absolute URL against `astro.config.ts`'s `site`, so
it works the same on every page without copy-pasting a head block.

## The checks

`pnpm check` runs them (`pnpm check:evidence` is the extra gate before you
ship); CI runs the same plus links, secrets and the deploy. Read the failure.

`spec/README.md`, `PROCESS.md` and `reflections/README.md` are in this repo and
say what they are for.

## Animation Workflow Guidelines

### 1. Requirements Clarification (Before Implementation)
Whenever the user requests adding or updating an animation, prioritize asking clarifying questions before writing code:
- **Duration & Timing:** Desired duration (ms/s), delay, easing curve (e.g., linear, ease-in-out, spring physics).
- **Visual Style & Tone:** Minimalist, playful, cinematic, micro-interaction, or subtle hover effects.
- **Trigger & Scope:** Triggered on scroll (viewport intersection), click, hover, page load, or route transition.
- **Performance Constraints:** Mobile responsiveness, reduced-motion preferences (`prefers-reduced-motion`).

### 2. Runtime Verification & Tool Check (After Implementation)
Static code analysis or build success does not guarantee visual execution. Always perform runtime verification:
- **Dev Server Validation:** Ensure the local dev server is running and the component mounts without runtime errors in the console.
- **Tool-Assisted Check:** Use available browser automation/inspection tools (e.g., Puppeteer, Playwright, Chrome DevTools MCP, or browser screenshot tools) to verify that:
  - Keyframes, CSS transitions, or JS animation libraries (e.g., Framer Motion, GSAP) actually trigger in the DOM.
  - No CSS conflicts (e.g., `overflow: hidden`, z-index, missing initial opacity/transform states) prevent the animation from rendering visually.
- **Fallback Handling:** Confirm the UI degrades gracefully if JavaScript is disabled or animations fail to load.

## This file is yours

A starting point, not a rulebook. As you learn what your prototype needs --- a
convention the work has to hold to, a sensor that keeps catching you out (a
linter, say), a fact about the stack that is easy to get wrong --- write it down
here and wire it into `check`. Growing this file is the work.
