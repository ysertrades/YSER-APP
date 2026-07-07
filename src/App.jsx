import { useState, useEffect, useMemo, useRef } from "react";

// ---------------------------------------------------------------------------
// Contract specs (hardcoded)
// ---------------------------------------------------------------------------
const SPECS = {
  NQ:  { label: "Nasdaq",       tickSize: 0.25,  tickValue: 5,    microName: "MNQ", microTickValue: 0.5 },
  ES:  { label: "S&P 500",      tickSize: 0.25,  tickValue: 12.5, microName: "MES", microTickValue: 1.25 },
  YM:  { label: "Dow Jones",    tickSize: 1,     tickValue: 5,    microName: "MYM", microTickValue: 0.5 },
  RTY: { label: "Russell 2000", tickSize: 0.10,  tickValue: 5,    microName: "M2K", microTickValue: 0.5 },
  GC:  { label: "Gold",         tickSize: 0.10,  tickValue: 10,   microName: "MGC", microTickValue: 1 },
  SI:  { label: "Silver",       tickSize: 0.005, tickValue: 25,   microName: "SIL", microTickValue: 2.5 },
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

function calculateContracts(riskAmount, stopPoints) {
  if (!riskAmount || !stopPoints) return [];

  return PAIRS_DATA.map((pair) => {
    const ticks = stopPoints / pair.tickSize;

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
// Live Eastern Time (Intl-based, no Date-string parsing drift)
// ---------------------------------------------------------------------------
const ET_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  weekday: "short",
});
const WEEKDAY_MAP = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function getEtNow() {
  const parts = ET_FORMATTER.formatToParts(new Date());
  const map = {};
  parts.forEach((p) => (map[p.type] = p.value));
  const hours = parseInt(map.hour, 10) % 24;
  const minutes = parseInt(map.minute, 10);
  const seconds = parseInt(map.second, 10);
  const day = WEEKDAY_MAP[map.weekday];
  return { hours, minutes, seconds, day, totalMinutes: hours * 60 + minutes };
}

const WEEK_MINUTES = 10080;
const FRI_START = 4 * 1440 + 17 * 60; // Friday 5:00 PM (Mon-indexed, Fri = day 4)
const SUN_END = 6 * 1440 + 18 * 60;   // Sunday 6:00 PM (Sun = day 6)

function toLinear(day, minutes) {
  const mondayIndex = (day + 6) % 7; // Mon=0 ... Sun=6
  return mondayIndex * 1440 + minutes;
}

// Daily session (Asia/London/NY): active at its normal time on any weekday,
// but any occurrence that falls inside the Fri 5pm–Sun 6pm weekend blackout
// is dropped entirely, so it only resumes at its default time from
// Sunday 6pm onward (or on ordinary weekdays).
function dailyStatusWeekAware(linearNow, startMin, endMin) {
  const occurrences = [];
  for (let d = 0; d < 7; d++) {
    const s = d * 1440 + startMin;
    const e = d * 1440 + endMin;
    const overlapsBlackout = s < SUN_END && e > FRI_START;
    if (!overlapsBlackout) occurrences.push({ start: s, end: e });
  }
  // Mirror across the previous/next week so "current" and "next" are always found.
  const extended = [
    ...occurrences.map((o) => ({ start: o.start - WEEK_MINUTES, end: o.end - WEEK_MINUTES })),
    ...occurrences,
    ...occurrences.map((o) => ({ start: o.start + WEEK_MINUTES, end: o.end + WEEK_MINUTES })),
  ];

  const current = extended.find((o) => linearNow >= o.start && linearNow < o.end);
  if (current) return { status: "open", remaining: current.end - linearNow };

  const next = extended.filter((o) => o.start > linearNow).sort((a, b) => a.start - b.start)[0];
  return { status: "closed", remaining: next ? next.start - linearNow : 0 };
}

function weekendStatus(linearNow) {
  if (linearNow >= FRI_START && linearNow < SUN_END) {
    return { status: "open", remaining: SUN_END - linearNow };
  }
  let remaining;
  if (linearNow < FRI_START) remaining = FRI_START - linearNow;
  else remaining = FRI_START + WEEK_MINUTES - linearNow;
  return { status: "closed", remaining };
}

function fmtRemaining(mins) {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtClock(hours, minutes) {
  return `ET ${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

const DAILY_SESSIONS = [
  { key: "asia", name: "Asia Range", start: 1200, end: 1440, range: "8 PM–12 AM" },
  { key: "london", name: "London Killzone", start: 120, end: 300, range: "2 AM–5 AM" },
  { key: "ny", name: "NY Killzone", start: 570, end: 660, range: "9:30 AM–11 AM" },
];

function useClockAndSessions() {
  const [, setTick] = useState(0);
  useEffect(() => {
    let timeoutId;
    const scheduleNextTick = () => {
      const msIntoSecond = Date.now() % 1000;
      const delay = 1000 - msIntoSecond;
      timeoutId = setTimeout(() => {
        setTick((t) => t + 1);
        scheduleNextTick();
      }, delay);
    };
    scheduleNextTick();
    return () => clearTimeout(timeoutId);
  }, []);

  const { hours, minutes, day, totalMinutes } = getEtNow();
  const linearNow = toLinear(day, totalMinutes);

  return useMemo(() => {
    const sessions = [
      ...DAILY_SESSIONS.map((s) => ({ ...s, ...dailyStatusWeekAware(linearNow, s.start, s.end) })),
      { key: "weekend", name: "Weekend", range: "Fri 5 PM–Sun 6 PM", ...weekendStatus(linearNow) },
    ];
    return { clockLabel: fmtClock(hours, minutes), sessions };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hours, minutes, linearNow]);
}

// ---------------------------------------------------------------------------
// Session block
// ---------------------------------------------------------------------------
function SessionBlock({ session, index }) {
  const isOpen = session.status === "open";
  return (
    <div
      className="glass session-block"
      style={{
        animationDelay: `${index * 70}ms`,
        borderColor: isOpen ? "rgba(74,222,128,0.55)" : "rgba(255,255,255,0.08)",
        boxShadow: isOpen
          ? "0 0 24px rgba(74,222,128,0.24), inset 0 1px 0 rgba(255,255,255,0.08)"
          : "inset 0 1px 0 rgba(255,255,255,0.06)",
      }}
    >
      <span className={`pill session-pill ${isOpen ? "pill-open" : "pill-closed"}`}>
        {isOpen ? "OPEN" : "CLOSED"}
      </span>
      <div>
        <div className="session-name-row mb-2">
          <span className="text-[13px] font-semibold text-white/90">{session.name}</span>
        </div>
        <div className="text-[12px] mb-1.5" style={{ color: "rgba(255,255,255,0.4)" }}>
          {session.range}
        </div>
      </div>
      <div className="text-[12.5px] font-medium" style={{ color: "rgba(255,255,255,0.75)", whiteSpace: "nowrap" }}>
        {isOpen ? "Closes in " : "Opens in "}
        {fmtRemaining(session.remaining)}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Symbol dropdown
// ---------------------------------------------------------------------------
function SymbolDropdown({ selected, onSelect }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const spec = SPECS[selected];
  const dollarPerPoint = spec.microTickValue / spec.tickSize;

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
        <span className="text-white/70">${dollarPerPoint.toFixed(2).replace(/\.00$/, "")}/pt</span>
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
            const dpp = s.microTickValue / s.tickSize;
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
                <div className="text-[12px] text-white/55">${dpp.toFixed(2).replace(/\.00$/, "")}/pt</div>
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
export default function App() {
  const [riskAmount, setRiskAmount] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [selectedPair, setSelectedPair] = useState("NQ");
  const { clockLabel, sessions } = useClockAndSessions();

  const riskNum = parseFloat(riskAmount) || 0;
  const stopNum = parseFloat(stopLoss) || 0;
  const spec = SPECS[selectedPair];

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

  const reset = () => { setRiskAmount(""); setStopLoss(""); };

  return (
    <div className="wrap">
      <style>{`
        html, body {
          overflow-y: scroll;
          scrollbar-gutter: stable;
        }
        .wrap {
          min-height: 100vh;
          background: #121212;
          padding: 36px 18px 50px;
          font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", system-ui, sans-serif;
          display: flex;
          flex-direction: column;
          align-items: center;
          -webkit-text-size-adjust: 100%;
          text-size-adjust: 100%;
        }
        .wrap * { -webkit-tap-highlight-color: transparent; -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
        .results-fade-in { animation: resultsFadeIn 0.15s ease forwards; }
        .results-fade-out { animation: resultsFadeOut 0.15s ease forwards; }
        @keyframes resultsFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes resultsFadeOut { from { opacity: 1; } to { opacity: 0; } }
        .glass {
          background: rgba(0,0,0,0.2);
          backdrop-filter: blur(7px);
          -webkit-backdrop-filter: blur(7px);
          border: 0.4px solid rgba(176,176,176,0.1);
          border-radius: 20px;
        }
        .clock-pill {
          padding: 9px 22px;
          margin-bottom: 20px;
          font-size: 13px;
          font-weight: 600;
          letter-spacing: 0.04em;
          color: rgba(255,255,255,0.8);
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.08);
        }

        .session-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 14px;
          width: 100%;
          max-width: 560px;
          margin-bottom: 22px;
          position: relative;
          z-index: 1;
        }
        .session-block {
          padding: 15px 16px;
          opacity: 0;
          transform: translateY(10px);
          animation: fadeUp 0.45s ease forwards;
          transition: box-shadow 0.6s ease, border-color 0.6s ease;
          outline: none;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          position: relative;
        }
        .session-block:hover, .session-block:focus, .session-block:active { outline: none; }
        @keyframes fadeUp { to { opacity: 1; transform: translateY(0); } }
        .session-pill { position: absolute; top: 15px; right: 16px; }
        .session-name-row { padding-right: 80px; }

        .pill { font-size: 10px; font-weight: 800; letter-spacing: 0.04em; padding: 3px 9px; border-radius: 999px; }
        .pill-open { background: rgba(74,222,128,0.18); color: #4ADE80; }
        .pill-closed { background: rgba(255,69,58,0.14); color: #ff6961; }

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
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.07);
          position: relative;
          z-index: 1;
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

        .empty-note { text-align: center; font-size: 12px; color: rgba(255,255,255,0.3); padding: 4px 0 12px; }
      `}</style>

      <div className="glass clock-pill">{clockLabel}</div>

      <div className="session-grid">
        {sessions.map((s, i) => (
          <SessionBlock key={s.key} session={s} index={i} />
        ))}
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
          <label className="field-label">Stop (pts)</label>
          <input
            className="input-field"
            type="number"
            inputMode="decimal"
            placeholder="e.g. 20"
            value={stopLoss}
            onChange={(e) => setStopLoss(e.target.value)}
          />
        </div>
      </div>

      <div className="glass contracts-panel">
        <div className="panel-label">Contracts</div>

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

        <button className="reset-btn" onClick={reset}>Reset Inputs</button>
      </div>
    </div>
  );
}
