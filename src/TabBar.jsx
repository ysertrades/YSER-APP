/*
 * Icons match the one SVG the app already had (the dropdown chevron): 24x24
 * viewBox, stroked and never filled, round caps and joins.
 *
 * Stroke width is 2, not the chevron's 2.4. The chevron renders at 11px, so
 * its effective weight is 2.4 x 11/24 ~= 1.1px. These render at 22px, where
 * 2.4 would be over twice that optical weight and look chunky next to
 * everything else. 2 at 22px is ~1.83px, which matches.
 */

const CalcIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="4" y="2.5" width="16" height="19" rx="3.5" />
    <path d="M8 7h8" />
    {/* keypad dots as zero-length round-capped strokes, so nothing is filled */}
    <g strokeWidth="2.6">
      <path d="M8.5 12h.01M12 12h.01M15.5 12h.01" />
      <path d="M8.5 16h.01M12 16h.01M15.5 16h.01" />
    </g>
  </svg>
);

const CardIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2.5" y="4.5" width="19" height="15" rx="3.5" />
    <path d="M6.5 15.5l3.6-4.2 2.7 2.2 4.7-5" />
    <path d="M14.4 8.5h3.1v3.1" />
  </svg>
);

/* The same open-book glyph the editor's own Guide button uses, so the two
   read as the same thing. */
const GuideIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
    <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
  </svg>
);

/* A clock face reading a killzone hour rather than 12:00 — the tab is about
   where you are in the trading day, and a hand on the hour would have read as
   a generic "time" glyph. Same 24x24 stroked construction as the rest. */
const SessionsIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5V12l3 2" />
  </svg>
);

/* Sessions leads. It is the only tab that is useful before you have decided
   anything — it answers "what is happening right now", which is the question
   you arrive with. Sizing, the card and the guide all follow from that. */
const TABS = [
  { id: "sessions", label: "Sessions",          Icon: SessionsIcon },
  { id: "flow",     label: "Risk calculator",   Icon: CalcIcon },
  { id: "card",     label: "Trade card editor", Icon: CardIcon },
  { id: "guide",    label: "Guide",             Icon: GuideIcon },
];

export default function TabBar({ tab, onChange, hidden }) {
  return (
    /* The hide class goes on the dock, not the bar. The bar carries the
       backdrop-filter, and a filtered element that animates its own transform
       flashes a bright rim along its edge in WebKit. Keep them separate. */
    <div className={`tabbar-dock${hidden ? " tabbar-dock-hidden" : ""}`}>
      <nav
        className="tabbar"
        role="tablist"
        aria-label="Sections"
        aria-hidden={hidden}
      >
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            aria-label={label}
            title={label}
            className={`tabbar-btn${tab === id ? " tabbar-btn-active" : ""}`}
            onClick={() => onChange(id)}
          >
            <Icon />
          </button>
        ))}
      </nav>
    </div>
  );
}
