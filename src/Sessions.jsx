import { useEffect, useMemo, useRef, useState } from "react";
import Particles from "./Particles";
import { useEtTick, readDay, fmtCountdown, MARKS, RING_SESSIONS } from "./sessions";
import useTilt from "./useTilt";
import Feed from "./Feed";

/* ---------------------------------------------------------------------------
 * Sessions — the trading day as a 24-hour dial.
 *
 * Why a ring and not a bar: a day laid flat across a phone gives roughly 16px
 * an hour, and every window collapses into a sliver you cannot label. On a ring
 * each window gets a real arc, and "how long until the next one" becomes a
 * distance you can see rather than a number you have to read. Midnight at the
 * top, noon at the bottom, clockwise.
 *
 * Two rings, because the silver bullet sits ENTIRELY INSIDE the NY killzone.
 * On one ring the shorter arc would simply be painted over the longer one.
 * Outer is the sessions, inner is the window within a session.
 *
 * The colour is deliberately not a per-session palette. Arcs are neutral;
 * green means open right now and blue means up next — exactly the two meanings
 * those colours already carry in the calculator, so nothing has to be relearned
 * moving between tabs.
 * ------------------------------------------------------------------------- */

const CX = 150, CY = 150, R_OUT = 104, R_IN = 85;
const OPEN = "#4ADE80";
const NEXT = "#0a84ff";
/* Keep in step with .sess-now-sweep in shell.css — the phase is released from
   JS on a timer, so if the two drift the marker either jumps to live mid-travel
   or sits frozen after it has arrived. */
const SWEEP_MS = 1150;

const dur = fmtCountdown;   // everything on this screen counts in seconds
const ptAt = (m, r) => {
  const a = (m / 1440) * 2 * Math.PI - Math.PI / 2;
  return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
};

/* An arc as a dash on a circle rather than a hand-built path: the visible dash
 * is the window's share of the day, and the offset is where it starts. One line
 * of maths instead of an arc-flag puzzle.
 *
 * Every arc is a GROUP, even when it is a single stroke. The group is what
 * animates: it carries --arc-len (which every circle inside reads for its dash
 * length), the stagger index, the draw-on and the breath. One animation drives
 * the whole arc however many strokes it is made of.
 *
 * A glowing arc is three strokes, because the glow used to be an SVG Gaussian
 * blur and that was the most expensive thing on the screen. A filter is
 * re-rasterised on every frame its input changes — which meant every frame of
 * the draw-on, the sweep, the beat and the breath, all of which change
 * something underneath it. Two wider strokes at low alpha stand in for the
 * blur's falloff and cost what any other stroke costs.
 *
 * Two, not one: a single wide stroke has a hard edge where a blur has a
 * gradient, and at these alphas you can see it. The second layer was measured
 * at 6x CPU throttle and came out inside the run-to-run noise, so the softer
 * version is simply free. There is no filter left anywhere in the dial. */
function Arc({ r, start, end, stroke, width, glow, live, track, i = 0 }) {
  const C = 2 * Math.PI * r;
  const len = ((end - start) / 1440) * C;
  const geom = {
    cx: CX, cy: CY, r, fill: "none",
    strokeLinecap: "round",
    strokeDashoffset: -((start / 1440) * C),
    transform: `rotate(-90 ${CX} ${CY})`,
  };
  /* Stroke goes in `style`, not as an attribute. A presentation attribute is
     the lowest rung of the cascade and Chromium will not run a transition off
     a change to one — which is why the colour used to snap the moment a window
     opened. In `style` it is a normal declaration and `transition: stroke`
     works. */
  const paint = (w, o) => ({ ...geom, strokeWidth: w, style: { stroke, opacity: o } });
  return (
    <g
      className={`sess-arc-g${track ? " sess-track-g" : ""}${live ? " sess-arc-live" : ""}`}
      /* --arc-len is inherited (see @property in shell.css) so setting it here
         reaches every stroke in the group. Tracks set it too, or the
         stylesheet's 0px initial value would leave the ring blank. */
      style={{ "--arc-len": `${len}px`, "--i": i }}
    >
      {/* The halo is always in the DOM, at zero opacity when the window is not
          lit. Rendering it only when it glows meant it appeared by MOUNTING,
          and a mount cannot transition — the glow popped into existence the
          second a session opened. Present and transparent, it fades. */}
      {!track && <circle className="sess-arc sess-halo" {...paint(width + 15, glow ? 0.07 : 0)} />}
      {!track && <circle className="sess-arc sess-halo" {...paint(width + 7,  glow ? 0.13 : 0)} />}
      <circle className="sess-arc" {...paint(width, 1)} />
    </g>
  );
}

