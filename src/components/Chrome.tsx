import { useEffect, useState } from "react";

/**
 * The only React in this build: the corner chrome (title + nav) and the
 * "touch the sound" invite, both of which are UI-state transitions, not the
 * 60fps instrument itself. The engine in main.ts stays plain TypeScript —
 * it dispatches a "fluid:first-interaction" event rather than reaching into
 * this component's DOM, so React and the render loop never touch.
 *
 * Server-rendered by Astro, so the <h1> and <nav> that spec/invariants.test.ts
 * checks for are present in the built HTML with no client JS required.
 */
export default function Chrome(): React.ReactElement {
  const [entered, setEntered] = useState(false);
  const [interacted, setInteracted] = useState(false);

  useEffect(() => {
    // A frame after mount, not on it — so the fade-in is visible rather than
    // starting and finishing before the first paint.
    const raf = requestAnimationFrame(() => setEntered(true));

    const onFirstInteraction = (): void => setInteracted(true);
    window.addEventListener("fluid:first-interaction", onFirstInteraction);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("fluid:first-interaction", onFirstInteraction);
    };
  }, []);

  return (
    <>
      <header className={`chrome ${entered ? "entered" : ""}`}>
        <h1>FLUID</h1>
        <nav aria-label="Primary">
          <a href="https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/crits/04-instrument/">
            Brief
          </a>
        </nav>
      </header>

      <p id="invite" className={entered && !interacted ? "visible" : ""}>
        touch the sound
      </p>
    </>
  );
}
