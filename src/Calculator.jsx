import { useState, useEffect, useLayoutEffect, useMemo, useRef } from "react";


// ---------------------------------------------------------------------------
// Contract specs (hardcoded)
// ---------------------------------------------------------------------------
const SPECS = {
  NQ:  { label: "Nasdaq",       tickSize: 0.25,  tickValue: 5,    microName: "MNQ", microTickValue: 0.5 },
  ES:  { label: "S&P 500",      tickSize: 0.25,  tickValue: 12.5, microName: "MES", microTickValue: 1.25 },
  YM:  { label: "Dow Jones",    tickSize: 1,     tickValue: 5,    microName: "MYM", microTickValue: 0.5 },
  RTY: { label: "Russell 2000", tickSize: 0.10,  tickValue: 5,    microName: "M2K", microTickValue: 0.5 },
  GC:  { label: "Gold",         tickSize: 0.10,  tickValue: 10,   microName: "MGC", microTickValue: 1 },
  SI:  { label: "Silver",       tickSize: 0.005, tickValue: 25,   microName: "SIL", microTickValue: 5 },
};
const PAIR_ORDER = ["NQ", "ES", "YM", "RTY", "GC", "SI"];

const fmtMoney = (n) => {
  if (!isFinite(n) || n === 0) return "$0.00";
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
};

function riskBand(amount) {
  if (!amount || amount <= 0) return null;
  if (amount <= 50) return { label: "Very low risk (0-50)", color: "#4ADE80" };
  if (amount <= 150) return { label: "Low risk (50-150)", color: "#64d2ff" };
  if (amount <= 400) return { label: "Moderate risk (150-400)", color: "#ff9f0a" };
  if (amount <= 800) return { label: "High risk (400-800)", color: "#ff6b4a" };
  return { label: "Very high risk (800+)", color: "#ff453a" };
}

// ---------------------------------------------------------------------------
// Calculation engine — computes standard + micro sizing for every pair,
// then intelligently picks the best fit (closest to target risk, never
// preferring an invalid <1 contract standard size).
// ---------------------------------------------------------------------------
const PAIRS_DATA = PAIR_ORDER.map((symbol) => {
  const s = SPECS[symbol];
  return {
    symbol,
    tickSize: s.tickSize,
    tickValue: s.tickValue,
    microSymbol: s.microName,
    microTickValue: s.microTickValue,
  };
});

/* The stop is entered in TICKS, which is the unit the contract is actually
   priced in — risk per contract is ticks x tickValue, with nothing to convert.

   It used to take points and divide by tickSize to get here, and that made the
   same field mean wildly different things per instrument: a realistic NQ stop
   is 20 points while a realistic SI stop is 0.20, two orders of magnitude apart
   in one input. In ticks a normal stop is double digits on every instrument in
   the list. */
