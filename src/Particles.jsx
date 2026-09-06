import { useEffect, useRef } from "react";

/* ---------------------------------------------------------------------------
 * The starfield behind the dial.
 *
 * Stars fly outward and streak as they go. The line from where a star was last
 * frame to where it is now IS the streak — there is no separate trail to
 * manage, which is why the whole surface has to be repainted each frame rather
 * than cleared per star.
 *
 * ── WHAT WAS CHANGED FROM THE COMPONENT THIS CAME FROM, AND WHY ────────────
 *
 * It was written as a standalone full-page background. This is a layer inside
 * a tab, under three glass cards, on a phone. Six things had to change, and
 * every one of them is a bug the original would have brought with it.
 *
 * 1. NO OPAQUE BLACK. The original fills with rgba(0,0,0,1) every frame, which
 *    would lay pure black over the app's #121212 and show as a rectangle with
 *    a visible edge. It fills with the ground colour instead. The fill has to
 *    stay opaque — it is what erases last frame's streaks — but filling with
 *    the colour that is already there makes it invisible.
 *
 * 2. NO ALLOCATION PER FRAME. The original rebuilt its entire star array with
 *    .map(star => [...star]) on every tick: 513 arrays a frame, thirty thousand
 *    a second, all garbage. Positions live in Float32Arrays and are mutated in
 *    place. Nothing is allocated after setup.
 *
 * 3. NO LAYOUT READ PER FRAME. The original calls resize() inside its animation
 *    loop, and resize() reads clientWidth — a forced synchronous layout, sixty
 *    times a second, on a page with three backdrop-filtered cards over it.
 *    Resizing happens on the resize event, where it belongs.
 *
 * 4. ONE LOOP, NOT TWO. The original calls init() from its mount effect AND
 *    from a second effect keyed on a `start` flag that defaults to true. Both
 *    fire, both call animate(), and the second overwrites the rAF handle held
 *    by the first — so one loop is orphaned and can never be cancelled. It runs
 *    for the life of the page, drawing over the one you can see.
 *
 * 5. SPREAD IS NOT COUNT. The original's projection uses `quantity / 2` as its
 *    focal length, so changing how many stars there are silently changes how
 *    wide the field is — you cannot tune the count without redesigning the
 *    look. Here the geometry comes from the viewport and the count is free,
 *    which is what made it possible to take it from 180 down to a few dozen
 *    without touching anything else.
 *
 * 6. IT STOPS. Mounted for the life of the app because Sessions is, so an
 *    unconditional loop would repaint a full-screen canvas the whole time you
 *    are reading the guide. It runs while the tab is up and the document is
 *    visible, and not otherwise.
 *
 * The mouse, tilt and click-to-warp handlers are gone rather than ported. This
 * sits behind a dial you are reading and under cards you tap; a background that
 * reacts to the pointer would be competing with the tilt the Today card already
 * has. (In the original, click-to-warp does not work anyway: it writes
 * `hyperspace` into state while the render reads it from props.)
 *
 * THE FADE, AND WHY IT SURVIVES INTACT. Everything below the drawing model is
 * the machinery this file already had — see the note on `follow` — and it is
 * the part that took three attempts to get right. It is untouched.
 * ------------------------------------------------------------------------- */

/* Few, and that is the brief. The first version ran 180 and the count was not
   the problem — see the note on MAX_DPR, the cost is pixels — but a hundred and
   eighty streaks read as weather rather than as a background. */
const COUNT = 52;

/* ── WHY THIS IS POLAR AND NOT A z BUFFER ──────────────────────────────────
 *
 * The first version placed stars at a random (x, y, z) and projected them with
 * x/z, which is the textbook starfield and which piles up in the middle. Two
 * reasons, and they compound:
 *
 *   · Screen radius is proportional to 1/z, so a z spread evenly through the
 *     volume puts most stars at a small radius. Most of the field sits in the
 *     middle at any instant.
 *   · Recycled stars all restart at the far plane, which IS the middle. So the
 *     centre is also where every star is born.
 *
 * Together they read as a hole in the middle that everything crawls out of.
 *
 * Radius is the state here instead of depth. A star lives on a ring between
 * INNER and OUTER and grows outward; nothing is ever placed inside INNER, so
 * the middle — where the dial is, and where you are reading — simply has no
 * stars in it. The perspective feel survives because the growth is
 * multiplicative: a star at twice the radius moves twice as fast and streaks
 * twice as long, which is exactly what x/z was doing, without the pile-up. */