/* Built once, at module scope. None of it depends on the time, so re-creating
   it on every clock tick was ~30 nodes a second of reconciliation for a drawing
   that never changes. Stable element identity lets React skip the subtree
   entirely. */
const DIAL_FURNITURE = (
  <>
    {/* hour ticks, heavier every six */}
    <g className="sess-ticks">
      {Array.from({ length: 24 }, (_, h) => {
        const major = h % 6 === 0;
        const a = ptAt(h * 60, R_OUT + 9);
        const b = ptAt(h * 60, R_OUT + (major ? 17 : 13));
        return <line key={h} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]}
          stroke={major ? "rgba(255,255,255,.30)" : "rgba(255,255,255,.10)"}
          strokeWidth={major ? 1.6 : 1} strokeLinecap="round" />;
      })}
    </g>
    <g className="sess-hours">
      {[[0, "12a"], [360, "6a"], [720, "12p"], [1080, "6p"]].map(([m, label]) => {
        const p = ptAt(m, R_OUT + 30);
        return <text key={label} x={p[0]} y={p[1]} fill="rgba(255,255,255,.34)"
          fontSize="10.5" fontWeight="700" textAnchor="middle"
          dominantBaseline="central" letterSpacing=".08em"
          style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{label}</text>;
      })}
    </g>
    <g className="sess-tracks">
      <Arc track r={R_OUT} start={0} end={1440} stroke="rgba(255,255,255,.055)" width={12} />
      <Arc track r={R_IN}  start={0} end={1440} stroke="rgba(255,255,255,.04)"  width={7} />
    </g>
  </>
);

/* instants, drawn across both rings — also fixed for all time */
const DIAL_MARKS = (
  <g className="sess-marks">
    {MARKS.map((mk) => {
      const a = ptAt(mk.minute, R_IN - 7), b = ptAt(mk.minute, R_OUT + 6);
      return <line key={mk.key} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]}
        stroke="rgba(255,255,255,.13)" strokeWidth={1} strokeDasharray="2 3" />;
    })}
  </g>
);

/* The order the day runs the windows in, for the draw-on stagger. Fixed, so it
   does not want re-sorting inside a render — it used to be an inline
   [...ring].sort().indexOf(w) evaluated once PER ARC, per tick. */
const RING_ORDER = RING_SESSIONS.map((w) => w.key)
  .sort((a, b) => RING_SESSIONS.find((w) => w.key === a).start
                - RING_SESSIONS.find((w) => w.key === b).start);

function colourFor(w, nextKey, ahead, done) {
  if (w.state === "open") return OPEN;
  if (w.key === nextKey) return NEXT;
  return w.state === "ahead" ? ahead : done;
}

function Row({ w, nextKey, closed, sub }) {
  const isOpen = w.state === "open";
  const isNext = w.key === nextKey;
  const cls = isOpen ? "open" : isNext ? "next" : w.state === "done" ? "done" : "";
  const bul = isOpen ? "on" : isNext ? "next" : w.state === "done" ? "done" : "";
  const right = closed ? "—"
    : isOpen ? `${dur(w.remaining)} left`
    : w.state === "done" ? "done" : `in ${dur(w.until)}`;
  return (
    <div className={`sess-row ${cls}${sub ? " sess-sub" : ""}`}>
      {sub && <span className="sess-tee" aria-hidden="true" />}
      <span className={`sess-bul ${bul}`} aria-hidden="true" />
      <span className="sess-nm">{w.name}</span>
      <span className="sess-at">{w.at}</span>
      <span className="sess-st">{right}</span>
    </div>
  );
}

