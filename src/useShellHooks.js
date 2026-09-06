import { useEffect, useRef, useState } from "react";

export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = (e) => setReduced(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

/**
 * Hides the tab bar while scrolling down, brings it back on the way up.
 *
 * Only meaningful while the calculator is the active tab — the other two are
 * iframes, and when their content scrolls the parent document does not move,
 * so there is nothing here to hear. Callers pass active:false for those, and
 * the bar simply stays put.
 */
export function useAutoHideOnScroll({ active, threshold = 8, topZone = 32 }) {
  const [hidden, setHidden] = useState(false);
  const lastY = useRef(0);
  const frame = useRef(0);

  useEffect(() => {
    if (!active) {
      setHidden(false);
      return;
    }

    lastY.current = window.scrollY;
    setHidden(false);

    const update = () => {
      frame.current = 0;
      const y = window.scrollY;

      // Always visible near the top, or the bar flickers as you settle.
      if (y <= topZone) {
        lastY.current = y;
        setHidden(false);
        return;
      }

      // Always visible at the very end of the document. iOS rubber-banding
      // there produces a downward delta that would otherwise hide the bar at
      // exactly the moment you arrive at it.
      const atEnd =
        y + window.innerHeight >= document.documentElement.scrollHeight - 8;
      if (atEnd) {
        lastY.current = y;
        setHidden(false);
        return;
      }

      const dy = y - lastY.current;

      // Load-bearing: lastY is NOT updated until the threshold is crossed.
      // Updating it every frame means a slow scroll never accumulates a delta
      // big enough to fire, and the bar never hides at all — a bug that only
      // shows up on a real device, never under a fast programmatic scroll.
      if (Math.abs(dy) < threshold) return;

      lastY.current = y;
      setHidden(dy > 0);
    };

    const onScroll = () => {
      if (frame.current) return; // rAF throttle
      frame.current = requestAnimationFrame(update);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame.current) cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [active, threshold, topZone]);

  return hidden;
}
