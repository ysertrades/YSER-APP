import { useState, useEffect } from "react";

/* ---------------------------------------------------------------------------
 * The ET clock and the session windows.
 *
 * This used to live inside Calculator.jsx, driving four small blocks above the
 * inputs. Those are gone — the calculator is a calculator — and the Sessions
 * dial is the only reader now.
 * ------------------------------------------------------------------------- */

const ET_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  weekday: "short",
});
const WEEKDAY_MAP = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/* `at` exists so this is testable. Everything downstream is a pure function of
 * the current ET instant, which means the only way to check the Friday-close or
 * Sunday-open edges without it is to run the suite at exactly the right moment
 * on the right day of the week. */
export function getEtNow(at = new Date()) {
  const parts = ET_FORMATTER.formatToParts(at);
  const map = {};
  parts.forEach((p) => (map[p.type] = p.value));
  const hours = parseInt(map.hour, 10) % 24;
  const minutes = parseInt(map.minute, 10);
  const seconds = parseInt(map.second, 10);
  const day = WEEKDAY_MAP[map.weekday];
  return { hours, minutes, seconds, day, totalMinutes: hours * 60 + minutes };
}

export const WEEK_MINUTES = 10080;
export const FRI_START = 4 * 1440 + 17 * 60; // Friday 5:00 PM (Mon-indexed, Fri = day 4)
export const SUN_END = 6 * 1440 + 18 * 60;   // Sunday 6:00 PM (Sun = day 6)

export function toLinear(day, minutes) {
  const mondayIndex = (day + 6) % 7; // Mon=0 ... Sun=6
  return mondayIndex * 1440 + minutes;
}

// Daily session (Asia/London/NY): active at its normal time on any weekday,
// but any occurrence that falls inside the Fri 5pm–Sun 6pm weekend blackout
// is dropped entirely, so it only resumes at its default time from
// Sunday 6pm onward (or on ordinary weekdays).
export function dailyStatusWeekAware(linearNow, startMin, endMin) {
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

export function weekendStatus(linearNow) {
  if (linearNow >= FRI_START && linearNow < SUN_END) {
    return { status: "open", remaining: SUN_END - linearNow };
  }
  let remaining;
  if (linearNow < FRI_START) remaining = FRI_START - linearNow;
  else remaining = FRI_START + WEEK_MINUTES - linearNow;
  return { status: "closed", remaining };
}

/* Seconds appear only once they are the thing you are watching. Above an hour
   they are noise; under a minute they are the whole message. */
export function fmtCountdown(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  if (s >= 86400) return `${Math.round(s / 86400)}d`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, "0")}s`;
  return `${sec}s`;
}

/* ---------------------------------------------------------------------------
 * The windows.
 *
 * RING_SESSIONS is the outer ring. SUB_WINDOWS holds a window that sits INSIDE
 * one of those rather than beside it: the silver bullet is an hour within the
 * NY killzone,
 * so it cannot share the ring without one hiding the other, and it is drawn on
 * its own inner ring and nested under its parent in the list.
 *
 * Changing which windows you trade is an edit to these two arrays and nothing
 * else. `parent` must match a RING_SESSIONS `name` exactly.
 * ------------------------------------------------------------------------- */
export const RING_SESSIONS = [
  { key: "asia",   name: "Asia Range",      start: 1200, end: 1440, at: "8:00 PM" },
  { key: "london", name: "London Killzone", start: 120,  end: 300,  at: "2:00 AM" },
  { key: "ny",     name: "NY Killzone",     start: 570,  end: 660,  at: "9:30 AM" },
  { key: "pm",     name: "PM Session",      start: 810,  end: 960,  at: "1:30 PM" },
];

export const SUB_WINDOWS = [
  { key: "sb", name: "Silver Bullet", start: 600, end: 660, at: "10:00 AM", parent: "NY Killzone" },
];

/* Instants rather than windows — drawn as a tick across both rings. */
export const MARKS = [
  { key: "midnight", name: "Midnight open", minute: 0 },
  { key: "lo",       name: "London open",   minute: 180 },
  { key: "nyo",      name: "NY open",       minute: 570 },
];

/* ---------------------------------------------------------------------------
 * The tick.
 *
 * Re-renders on the second boundary rather than every 1000ms from mount, so the
 * displayed second turns over when the clock does instead of drifting.
 *
 * `enabled` matters. The dial is mounted for the life of the app so its state
 * survives tab switches, which means without this it would re-render — and
 * re-lay-out an SVG — once a second while you are reading the guide or dragging
 * a screenshot around in the editor. Nothing is watching it there, so it stops.
 * ------------------------------------------------------------------------- */
export function useEtTick(enabled = true) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return undefined;
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
  }, [enabled]);
}

/* ---------------------------------------------------------------------------
 * Everything the dial needs, for a given ET instant.
 *
 * Pure: pass a Date and get the whole screen's state back. That is what makes
 * the dial and the list provably agree — they read the same object rather than
 * each working it out.
 * ------------------------------------------------------------------------- */
export function readDay(at = new Date()) {
  const { hours, minutes, seconds, day, totalMinutes } = getEtNow(at);
  const linearNow = toLinear(day, totalMinutes);
  const closed = weekendStatus(linearNow).status === "open"; // "weekend open" = market shut

  /* Everything below is in SECONDS from ET midnight, not minutes. A countdown
     that only knows the minute sits on the same number for sixty seconds and
     then jumps two — it reads as broken rather than as low resolution. The
     window bounds are still authored in minutes because that is how anyone
     thinks about them; they are converted here, once. */
  const nowSec = hours * 3600 + minutes * 60 + seconds;

  const state = (w) => {
    if (closed) return "done";
    if (nowSec >= w.start * 60 && nowSec < w.end * 60) return "open";
    return nowSec < w.start * 60 ? "ahead" : "done";
  };

  const decorate = (w) => ({
    ...w,
    state: state(w),
    remaining: w.end * 60 - nowSec,   // seconds
    until: w.start * 60 - nowSec,     // seconds
  });

  const ring = RING_SESSIONS.map(decorate);
  const sub = SUB_WINDOWS.map(decorate);

  const upcoming = [...ring, ...sub]
    .filter((w) => w.state === "ahead")
    .sort((a, b) => a.start - b.start);

  const openRing = ring.find((w) => w.state === "open") || null;
  const openSub = sub.find((w) => w.state === "open") || null;

  return {
    hours, minutes, seconds, day, totalMinutes, nowSec, linearNow, closed,
    /* where the day has got to, 0..1 — the dot rides this, so it creeps rather
       than stepping once a minute */
    dayFraction: nowSec / 86400,
    ring, sub, upcoming,
    nextKey: upcoming.length ? upcoming[0].key : null,
    openRing, openSub,
    // the headline window: the session if one is running, otherwise the sub
    primary: openRing || openSub,
    /* SUN_END is authored in minutes, like every other window bound, but the
       countdown to it has to live in the same second-resolution world as
       `remaining`/`until` above — otherwise it sits on one number for sixty
       ticks and jumps by a minute, which is what "always :00 seconds" was.
       linearNow is itself minute-only (it comes from totalMinutes), so it is
       rebuilt here as a second count — linearNow*60 lands exactly on that
       minute's start, and + seconds recovers the part that was floored away. */
    reopenIn: closed ? SUN_END * 60 - (linearNow * 60 + seconds) : 0,  // seconds
  };
}
