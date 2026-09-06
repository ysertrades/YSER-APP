import { useEffect, useRef } from "react";

/* ---------------------------------------------------------------------------
 * Tilt for the Today card.
 *
 * Adapted from the Framer component rather than ported. Three things about the
 * original do not survive contact with this app, and each one is the difference
 * between an effect and a bug.
 *
 * 1. IT MUST NOT RE-RENDER. The original holds the angle in React state and
 *    sets it on every mousemove — sixty renders a second. Here that would
 *    re-render Sessions, and Sessions contains the dial: every arc, every mark,
 *    the sweep and the live clock, rebuilt on every pixel of pointer movement.
 *    The angle is written straight to the node's style instead, coalesced into
 *    one rAF, and React never hears about it.
 *
 * 2. IT MUST WORK WITHOUT A MOUSE. A hover effect on a phone is nothing at all,
 *    and this app is used on a phone. Touch gets the same tilt from a press —
 *    the card leans toward your thumb and settles back when you let go.
 *
 * 3. A SCROLL IS NOT A TILT. The card lives in a scrolling column, so a drag
 *    that starts on it is far more likely to be someone scrolling past. iOS
 *    fires pointercancel the moment the browser takes the gesture over for
 *    scrolling, and the scroller's own scroll event is belt to that brace: the
 *    tilt lets go instantly either way and the card never fights the finger.
 *
 * No glare, deliberately — the version this came from had it removed, and on a
 * translucent card over a drifting field a white wash would sit on top of the
 * one thing the glass is there to show.
 * ------------------------------------------------------------------------- */

/* Degrees at the far edge. Different per axis because the card is wide and
   short: the same angle that reads as a lean around Y reads as the card
   falling over when it is applied around X across a much shorter side. */
const MAX_X = 7;
const MAX_Y = 9;
/* Toward the viewer, in px, against the wrapper's 900px perspective — about
   1.3% of apparent scale. The original used a 1.05 scale, which on a card this
   wide is 18px of growth per side and reads as a jump rather than a lift. */
const LIFT = 12;

export default function useTilt() {
  const wrapRef = useRef(null);
  const cardRef = useRef(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const card = cardRef.current;
    if (!wrap || !card) return undefined;
    if (window.matchMedia
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;

    let raf = 0;
    let rx = 0, ry = 0, tz = 0;
    let live = false;
    let held = null;               // the pointer id currently holding the card

    const paint = () => {
      raf = 0;
      /* Cleared to "" rather than set to a zero rotation when it comes to rest.
         An identity transform is still a transform: it keeps the element in a
         3D rendering context, and the card carries a backdrop-filter that the
         engine then has to keep re-resolving for a movement that has finished. */
      card.style.transform = (rx || ry || tz)
        ? `rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) translateZ(${tz.toFixed(1)}px)`
        : "";
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(paint); };

    const aim = (e) => {
      const r = card.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const nx = (e.clientX - r.left) / r.width - 0.5;      // -0.5 … 0.5
      const ny = (e.clientY - r.top) / r.height - 0.5;
      rx = -ny * 2 * MAX_X;         // pointer low tips the top toward you
      ry = nx * 2 * MAX_Y;
      tz = LIFT;
      schedule();
    };

    const engage = () => { if (!live) { live = true; card.classList.add("sess-block-live"); } };
    const release = () => {
      live = false; held = null;
      card.classList.remove("sess-block-live");
      rx = 0; ry = 0; tz = 0;
      schedule();
    };

    const onEnter = (e) => { if (e.pointerType === "mouse") { engage(); aim(e); } };
    const onMove = (e) => {
      if (e.pointerType === "mouse") { engage(); aim(e); return; }
      if (held === e.pointerId) aim(e);
    };
    const onLeave = (e) => { if (e.pointerType === "mouse") release(); };
    const onDown = (e) => {
      if (e.pointerType === "mouse") return;      // hover already has it
      held = e.pointerId; engage(); aim(e);
    };
    const onUp = (e) => { if (held === e.pointerId) release(); };

    card.addEventListener("pointerenter", onEnter);
    card.addEventListener("pointermove", onMove);
    card.addEventListener("pointerleave", onLeave);
    card.addEventListener("pointerdown", onDown);
    card.addEventListener("pointerup", onUp);
    card.addEventListener("pointercancel", onUp);
    const scroller = card.closest(".sess-scroll");
    if (scroller) scroller.addEventListener("scroll", release, { passive: true });

    return () => {
      if (raf) cancelAnimationFrame(raf);
      card.removeEventListener("pointerenter", onEnter);
      card.removeEventListener("pointermove", onMove);
      card.removeEventListener("pointerleave", onLeave);
      card.removeEventListener("pointerdown", onDown);
      card.removeEventListener("pointerup", onUp);
      card.removeEventListener("pointercancel", onUp);
      if (scroller) scroller.removeEventListener("scroll", release);
      card.style.transform = "";
      card.classList.remove("sess-block-live");
    };
  }, []);

  return { wrapRef, cardRef };
}