function calculateContracts(riskAmount, stopTicks) {
  if (!riskAmount || !stopTicks) return [];

  return PAIRS_DATA.map((pair) => {
    const ticks = stopTicks;

    // STANDARD CONTRACT
    const standardRiskPerContract = ticks * pair.tickValue;
    const standardContractsRaw = riskAmount / standardRiskPerContract;
    const standardContracts = Math.floor(standardContractsRaw);

    // MICRO CONTRACT
    const microRiskPerContract = ticks * pair.microTickValue;
    const microContractsRaw = riskAmount / microRiskPerContract;
    const microContracts = Math.floor(microContractsRaw);

    // ACTUAL RISK USED
    const standardUsedRisk = standardContracts * standardRiskPerContract;
    const microUsedRisk = microContracts * microRiskPerContract;

    // DIFFERENCE FROM TARGET (accuracy)
    const standardDiff = Math.abs(riskAmount - standardUsedRisk);
    const microDiff = Math.abs(riskAmount - microUsedRisk);

    // BEST CHOICE LOGIC
    let bestType, bestContracts, bestSymbol, bestRisk;

    if (standardContracts >= 1 && standardDiff <= microDiff) {
      bestType = "standard";
      bestContracts = standardContracts;
      bestSymbol = pair.symbol;
      bestRisk = standardUsedRisk;
    } else {
      bestType = "micro";
      bestContracts = microContracts;
      bestSymbol = pair.microSymbol;
      bestRisk = microUsedRisk;
    }

    return {
      pair: pair.symbol,
      ticks,
      standard: {
        contracts: standardContracts,
        riskPerContract: standardRiskPerContract,
        totalRisk: standardUsedRisk,
        valid: standardContracts >= 1,
      },
      micro: {
        contracts: microContracts,
        riskPerContract: microRiskPerContract,
        totalRisk: microUsedRisk,
      },
      best: {
        type: bestType,
        contracts: bestContracts,
        symbol: bestSymbol,
        totalRisk: bestRisk,
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Symbol dropdown
// ---------------------------------------------------------------------------
function SymbolDropdown({ selected, onSelect }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const spec = SPECS[selected];
  /* microTickValue IS the dollars-per-tick of the micro contract, so with the
     stop now in ticks this needs no arithmetic at all — the division existed
     only to turn it into a per-point figure. Same contract as before, same
     number source; only the unit changed. */
  const dollarPerTick = spec.microTickValue;

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div className="relative" ref={ref} style={{ display: "flex", justifyContent: "center" }}>
      <button className="glass symbol-pill" onClick={() => setOpen((o) => !o)}>
        <span className="font-bold text-white">{selected}</span>
        <span className="text-white/35 mx-1.5">•</span>
        <span className="text-white/70">${dollarPerTick.toFixed(2).replace(/\.00$/, "")}/tick</span>
        <svg
          width="11" height="11" viewBox="0 0 24 24" fill="none"
          style={{ marginLeft: 8, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s ease" }}
        >
          <path d="M6 9l6 6 6-6" stroke="rgba(255,255,255,0.5)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="glass dropdown-menu">
          {PAIR_ORDER.map((pair) => {
            const s = SPECS[pair];
            const dpt = s.microTickValue;
            const isSel = pair === selected;
            return (
              <div
                key={pair}
                className={`dropdown-item ${isSel ? "dropdown-item-active" : ""}`}
                onClick={() => { onSelect(pair); setOpen(false); }}
              >
                <div>
                  <div className="text-[13.5px] font-semibold text-white">{pair}</div>
                  <div className="text-[11px] text-white/40">{s.label}</div>
                </div>
                <div className="text-[12px] text-white/55">${dpt.toFixed(2).replace(/\.00$/, "")}/tick</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Contracts block (main + micro side by side)
// ---------------------------------------------------------------------------
function ContractMini({ symbol, subLabel, contracts, risk, accent }) {
  return (
    <div className="contract-mini" style={{ borderColor: `${accent}33` }}>
      <div className="text-[11px] font-semibold tracking-wide text-white/40 mb-1">{symbol}</div>
      <div className="text-[26px] font-extrabold tabular-nums leading-none" style={{ color: accent }}>
        {contracts}
      </div>
      <div className="text-[10.5px] text-white/35 mt-1">{subLabel}</div>
      <div className="text-[12.5px] font-semibold text-white/80 mt-2 tabular-nums">{fmtMoney(risk)}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main App
// ---------------------------------------------------------------------------
/* `phase` is "on" | "leaving" | "off". The shell drives it so the calculator
   fades out on the same clock the panes fade in on, rather than cutting. */
export default function Calculator({ phase = "on" }) {
  const [riskAmount, setRiskAmount] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [selectedPair, setSelectedPair] = useState("NQ");

  const riskNum = parseFloat(riskAmount) || 0;
  const stopNum = parseFloat(stopLoss) || 0;
  const spec = SPECS[selectedPair];
  /* Rounded because tickSize is a float: SI is 0.005, and 1/0.005 lands on
     199.99999999999997 without it. */
  const ticksPerPoint = Math.round(1 / spec.tickSize);

  // Recalculates for every pair only when risk or stop actually change.
  const allResults = useMemo(() => calculateContracts(riskNum, stopNum), [riskNum, stopNum]);
  const result = allResults.find((r) => r.pair === selectedPair);

  const mainContracts = result ? result.standard.contracts : 0;
  const microContracts = result ? result.micro.contracts : 0;
  const mainRiskUsed = result ? result.standard.totalRisk : 0;
  const microRiskUsed = result ? result.micro.totalRisk : 0;
  const totalRisk = result ? result.best.totalRisk : 0;

  const band = riskBand(riskNum);
  const hasInputs = riskNum > 0 && stopNum > 0;

  // Freeze the displayed numbers while hasInputs is true; keep the last valid
  // snapshot during the fade-out instead of snapping to 0 the instant inputs clear.
  const [frozen, setFrozen] = useState({ mainContracts, microContracts, mainRiskUsed, microRiskUsed, totalRisk, band });
  useEffect(() => {
    if (hasInputs) {
      setFrozen({ mainContracts, microContracts, mainRiskUsed, microRiskUsed, totalRisk, band });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasInputs, mainContracts, microContracts, mainRiskUsed, microRiskUsed, totalRisk, band]);

  const [showResults, setShowResults] = useState(hasInputs);
  const [resultsLeaving, setResultsLeaving] = useState(false);

  useEffect(() => {
    if (hasInputs) {
      setResultsLeaving(false);
      setShowResults(true);
    } else if (showResults) {
      setResultsLeaving(true);
      const t = setTimeout(() => {
        setShowResults(false);
        setResultsLeaving(false);
      }, 140);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasInputs]);

  /* Measured, not guessed. The panel's two states differ by well over a
     hundred pixels and neither height is knowable up front — the band pill
     comes and goes, and the text wraps differently at every width. A
     ResizeObserver on the content gives the shell a number to transition to
     and keeps working when the window changes size or the copy changes. */
  const resultsBodyRef = useRef(null);
  const [resultsH, setResultsH] = useState(null);
  useLayoutEffect(() => {
    const el = resultsBodyRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const measure = () => setResultsH(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const reset = () => { setRiskAmount(""); setStopLoss(""); };

  return (
    <>
      {/* This block is rendered after the head stylesheets, so it wins ties
          against anything imported in main.jsx. The html/body and .wrap rules
          below therefore have to live here rather than in shell.css. It sits
          outside .wrap so it is obviously unaffected by .wrap being hidden. */}
      <style>{`
        html, body {
          /* scrollbar-gutter reserves the track so the layout does not shift
             when results appear. overflow-y:scroll used to be here as well,
             which *drew* a full-height scrollbar whether or not there was
             anything to scroll — on a desktop the untouched calculator came to
             916px against a 900px viewport, so the wheel moved it 16px and
             stopped, under a scrollbar promising a page. Reserve the gutter,
             don't fake the bar. */
          scrollbar-gutter: stable;
          background: #121212;          /* unset before: iOS overscroll flashed white */
          overscroll-behavior-y: none;
          color-scheme: dark;
        }
        .wrap {
          min-height: 100vh;
          /* Same #121212 as html/body, so nothing looks different — and no
             longer load-bearing. This used to be what hid the Sessions particle
             field on this tab, back when the field was a root-level canvas
             spanning the whole app and every other surface had to arrange
             itself to cover it. The field lives inside the Sessions pane now,
             so it is simply not on this tab to hide. */
          background: #121212;
          /* 24px, not 50: --tabbar-reserve already carries a 14px gap above the
             pill, and the extra was pure overhang — enough to push an otherwise
             screen-sized page just past the fold. */
          padding: calc(36px + env(safe-area-inset-top, 0px))
                   max(18px, env(safe-area-inset-right, 0px))
                   calc(24px + var(--tabbar-reserve, 0px))
                   max(18px, env(safe-area-inset-left, 0px));
          font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", system-ui, sans-serif;
          display: flex;
          flex-direction: column;
          align-items: center;
          -webkit-text-size-adjust: 100%;
          text-size-adjust: 100%;
        }
        @media (prefers-reduced-motion: reduce) {
          .dropdown-menu { animation: none; }
          .results-fade-in, .results-fade-out { animation-duration: 0.01ms; }
          .results-shell { transition: none; }
          .input-field:focus { transform: none; }
          .symbol-pill:hover, .contract-mini:hover { transform: none; }
        }
        .wrap * { -webkit-tap-highlight-color: transparent; -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
        /* A 3px rise on the way in and none on the way out. Results arriving is
           the moment worth marking — it is the answer you asked for — and the
           same movement in reverse on the way out would draw the eye to an
           empty card instead. Quick either way: the numbers update as you type,
           so anything languid here would lag your own keystrokes. */
        .results-fade-in { animation: resultsFadeIn 0.19s cubic-bezier(.22,.8,.3,1) forwards; }
        .results-fade-out { animation: resultsFadeOut 0.13s ease forwards; }
        @keyframes resultsFadeIn {
          from { opacity: 0; transform: translateY(3px); }
          to   { opacity: 1; transform: none; }
        }
        @keyframes resultsFadeOut { from { opacity: 1; } to { opacity: 0; } }
        .glass {
          background: rgba(0,0,0,0.2);
          backdrop-filter: blur(7px);
          -webkit-backdrop-filter: blur(7px);
          border: 0.4px solid rgba(176,176,176,0.1);
          border-radius: 20px;
        }
        /* the eyebrow, matched to the Sessions header so the tabs open alike */
        .calc-head {
          width: 100%;
          max-width: 560px;
          display: flex; align-items: center; gap: 12px;
          margin-bottom: 20px;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 10.5px; font-weight: 700;
          letter-spacing: 0.2em; text-transform: uppercase;
          color: rgba(255,255,255,0.34);
        }
        .calc-head b { color: rgba(255,255,255,0.82); font-weight: 700; }
        .calc-head i { flex: 1; height: 1px; background: rgba(255,255,255,0.09); }

        .main-panel {
          width: 100%;
          max-width: 560px;
          padding: 22px 20px 20px;
          margin-bottom: 16px;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.07);
          position: relative;
          z-index: 20;
        }

        .symbol-pill {
          display: inline-flex;
          align-items: center;
          padding: 9px 18px;
          border-radius: 999px;
          font-size: 14px;
          margin-bottom: 22px;
          cursor: pointer;
          transition: transform 0.15s ease, border-color 0.15s ease;
        }
        .symbol-pill:hover { transform: scale(1.02); border-color: rgba(176,176,176,0.22); }

        .dropdown-menu {
          position: absolute;
          top: 46px;
          width: 240px;
          padding: 8px;
          z-index: 50;
          background: rgba(0,0,0,0.85);
          backdrop-filter: blur(7px);
          -webkit-backdrop-filter: blur(7px);
          box-shadow: 0 20px 50px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.09);
          animation: dropIn 0.16s ease;
        }
        @keyframes dropIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
        .dropdown-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 9px 10px;
          border-radius: 12px;
          cursor: pointer;
          transition: background 0.12s ease;
        }
        .dropdown-item:hover { background: rgba(255,255,255,0.07); }
        .dropdown-item-active { background: rgba(10,132,255,0.14); }

        .field-label {
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.07em;
          color: rgba(255,255,255,0.4);
          margin-bottom: 7px;
          display: block;
        }
        .field-wrap { margin-bottom: 16px; }
        .input-field {
          width: 100%;
          background: rgba(0,0,0,0.2);
          border: 0.4px solid rgba(176,176,176,0.1);
          border-radius: 14px;
          padding: 13px 14px;
          font-size: 17px;
          font-weight: 600;
          color: #f5f5f7;
          outline: none;
          box-sizing: border-box;
          transition: transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
        }
        .input-field::placeholder { color: rgba(255,255,255,0.25); }
        .input-field:focus {
          transform: scale(1.012);
          border-color: rgba(10,132,255,0.55);
          box-shadow: 0 0 0 4px rgba(10,132,255,0.14);
        }

        .contracts-panel {
          width: 100%;
          max-width: 560px;
          padding: 20px;
          /* The same 16px .main-panel puts between the inputs and this card.
             Without it the spec card below sat flush against this one — the
             only seam in the column where two panels touched. */
          margin-bottom: 16px;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.07);
          position: relative;
          z-index: 1;
        }

        /* The panel changes height when results replace the placeholder, and
           that was the "jump": the fade was already there and already quick,
           but the card snapped from two lines to a full result in one frame and
           shoved everything below it down. Height is measured and transitioned,
           so the card grows into the result while the result fades in — one
           movement instead of a fade over a jump. */
        .results-shell {
          overflow: hidden;
          transition: height 0.26s cubic-bezier(.22, .7, .3, 1);
        }

        /* Deliberately no accent. #0a84ff means "active" in this app — it is
           the tab bar and the numerals — so a signature in it would read as
           something you can tap. Grey is legible, ignorable, and does not
           claim to be interactive. Mono, because everything structural here
           already is; tracked out, because at 11px this is a label. */
        /* 14vh, not a fixed gap. At 34px the signature came to rest just
           under the floating pill on a tall phone and bled out from behind
           it — legible enough to look like a glitch, not enough to read.
           Tying the gap to viewport height puts it below the fold at every
           size I can test, so it is something you scroll to rather than
           something crowding the tab bar. Generous separation is right for
           a footer anyway. */
        .signature {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 13px;
          width: 100%;
          margin-top: max(56px, 14vh);
        }
        .signature-rule {
          width: 132px;
          height: 1px;
          background: linear-gradient(90deg,
            transparent, rgba(255,255,255,0.14), transparent);
        }
        /* Two voices on one line, aligned on the baseline rather than the
           box: the label in the system's, the name in a human one. That
           contrast is the whole point — a name set in the same mono as the
           numerals reads as another data field, not as someone signing. */
        .signature-mark {
          display: flex;
          align-items: baseline;
          gap: 9px;
          font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: rgba(255,255,255,0.34);
        }
        .signature-mark em {
          font-family: "Instrument Serif", Georgia, "Times New Roman", serif;
          font-style: italic;
          font-weight: 400;
          font-size: 21px;
          letter-spacing: 0;      /* the label's tracking must not follow it */
          text-transform: none;   /* nor its caps — the name is lowercase */
          color: rgba(255,255,255,0.62);
        }
        .panel-label {
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.07em;
          color: rgba(255,255,255,0.38);
          margin-bottom: 12px;
        }
        .contracts-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px; }
        .contract-mini {
          background: rgba(0,0,0,0.2);
          border: 0.4px solid rgba(176,176,176,0.1);
          border-radius: 16px;
          padding: 14px 14px 12px;
          transition: transform 0.15s ease;
        }
        .contract-mini:hover { transform: translateY(-2px); }

        .divider { height: 1px; background: rgba(255,255,255,0.08); margin: 4px 0 14px; }
        .row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
        .row-label { font-size: 12px; color: rgba(255,255,255,0.4); font-weight: 500; }

        .band-pill {
          display: flex;
          align-items: center;
          gap: 9px;
          padding: 10px 14px;
          border-radius: 13px;
          background: rgba(0,0,0,0.2);
          border: 0.4px solid rgba(176,176,176,0.1);
          font-size: 12.5px;
          color: rgba(255,255,255,0.75);
          margin-top: 4px;
          margin-bottom: 16px;
        }
        .band-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }

        .reset-btn {
          display: block;
          margin-left: auto;
          padding: 9px 18px;
          border-radius: 12px;
          background: rgba(0,0,0,0.2);
          border: 0.4px solid rgba(176,176,176,0.1);
          color: rgba(255,255,255,0.65);
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.15s ease, transform 0.1s ease;
        }
        .reset-btn:hover { background: rgba(255,255,255,0.09); }
        .reset-btn:active { transform: scale(0.97); }

        .spec-card { padding: 16px 20px 18px; }
        .spec-grid {
          display: grid; grid-template-columns: 1fr 1fr;
          gap: 1px;                                   /* the hairlines ARE the gap */
          background: rgba(176,176,176,0.1);
          border-radius: 12px; overflow: hidden;
          margin-top: 12px;
        }
        .spec-cell {
          background: #141414;                        /* over the grid's hairline */
          padding: 11px 13px;
          display: flex; flex-direction: column; gap: 3px;
        }
        .spec-k {
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 9.5px; font-weight: 700;
          letter-spacing: 0.14em; text-transform: uppercase;
          color: rgba(255,255,255,0.32);
        }
        .spec-v {
          font-size: 15px; font-weight: 700; color: #f5f5f7;
          font-variant-numeric: tabular-nums;
          display: flex; align-items: baseline; gap: 7px;
        }
        .spec-v i {
          font-style: normal; font-size: 11.5px; font-weight: 600;
          color: rgba(255,255,255,0.34);
        }

        .empty-note { text-align: center; font-size: 12px; color: rgba(255,255,255,0.3); padding: 4px 0 12px; }
      `}</style>

      <div
        className={`wrap${phase === "on" ? " wrap-in" : phase === "leaving" ? " wrap-out" : ""}`}
        style={phase === "off" ? { display: "none" } : undefined}
      >
      {/* The four session blocks used to sit here. They are the Sessions tab
          now, and this is a calculator. The eyebrow replaces them: it names the
          surface the way the dial's header does, so the two tabs open the same
          way instead of one starting with furniture and the other with a title. */}
      <div className="calc-head">
        <b>Position</b><span>·</span><span>sizing</span>
        <i aria-hidden="true" /><span>Futures</span>
      </div>

      <div className="glass main-panel">
        <SymbolDropdown selected={selectedPair} onSelect={setSelectedPair} />

        <div className="field-wrap">
          <label className="field-label">Risk ($)</label>
          <input
            className="input-field"
            type="number"
            inputMode="decimal"
            placeholder="e.g. 100"
            value={riskAmount}
            onChange={(e) => setRiskAmount(e.target.value)}
          />
        </div>

        <div className="field-wrap" style={{ marginBottom: 0 }}>
          <label className="field-label">Stop (ticks)</label>
          <input
            className="input-field"
            type="number"
            inputMode="decimal"
            /* 80 ticks is a realistic stop on every instrument here — 20 points
               of NQ, 8.0 of GC, 0.40 of SI. One placeholder can be honest for
               all six only because the unit is ticks. */
            placeholder="e.g. 80"
            value={stopLoss}
            onChange={(e) => setStopLoss(e.target.value)}
          />
        </div>
      </div>

      <div className="glass contracts-panel">
        <div className="panel-label">Contracts</div>

        {/* The shell carries the height; the body inside it is what gets
            measured. Height stays auto until the first measurement lands, so
            nothing is clipped if ResizeObserver is unavailable. */}
        <div
          className="results-shell"
          style={resultsH == null ? undefined : { height: resultsH }}
        >
        <div ref={resultsBodyRef}>
        {showResults ? (
          <div className={resultsLeaving ? "results-fade-out" : "results-fade-in"}>
            <div className="contracts-grid">
              <ContractMini
                symbol={selectedPair}
                subLabel="standard"
                contracts={frozen.mainContracts}
                risk={frozen.mainRiskUsed}
                accent="#0a84ff"
              />
              <ContractMini
                symbol={spec.microName}
                subLabel="micro"
                contracts={frozen.microContracts}
                risk={frozen.microRiskUsed}
                accent="#4ADE80"
              />
            </div>

            <div className="divider" />

            <div className="row">
              <span className="row-label">Total risk</span>
              <span className="text-[16px] font-bold tabular-nums" style={{ color: frozen.totalRisk > 0 ? "#f5f5f7" : "#ff6961" }}>
                {fmtMoney(frozen.totalRisk)}
              </span>
            </div>

            {frozen.band && (
              <div className="band-pill">
                <span className="band-dot" style={{ background: frozen.band.color }} />
                {frozen.band.label}
              </div>
            )}
          </div>
        ) : (
          <div className="empty-note results-fade-in">Enter a risk amount and stop loss to see contract sizing.</div>
        )}
        </div>
        </div>

        <button className="reset-btn" onClick={reset}>Reset Inputs</button>
      </div>

      {/* The stop is entered in TICKS, but every chart quotes points — so the
          one conversion this calculator silently asks you to do in your head is
          the one it now does for you, per instrument, as you switch symbol.
          Reference rather than decoration: it is why the space below the
          results is not empty. */}
      <div className="glass main-panel spec-card">
        <div className="panel-label">{selectedPair} · {spec.label}</div>
        <div className="spec-grid">
          <div className="spec-cell">
            <span className="spec-k">Tick size</span>
            <span className="spec-v">{spec.tickSize} pts</span>
          </div>
          <div className="spec-cell">
            <span className="spec-k">Tick value</span>
            <span className="spec-v">{fmtMoney(spec.tickValue)}</span>
          </div>
          <div className="spec-cell">
            <span className="spec-k">1 point</span>
            <span className="spec-v">
              {ticksPerPoint} ticks
              <i>{fmtMoney(spec.tickValue * ticksPerPoint)}</i>
            </span>
          </div>
          <div className="spec-cell">
            <span className="spec-k">{spec.microName}</span>
            <span className="spec-v">
              {fmtMoney(spec.microTickValue)}<i>per tick</i>
            </span>
          </div>
        </div>
      </div>

      {/* Authorship, at the end of the scroll. Not in the header: the launch
          intro already says YSER FLOW, and a credit above the live sessions
          would sit on top of the thing people opened the app for. */}
      <div className="signature">
        <span className="signature-rule" aria-hidden="true" />
        <span className="signature-mark">Built by <em>yasser</em></span>
      </div>
      </div>
    </>
  );
}
