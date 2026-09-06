import { useEffect, useRef, useState } from "react";
import { PAIRS, STALE_MS, createFeed, rangePos } from "./feed";

/* ---------------------------------------------------------------------------
 * The price card, under the Today table.
 *
 * It shows a range, not a ticker. A last price with a green arrow is the strip
 * every trading app has and it would ignore the screen it is sitting on; the
 * high and low built since the current killzone OPENED is the thing the rest of
 * this tab is about. Outside a window it falls back to the day's range, so the
 * card never empties and never has to explain itself.
 *
 * TWO RATES, ON PURPOSE. Quotes arrive as fast as the exchange trades — BTC can
 * be tens of messages a second — and every one of them updates the range, which
 * is cheap and must not be missed. Only the DRAWING is throttled, to 4Hz. The
 * high never comes from a sampled tick, and the screen never renders faster
 * than an eye can read a five-digit number.
 * ------------------------------------------------------------------------- */

const DRAW_MS = 250;

const money = (v, dp) => v == null ? "—"
  : v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });

export default function Feed({ active, sources }) {
  const [pair, setPair] = useState("btc");
  /* One state object, replaced wholesale on a timer. Individually setState-ing
     price, range and status would be three renders where one will do. */
  const [view, setView] = useState({ state: "connecting", source: null, at: 0, q: {} });

  const box = useRef({ state: "connecting", source: null, at: 0, q: {} });

  useEffect(() => {
    if (!active) return undefined;

    let feed = null;
    let draw = 0;

    const open = () => {
      if (feed || document.hidden) return;
      feed = createFeed({
        sources,
        onStatus: ({ state, source }) => { box.current.state = state; box.current.source = source; },
        onQuote: ({ key, price, changePct, lo, hi }) => {
          const b = box.current;
          b.at = Date.now();
          /* The high and low arrive WITH the price rather than being built up
             from it — see the note on the range in feed.js. */
          b.q[key] = { price, changePct, lo, hi };
        },
      });
    };
    const shut = () => { if (feed) { feed.close(); feed = null; } };

    open();
    /* The same redraw that shows a new price is what notices there has not been
       one. Staleness is time since the last tick, checked on the draw timer, so
       it costs nothing extra and can never disagree with what is on screen. */
    draw = setInterval(() => setView({ ...box.current, q: { ...box.current.q } }), DRAW_MS);

    /* A socket held open behind another tab is a battery bug. Same three events
       the particle field listens to, and for the same reason: browsers do not
       agree on which one fires when you come back. */
    const onVis = () => { if (document.hidden) shut(); else open(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pageshow", open);
    window.addEventListener("focus", open);
    return () => {
      clearInterval(draw);
      shut();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pageshow", open);
      window.removeEventListener("focus", open);
    };
  }, [active, sources]);

  const meta = PAIRS.find((p) => p.key === pair) || PAIRS[0];
  const q = view.q[pair] || null;
  /* A source that answered but sent no extremes is possible in principle, so
     the bar is only drawn against a range that is really there. */
  const hasRange = !!(q && q.lo != null && q.hi != null && q.hi > q.lo);
  const stale = view.at > 0 && Date.now() - view.at > STALE_MS;
  const live = view.state === "live" && !stale && q;
  const pos = hasRange ? rangePos(q.lo, q.hi, q.price) : 0.5;
  const up = q && q.changePct != null && q.changePct >= 0;

  /* Where price sits in the day, as a percentage, for the people who read the
     bar rather than the numbers at its ends. Only shown once there is a real
     range to be a percentage of. */
  const depth = hasRange ? Math.round(pos * 100) : null;

  return (
    <div className="sess-feed glass">
      <div className="sess-feed-top">
        <span className={`sess-feed-dot${live ? " on" : ""}${stale ? " stale" : ""}`} aria-hidden="true" />
        <span className="sess-feed-state">
          {stale ? "Stale" : view.state === "live" ? (view.source || "Live")
            : view.state === "down" ? "Reconnecting" : "Connecting"}
        </span>
        <i aria-hidden="true" />
        <div className="sess-feed-chips" role="group" aria-label="Instrument">
          {PAIRS.map((p) => (
            <button
              key={p.key}
              type="button"
              className={`sess-feed-chip${p.key === pair ? " on" : ""}`}
              aria-pressed={p.key === pair}
              onClick={() => setPair(p.key)}
            >{p.label}</button>
          ))}
        </div>
      </div>

      <div className="sess-feed-price">
        <b className={stale ? "dim" : undefined}>{q ? money(q.price, meta.dp) : "—"}</b>
        <span className={`sess-feed-chg${q && q.changePct != null ? (up ? " up" : " down") : ""}`}>
          {q && q.changePct != null
            ? `${up ? "+" : "−"}${Math.abs(q.changePct).toFixed(2)}%`
            : "—"}
        </span>
      </div>

      {/* The bar is always in the DOM at a real height. Showing it only once
          there is data would change the card's height on the first tick, and
          the Today card directly above would jump. */}
      <div className="sess-feed-bar" aria-hidden="true">
        <i />
        <span className="sess-feed-mark" style={{ left: `${(pos * 100).toFixed(2)}%` }} />
      </div>
      <div className="sess-feed-foot">
        <span>{hasRange ? money(q.lo, meta.dp) : "—"}</span>
        <em>
          {hasRange
            ? `24h range · ${depth}% of the day`
            : q ? "24h range · waiting" : "waiting for a price"}
        </em>
        <span>{hasRange ? money(q.hi, meta.dp) : "—"}</span>
      </div>
    </div>
  );
}
