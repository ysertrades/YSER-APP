import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Calculator from "./Calculator";
import Sessions from "./Sessions";
import StaticPane from "./StaticPane";
import TabBar from "./TabBar";
import { useAutoHideOnScroll, usePrefersReducedMotion } from "./useShellHooks";

/* How long the calculator takes to leave, in ms. Must match --pane-out in
   shell.css: the incoming pane's delay is set from the same budget, so if these
   drift apart the two surfaces start overlapping again. */
const LEAVE_MS = 140;

/* How long the landing tab's entrance needs the main thread to itself, from the
   moment the intro clears. The dial's sweep is the long pole — see SWEEP_MS in
   Sessions.jsx — and it is the thing that visibly breaks if anything heavy runs
   underneath it. */
const ENTRANCE_MS = 1500;

/**
 * Shell. Holds the tab and renders all four surfaces at once — nothing is
 * ever conditionally unmounted:
 *
 *   - the calculator, because SessionBlock's staggered entrance animation
 *     replays on remount and looks jumpy
 *   - sessions, because its clock would restart its first tick on every switch
 *   - the editor, because it holds the user's loaded screenshot and framing
 *   - the guide, because it holds your place in the deck
 */
export default function App() {
  const [tab, setTab] = useState("sessions");   // the landing tab
  const flowScrollY = useRef(0);
  // Where the Back button in the guide returns you to.
  const cameFrom = useRef("sessions");

  const reduced = usePrefersReducedMotion();
  // Only the calculator scrolls the document; the other two are iframes whose
  // scrolling the parent never sees. Under reduced motion the bar stays put.
  const barHidden = useAutoHideOnScroll({ active: tab === "flow" && !reduced });

  const goTab = useCallback((next) => {
    setTab((cur) => {
      if (next === cur) return cur;
      if (cur === "flow") flowScrollY.current = window.scrollY;
      if (next === "guide") cameFrom.current = cur;
      return next;
    });
  }, []);

  // The guide is a destination, not a pane: it takes the whole screen and the
  // switcher gets out of the way, so its own nav pill carries the only exit.
  // It asks for it by postMessage — same origin, since it is served from our
  // own BASE_URL. guide:close is the older name the editor's panel used to
  // answer; honoured so an out-of-date vendored copy still gets out.
  useEffect(() => {
    const onMessage = (e) => {
      if (e.origin !== window.location.origin) return;
      const d = e.data;
      if (!d || typeof d !== "object") return;
      if (d.type === "guide:back" || d.type === "guide:close") {
        goTab(cameFrom.current || "flow");
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [goTab]);

  // Hiding .wrap with display:none collapses the document height, so the
  // browser clamps scrollY to 0. Without this the calculator jumps back to the
  // top every time you leave and return. Do not remove.
  useLayoutEffect(() => {
    if (tab === "flow") window.scrollTo(0, flowScrollY.current);
  }, [tab]);

  /* The calculator's half of the handover. display:none is not animatable, so
     it needs three states rather than two: on screen, leaving, gone.

     This used to be a boolean that held the calculator displayed for 240ms
     while the incoming pane faded up over it. Both surfaces are dark with light
     type, so for most of that window you could read BOTH — the calculator's
     labels crossing the dial's, doubled and offset. It read as the app
     struggling rather than as a transition. Now it fades out on its own clock
     and the incoming pane waits for it to go. */
  const [flowPhase, setFlowPhase] = useState(tab === "flow" ? "on" : "off");
  useEffect(() => {
    if (tab === "flow") { setFlowPhase("on"); return undefined; }
    if (reduced) { setFlowPhase("off"); return undefined; }
    // Already gone: do not replay the fade every time you move between two
    // surfaces that are both not the calculator.
    setFlowPhase((p) => (p === "off" ? "off" : "leaving"));
    const t = setTimeout(() => setFlowPhase("off"), LEAVE_MS);
    return () => clearTimeout(t);
  }, [tab, reduced]);

  /* The launch intro covers the app for about a second and a half. Sessions is
     the landing tab, so without this the dial powers up underneath the overlay
     and you arrive to an animation that has already finished. The timeout is
     the backstop — the intro's CSS clears it without any help from script, so
     nothing here may depend on an event that might not come. */
  const [booted, setBooted] = useState(() => !document.getElementById("intro"));
  useEffect(() => {
    const el = document.getElementById("intro");
    if (!el) { setBooted(true); return undefined; }
    const done = (e) => { if (!e || e.target === el) setBooted(true); };
    el.addEventListener("animationend", done);
    const t = setTimeout(done, 2600);
    return () => { el.removeEventListener("animationend", done); clearTimeout(t); };
  }, []);

  /* Both panes mount themselves once the app has gone quiet. Deferring until a
     tab is opened meant the first switch paid to parse the whole document — the
     guide is 92KB and blocked the main thread for ~500ms, which is most of what
     the switch felt like.
 
     But "quiet" has to mean quiet. This used to arm a requestIdleCallback
     immediately, which meant the browser was free to spend its first idle
     moment parsing two vendored documents — and the app's first idle moment is
     exactly when the intro clears and the landing tab plays its entrance.
     Measured on a cold launch at 6x CPU throttle, that landed as sporadic
     175-215ms main-thread blocks, and the dial's sweep stopped dead in the
     middle of them. Which is what "it gets stuck and then jumps" is.
 
     So: nothing until the intro has gone, and then nothing until the entrance
     has finished. Someone who switches tabs inside that first second and a half
     pays the parse cost at the switch instead, which is the older behaviour and
     the better trade. */
  const [preload, setPreload] = useState(false);
  useEffect(() => {
    if (!booted) return undefined;
    const arm = () => setPreload(true);
    let idle;
    const t = setTimeout(() => {
      if (typeof requestIdleCallback === "function") {
        idle = requestIdleCallback(arm, { timeout: 2500 });
      } else arm();
    }, ENTRANCE_MS);
    return () => {
      clearTimeout(t);
      if (idle && typeof cancelIdleCallback === "function") cancelIdleCallback(idle);
    };
  }, [booted]);

  return (
    <>
      <Calculator phase={flowPhase} />

      {/* A React surface, not a vendored file, so it goes in directly rather
          than through StaticPane — but it carries the same .pane classes, so
          the crossfade is identical to the two iframes below. */}
      <Sessions active={tab === "sessions"} ready={booted} />

      <StaticPane
        active={tab === "card"}
        preload={preload}
        src="card/index.html"
        title="Trade card editor"
        background="#121212"  /* the editor's own body colour, so its first
                                 paint is already right. This was #eeeeee, which
                                 made the editor the one bright rectangle in a
                                 dark app; it is dark now and the only lit thing
                                 on it is the card preview. Keep in step with
                                 --ground in card/index.html. */
      />
      <StaticPane
        active={tab === "guide"}
        preload={preload}
        src="card/guide.html"
        title="Trades card editor field guide"
        background="#121212"  /* the app's ground, which is now the deck's too —
                                 keep in step with --ground in card/guide.html or
                                 the first paint steps colour before the document
                                 arrives */
      />

      {/* Hidden on the guide tab, using the same slide-away the bar already
          performs on scroll. Reading is the one thing here that deserves the
          whole screen. */}
      <TabBar tab={tab} onChange={goTab} hidden={barHidden || tab === "guide"} />
    </>
  );
}
