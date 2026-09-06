import { useEffect, useRef, useState } from "react";

/**
 * Hosts one of the vendored static tools (the card editor, the guide) in an
 * iframe.
 *
 * Three properties matter and are easy to lose in a refactor:
 *
 *  1. Deferred, not lazy. Nothing loads during boot, so the shell still starts
 *     as fast as the calculator alone — but once the app is idle both panes
 *     mount themselves in the background via `preload`. Waiting until the tab
 *     is actually opened meant the first switch paid for parsing the whole
 *     document: the guide is 92KB and it stalled the main thread for roughly
 *     half a second, which is most of what read as a "jump".
 *  2. Permanent — once mounted the <iframe> element is never removed. Hiding
 *     uses visibility, never display:none, which is a documented iframe-reload
 *     hazard in some WebKit versions. This is what keeps the user's loaded
 *     screenshot, crop, zoom and every control value alive across tab switches.
 *  3. It must exist before it is shown. A node inserted into the DOM already
 *     at its final opacity has no previous value to transition from, so the
 *     fade silently does not happen — which is why the pane used to appear at
 *     full opacity however long the transition was set to. `pane-on` carries a
 *     keyframe animation rather than a transition for exactly this reason:
 *     animations run on freshly inserted elements, transitions do not.
 *
 * The pane always runs full height. It reserves nothing for the tab pill: the
 * pill floats, content scrolls under it, and each vendored file carries its own
 * bottom clearance so its last control still comes clear at the end of a
 * scroll. Reserving space here instead turned the pill into a plinth with a
 * band of dead ground beneath it.
 * Safe-area insets do not propagate into an iframe, so they are applied here.
 */
export default function StaticPane({ active, preload, src, title, background }) {
  const [mounted, setMounted] = useState(false);
  // A pane that has never been opened must not play the leaving animation —
  // it would fade *in* from opacity 1 on its way out and flash a surface the
  // user never asked for. Only a pane that has actually been shown can leave.
  const opened = useRef(false);
  if (active) opened.current = true;

  useEffect(() => {
    if (active || preload) setMounted(true);
  }, [active, preload]);

  if (!mounted) return null;

  const state = active ? "pane-on" : opened.current ? "pane-off" : "pane-hidden";

  return (
    <div
      className={`pane ${state}`}
      aria-hidden={!active}
    >
      <iframe
        className="pane-frame"
        style={background ? { background } : undefined}
        src={`${import.meta.env.BASE_URL}${src}`}
        title={title}
        allow="clipboard-write; web-share"
      />
    </div>
  );
}