/* Multiplied into the radius each frame. The streak a star leaves is
   rad * (GROW - 1) long, so this sets speed and streak length together — they
   are the same number, which is why they always look consistent. */
const GROW = 1.0075;

/* Where the ring starts, as a fraction of the half-height. Outside the dial:
   the middle of this screen is a clock you are reading, and a star behind it is
   both invisible and in the way. */
const INNER = 0.62;

/* Where a star is recycled, as a fraction of the half-diagonal. Past 1 so they
   leave through the corners rather than vanishing at the edges. */
const OUTER = 1.18;

/* The app's ground. Keep in step with html/body in index.html and the ground
   note at the top of shell.css — a mismatch here shows as a rectangle. */
const GROUND = "#121212";

/* See the note where this is used: the surface fill is the cost of a streak
   field, and it scales with pixels rather than with stars. */
const MAX_DPR = 1;

/* Seeded, so the field is identical on every open rather than reshuffling.
   This sits under a dial you are reading, and a background that rearranges
   itself every time you glance at it is a background you notice. */
const seeded = (n) => Math.abs(Math.sin(n * 9999.123 + 78.233) * 43758.5453) % 1;

export default function Particles({ active }) {
  const canvasRef = useRef(null);
  const runRef = useRef({ start: null, stop: null });

  // ---- setup: once, on mount. Never keyed on `active`. --------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;

    const reduced = window.matchMedia
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    /* ONE DEVICE PIXEL PER CSS PIXEL, AND THIS IS THE WHOLE PERFORMANCE STORY.
     *
     * Unlike the dots this replaces, a streak field cannot use a dirty-rect
     * clear: the trail IS the line from last frame to this one, and what erases
     * the previous frame is a fill of the entire surface. That fill is the cost,
     * and it scales with pixels, not with stars. Measured at 6x CPU throttle,
     * 360 frames, counting frames that took over 33ms:
     *
     *     180 stars, DPR 2     77        60 stars, DPR 2     23
     *     180 stars, DPR 1      0        60 stars, DPR 1      0
     *
     * The star count barely matters; the pixel count decides everything. So the
     * cap is 1, and it costs nothing visible — these are hairline white lines on
     * a near-black ground, which is the one thing a second device pixel cannot
     * improve.
     *
     * Where that leaves the field as it actually ships, on the same bench: the
     * tab drops 10 frames with it and 8 with the canvas hidden, so the
     * background costs TWO. The drifting field it replaces cost 84.
     *
     * Written as a cap rather than a literal 1 so raising it is one character,
     * and so it can never exceed the device's own ratio. */
    const dpr = Math.min(MAX_DPR, Math.max(1, window.devicePixelRatio || 1));

    let raf = 0;
    let w = 0;
    let h = 0;
    let cx = 0;
    let cy = 0;
    let inner = 0;
    let outer = 0;
    let span = 1;             // log(outer / inner), for the spawn distribution

    /* One allocation each, at setup. `ang` and `rad` are the star; `pr` is the
       radius it was drawn at last frame, and the streak is the gap between
       them. `fresh` marks the frame after a recycle, where that gap would be
       the whole screen and has to be skipped. */
    const ang = new Float32Array(COUNT);
    const rad = new Float32Array(COUNT);
    const pr = new Float32Array(COUNT);
    const fresh = new Uint8Array(COUNT);

    /* LOG-UNIFORM, AND THAT IS THE WHOLE TRICK.
     *
     * Radius grows by a constant FACTOR each frame, so log(radius) grows by a
     * constant amount — which means a field spread evenly in log(radius) stays
     * spread evenly for ever. Spread it evenly in radius instead and it
     * immediately bunches at the inside, which is the pile-up this rewrite
     * exists to remove, arriving by a different door. */
    const put = (i, a, u) => {
      ang[i] = a * Math.PI * 2;
      rad[i] = inner * Math.exp(u * span);
      fresh[i] = 1;
    };

    /* Seeded on the opening field so it is identical on every load. A star that
       flies off the edge and is recycled takes a plain random — by then the
       pattern has long stopped being reproducible, and pretending otherwise
       would just make the field repeat itself. */
    const seed = () => {
      for (let i = 0; i < COUNT; i++) put(i, seeded(i + 1.3), seeded(i + 5.5));
    };
    /* Recycled stars come back at the INNER edge, not at a random radius: they
       are replacing one that just left, and the steady state above only holds
       if they re-enter where the flow starts. */
    const recycle = (i) => { put(i, Math.random(), 0); };

    /* How much of the field should be showing: exactly as much of the surface
       it belongs to as is currently showing.

       Reading it off the pane rather than re-deriving it is the point. Every
       previous attempt matched the pane's fade by writing the same duration,
       delay and easing somewhere else and trusting the two to agree — and each
       time the browser composited them out of step anyway. There is nothing to
       drift here: it is the same number. */
    let paneEl = null;
    const surfaceOpacity = () => {
      if (!paneEl || !paneEl.isConnected) {
        const sc = document.querySelector(".sess-scroll");
        paneEl = sc ? sc.closest(".pane") : null;
      }
      if (!paneEl) return 1;
      const cs = getComputedStyle(paneEl);
      if (cs.visibility === "hidden") return 0;
      const o = parseFloat(cs.opacity);
      return Number.isFinite(o) ? o : 1;
    };

    const wipe = () => { ctx.clearRect(0, 0, w, h); };

    const BUCKETS = 3;
    const WIDTHS = [0.6, 0.9, 1.3];
    const ALPHAS = [0.13, 0.22, 0.34];
    let prevInner = 0;

    const draw = (move, fade) => {
      /* Opaque, and with the ground's own colour. This fill is what erases the
         previous frame — a transparent clear would leave every streak on the
         canvas for ever — and using #121212 makes an opaque layer invisible
         against the ground it sits on. */
      ctx.fillStyle = GROUND;
      ctx.fillRect(0, 0, w, h);
      if (fade <= 0.001) return;

      if (move) {
        for (let i = 0; i < COUNT; i++) {
          rad[i] *= GROW;
          if (rad[i] > outer) recycle(i);
        }
      }

      /* Stroked in three width buckets rather than one path each. Every
         beginPath/stroke pair is a separate rasteriser run, so N stars cost N
         of them; bucketed by how far out they are they cost three, and the
         near/far difference that lineWidth was carrying survives. */
      for (let b = 0; b < BUCKETS; b++) {
        ctx.lineWidth = WIDTHS[b];
        ctx.beginPath();
        let any = false;

        for (let i = 0; i < COUNT; i++) {
          const r = rad[i];
          /* Bucketed on the same log scale the field is spread on, so the three
             bands hold roughly equal numbers instead of the outer one holding
             almost everything. */
          const k = Math.log(r / inner) / span;
          if (Math.floor(k * BUCKETS * 0.999) !== b) continue;

          const c = Math.cos(ang[i]);
          const sn = Math.sin(ang[i]);
          const nx = cx + c * r;
          const ny = cy + sn * r;

          if (!fresh[i]) {
            /* Off-screen is the common case out near OUTER, and skipping it
               here is cheaper than asking the rasteriser to clip. */
            if (nx > -30 && nx < w + 30 && ny > -30 && ny < h + 30) {
              ctx.moveTo(cx + c * pr[i], cy + sn * pr[i]);
              ctx.lineTo(nx, ny);
              any = true;
            }
          }
          pr[i] = r; fresh[i] = 0;
        }

        if (any) {
          /* Outer stars are brighter, and the whole set is scaled by how much of
             the pane is showing — the fade lives in the PIXELS, which is what
             keeps it from being composited out of step with the surface. */
          const a = ALPHAS[b] * fade;
          ctx.strokeStyle = `rgba(255,255,255,${a.toFixed(3)})`;
          ctx.stroke();
        }
      }
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const nw = Math.max(1, rect.width);
      const nh = Math.max(1, rect.height);
      if (nw === w && nh === h) return;
      const first = w === 0;
      w = nw; h = nh;
      cx = w / 2; cy = h / 2;
      inner = INNER * (h / 2);
      outer = OUTER * (Math.hypot(w, h) / 2);
      span = Math.log(outer / inner);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = "round";
      /* Re-seeding on a resize would blank and teleport the field. Only the
         first sizing seeds; afterwards the angles are kept and the radii are
         rescaled, so the same field simply arrives at the new size. */
      if (first) seed();
      else {
        const k = inner / prevInner || 1;
        for (let i = 0; i < COUNT; i++) { rad[i] *= k; fresh[i] = 1; }
      }
      prevInner = inner;
      draw(false, surfaceOpacity());
    };

    const stop = () => { if (raf) { cancelAnimationFrame(raf); raf = 0; } };

    /* Two things run this loop and they are separate on purpose.

       FLIGHT is the field doing its job. It runs for as long as the tab is up,
       and it is the reason the loop has no natural end.

       FOLLOW is the field matching the surface's opacity while that opacity is
       moving. It draws without advancing anything, and it stops as soon as the
       number reaches its target — which is how the field can leave with the
       tab and still be cleared once it has gone. */
    let flying = false;
    let target = 0;           // where the surface's opacity is heading
    let deadline = 0;         // hard stop, so following can never spin

    const loop = () => {
      const fade = surfaceOpacity();
      draw(flying, fade);
      const arrived = Math.abs(fade - target) <= 0.002 || performance.now() > deadline;
      if (!flying && arrived) { if (fade <= 0.001) wipe(); raf = 0; return; }
      raf = requestAnimationFrame(loop);
    };
    const kick = () => {
      if (raf || reduced || document.hidden) return;
      raf = requestAnimationFrame(loop);
    };
    /* A TARGET, not a threshold. Testing "has it settled at 0 or 1" looks
       equivalent and is exactly backwards: those are the values the fade STARTS
       from. Leaving, the first frame reads 1 and the loop quit on the spot,
       leaving the field painted at full strength over the outgoing surface —
       which is the flash, still there after three fixes aimed elsewhere.
       Arriving, the first frame reads 0 and it quit just as fast, leaving the
       canvas blank until the flight loop started a second later. */
    const follow = (to) => { target = to; deadline = performance.now() + 900; kick(); };
    const start = () => { flying = true; kick(); };
    const halt = () => { flying = false; };
    runRef.current = { start, stop, follow, halt };

    // A background that keeps animating in a backgrounded tab is a battery
    // bug, not a feature.
    /* Coming back has to work from every direction a browser offers, because
       they do not agree on which one fires. Backgrounding a tab gives you
       visibilitychange; minimising the window or switching apps on iOS can
       give you pageshow (out of the back/forward cache) or nothing but focus.
       Miss the one your browser used and the field is simply stopped — which
       is what "when I minimise it the same thing happens" is. */
    const resume = () => { if (!document.hidden && flying) kick(); };
    const onVisibility = () => { if (document.hidden) stop(); else resume(); };

    resize();
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", resume);
    window.addEventListener("focus", resume);
    return () => {
      stop();
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", resume);
      window.removeEventListener("focus", resume);
      runRef.current = { start: null, stop: null, follow: null, halt: null };
    };
  }, []);

  /* ---- run ---------------------------------------------------------------
   * Follow the surface's opacity through every switch, in both directions, and
   * fly only while the tab is up.
   * ---------------------------------------------------------------------- */
  useEffect(() => {
    const r = runRef.current;
    if (!r.follow) return undefined;
    if (!active) { r.halt(); r.follow(0); return undefined; }
    r.follow(1);
    r.start();
    return undefined;
  }, [active]);

  return (
    <canvas
      ref={canvasRef}
      className="sess-particles"
      aria-hidden="true"
      role="presentation"
    />
  );
}