export default function Sessions({ active, ready = true, now }) {
  useEtTick(active);                 // ticks only while this tab is up
  const d = readDay(now);            // `now` is only ever passed by the tests
  const { closed, ring, sub, upcoming, nextKey, openSub, primary } = d;

  /* ---------------------------------------------------------------------
   * The entrance.
   *
   * One run per opening, not per mount: the dial is mounted for the life of
   * the app so its clock survives tab switches, so mounting is not the moment
   * anyone actually sees it. `run` keys the dial, which remounts it and
   * restarts every CSS animation inside — cheaper to reason about than
   * toggling classes and forcing reflows, and it is ~40 nodes.
   *
   * `ready` holds the very first run until the launch intro has cleared.
   * ------------------------------------------------------------------- */
  const shown = active && ready;
  const runRef = useRef(0);
  const wasShown = useRef(false);
  const [run, setRun] = useState(0);

  /* The marker has three phases, and it needs all three.
   *
   *   park  — sitting at midnight, no transition, for exactly one frame
   *   sweep — travelling to a FROZEN target, on the long ease
   *   live  — following the clock, on a 1s linear transition
   *
   * The frozen target is the fix for the thing that made the sweep look bad.
   * The clock re-renders once a second, and a CSS transition that is
   * re-targeted mid-flight restarts from wherever it had reached with its full
   * duration — so a tick landing a second into the sweep gave the last fraction
   * of a degree another whole second to cover. Measured: the per-frame delta
   * collapsed from 0.033 to 0.003 at t=1100ms and then crawled for another
   * 800ms. That crawl is what read as lag; the marker had arrived and was still
   * visibly finishing.
   *
   * Freezing costs nothing. The target is at most one sweep stale by the time
   * it lands, and the day advances 0.004 degrees a second. */
  const [phase, setPhase] = useState("live");
  const [sweepTo, setSweepTo] = useState(0);
  const liveAngleRef = useRef(0);

  useEffect(() => {
    if (shown === wasShown.current) return undefined;
    wasShown.current = shown;
    // Leaving: change nothing. Rewinding the marker here would snap it back to
    // midnight in full view while the pane is still fading out.
    if (!shown) return undefined;
    runRef.current += 1;
    setRun(runRef.current);
    setPhase("park");
    /* Two frames, and both are needed: the first paints the marker parked at
       midnight, the second moves it. Setting both in one frame gives the
       browser no start value to interpolate from and it jumps. */
    let inner, release;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        setSweepTo(liveAngleRef.current);
        setPhase("sweep");
        release = setTimeout(() => setPhase("live"), SWEEP_MS + 80);
      });
    });
    return () => {
      cancelAnimationFrame(outer);
      if (inner) cancelAnimationFrame(inner);
      if (release) clearTimeout(release);
    };
  }, [shown]);

  /* Where "now" is, as a rotation rather than a point. Drawing the marker at
     the top and rotating the group is not just tidier than trigonometry per
     frame — it is what makes the sweep possible at all, because a rotation is
     one animatable number and a pair of coordinates is not.

     The angle is kept monotonic. Left raw it drops from 359.99 to 0 at
     midnight, and the transition below would take that literally and spin the
     marker backwards through the entire day, once a day. */
  const turns = useRef(0);
  const lastRaw = useRef(null);
  const raw = d.dayFraction * 360;
  if (lastRaw.current !== null && raw < lastRaw.current - 180) turns.current += 1;
  lastRaw.current = raw;
  const nowAngle = raw + turns.current * 360;
  liveAngleRef.current = nowAngle;   // what the sweep freezes when it starts

  const markerAngle = phase === "park" ? 0 : phase === "sweep" ? sweepTo : nowAngle;

  /* The arcs, rebuilt only when a window changes state. Everything they depend
     on is in this one string, so the tick — which changes only the seconds —
     reuses the same elements and React skips the subtree.

     This matters more than it looks. The dial is ~17 stroked circles, and it
     was being reconciled once a second on top of whatever else was running.
     On a cold launch at 6x CPU throttle that landed on the sweep. */
  const arcSig = `${closed}|${nextKey}|${ring.map((w) => w.state).join(",")}` +
                 `|${sub.map((w) => w.state).join(",")}`;
  const arcs = useMemo(() => (
    <>
      {ring.map((w) => (
        <Arc key={w.key} r={R_OUT} start={w.start} end={w.end} width={12}
          i={RING_ORDER.indexOf(w.key)}
          stroke={colourFor(w, nextKey, "rgba(255,255,255,.22)", "rgba(255,255,255,.08)")}
          glow={w.state === "open" || w.key === nextKey}
          live={w.state === "open"} />
      ))}
      {sub.map((w, n) => (
        <Arc key={w.key} r={R_IN} start={w.start} end={w.end} width={7}
          i={ring.length + n}
          stroke={colourFor(w, nextKey, "rgba(255,255,255,.18)", "rgba(255,255,255,.07)")}
          glow={w.state === "open" || w.key === nextKey}
          live={w.state === "open"} />
      ))}
    </>
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [arcSig, run]);

  /* It rides the same .pane machinery the editor and guide use, so switching to
     it crossfades exactly like every other tab instead of cutting. That also
     keeps it off the document flow, so the calculator's scroll position is
     untouched while this is up.

     Same rule as StaticPane: a surface that has never been shown must not play
     the leaving animation, or it fades *in* from opacity 1 on its way out. */
  const opened = useRef(false);
  if (active) opened.current = true;
  const paneState = active ? "pane-on" : opened.current ? "pane-off" : "pane-hidden";

  /* The Today card leans toward the pointer, or toward your thumb. The hook
     writes the angle straight to the node — nothing here re-renders while it
     moves, which matters because a render of this component is a rebuild of the
     whole dial. */
  const { wrapRef: tiltWrap, cardRef: tiltCard } = useTilt();

  const ampm = d.hours < 12 ? "AM" : "PM";
  let hh = d.hours % 12; if (hh === 0) hh = 12;
  const dayName = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.day];

  /* the list: sessions in time order, each followed by any window inside it */
  const listed = [];
  [...ring].sort((a, b) => a.start - b.start).forEach((w) => {
    listed.push({ w, sub: false });
    sub.filter((s) => s.parent === w.name).forEach((s) => listed.push({ w: s, sub: true }));
  });

  return (
    <>
    <div className={`pane ${paneState}`} aria-hidden={!active}>
      {/* INSIDE the pane, as its first child, and that is the whole point.

          This lived outside for several rounds, as a position:fixed canvas at
          the root — its own layer, its own fade, timed to match the pane's.
          Matching is the problem. Two position:fixed layers at the root are two
          things the compositor orders at its own discretion, and iOS promotes
          and reorders fixed layers more eagerly than anything else on the page.
          Every z-index written out there was a REQUEST that the field stay
          behind the card, and the request is what kept being refused for a
          frame on the way in.

          In here it is not a request. The field and .sess-scroll are siblings
          in the pane's own stacking context, ordered 0 before 1, and painting
          order within a stacking context is not the compositor's to reinterpret.
          There is no arrangement of layers that puts it in front.

          The old comment warned that a canvas inside an animating group arrives
          at full strength for a frame before the group opacity reaches it. That
          is still true, and it is now harmless twice over: the canvas fades its
          own PIXELS to the pane's opacity as well, so a mis-timed group only
          ever makes it dimmer than intended — and whatever its brightness, it
          is behind the card. */}
      <Particles active={shown} />
      <div className="sess-scroll">
        <div className="sess-wrap">
          <div className="sess-head">
            <b>{dayName}</b><span>·</span><span>New York</span>
            <i aria-hidden="true" /><span>ET</span>
          </div>

          {/* keyed on the run so every animation inside restarts each opening */}
          <div className="sess-dial-wrap" key={run}>
            <svg className="sess-dial" viewBox="0 0 300 300" role="img"
                 aria-label={closed ? "Market closed for the weekend"
                   : primary ? `${primary.name}, ${dur(primary.remaining)} remaining`
                   : "No session open"}>
              {/* Hour ticks, labels and the bare tracks are the same drawing at
                  every instant of every day, so they are built once at module
                  scope. Stable element identity is what lets React skip the
                  whole subtree on the clock tick instead of reconciling ~30
                  nodes a second. */}
              {DIAL_FURNITURE}

              {/* The arcs redraw only when a window CHANGES STATE — a few times
                  a day — rather than once a second with everything else. The
                  clock tick was re-rendering the entire dial every second, and
                  at 6x CPU throttle that landed squarely on top of the sweep. */}
              {arcs}

              {DIAL_MARKS}
            </svg>

            {/* Now — a stub outside the inner ring, not a hand through the
                middle, which would cut straight across the readout.

                HTML, not SVG, and that is the whole point. An SVG transform is
                not composited: every frame of the sweep repainted the entire
                dial, at the same moment the arcs were repainting it too for
                their draw-on. The two competed for the main thread and the
                marker lost — it stalled partway round the morning and then
                jumped to the current time when the thread came free. Exactly
                one property moves here now, on an element the compositor owns,
                so nothing on the main thread can starve it.

                The dial is a fixed 300px box matching the 300-unit viewBox, so
                these offsets are the viewBox numbers unchanged: the dot centre
                sits at 150 - R_OUT = 46 from the top, the stem spans
                150 - (R_OUT - 10) to 150 - (R_IN - 13). */}
            {!closed && (
              <div
                className={`sess-now sess-now-${phase}`}
                style={{ transform: `rotate(${markerAngle}deg)` }}
                aria-hidden="true"
              >
                <span className="sess-now-stem" />
                {/* the beat: one pulse a second, so the dial has a pulse even
                    when every countdown on screen is hours away */}
                <span className="sess-now-beat" />
                {/* the halo is two box-shadow rings rather than a blur, for the
                    same reason the arcs' is two strokes */}
                <span className="sess-now-dot" />
              </div>
            )}

            <div className="sess-centre">
              {closed ? (
                <>
                  <div className="sess-clock sess-shut">CLOSED</div>
                  <div className="sess-state" style={{ color: "#ff6961" }}>Weekend</div>
                  {/* TWO LINES, BECAUSE ONE OF THEM COULD NOT FIT.
                      "opens Sun 6 PM · 19h 51m" ran 177px wide where the inner
                      ring leaves 145 at that height, so the countdown — the end
                      of the line, and the only part that changes — was printed
                      straight onto the track. It is also the part you are
                      reading the dial for, so it now leads on its own line and
                      the reopen time drops to a caption under it. Splitting it
                      buys width twice over: each line is shorter, and the
                      caption sits nearer the centre where the ring is widest. */}
                  <div className="sess-left sess-left-big">{dur(d.reopenIn)}</div>
                  <div className="sess-when">opens Sun 6 PM</div>
                </>
              ) : (
                <>
                  <div className="sess-clock">
                    {hh}:{String(d.minutes).padStart(2, "0")}<small>{ampm}</small>
                  </div>
                  {primary ? (
                    <>
                      <div className="sess-state" style={{ color: OPEN }}>{primary.name}</div>
                      <div className="sess-left">{dur(primary.remaining)} left</div>
                      {/* The name only. It used to carry its own countdown too, which
                          made the longest line on the screen — it wrapped, and the
                          orphaned "00S" landed on top of the arcs. It was also very
                          nearly redundant: a sub-window ends with its parent more
                          often than not, so the two countdowns read the same. The
                          live one for this window is in the Today list directly
                          below, nested under the session it belongs to. */}
                      {openSub && openSub !== primary && (
                        <div className="sess-sublabel">{openSub.name}</div>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="sess-state sess-none">No window open</div>
                      {/* Deliberately no name here. "London Killzone in 2h 15m" is
                          wider than the ring at every size that stays legible, and
                          the list below already names what is next and marks it
                          blue — the same blue as the arc on the dial. */}
                      <div className="sess-left">
                        {upcoming[0] ? `next in ${dur(upcoming[0].until)}` : "—"}
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </div>

          {/* The wrapper exists only to hold the perspective. Putting it on the
              card itself would make the card its own vanishing point, so the
              tilt would be a flat skew — the depth comes from the projection
              belonging to the thing the card sits IN. */}
          <div className="sess-tilt" ref={tiltWrap}>
            <div className="sess-block glass" ref={tiltCard}>
              <div className="sess-blabel">Today</div>
              {listed.map(({ w, sub: isSub }) => (
                <Row key={w.key} w={w} nextKey={nextKey} closed={closed} sub={isSub} />
              ))}
            </div>
          </div>

          {/* Price, under the windows it is priced against.

              It used to be handed the open killzone so it could reset its own
              high and low at the session boundary. That range was never real —
              a socket only sees prices from the moment it connects, so it was
              the range since you opened the app wearing the session's name. The
              card reads the true 24-hour extremes out of the ticker now and
              needs to know nothing about killzones. */}
          <Feed active={shown} />

          {/* the same signature the calculator carries at the foot of its scroll */}
          <div className="signature">
            <span className="signature-rule" aria-hidden="true" />
            <span className="signature-mark">Built by <em>yasser</em></span>
          </div>
        </div>
      </div>
    </div>
    </>
  );
}
