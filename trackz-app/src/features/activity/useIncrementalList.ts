import { useEffect, useState } from "preact/hooks";

const PAGE_SIZE = 80;

/**
 * Incremental-render pagination for the Activity list (Phase 11). Not
 * true virtualization (see docs/renovation_version_1.txt's Phase 11
 * write-up) — rendered rows accumulate rather than being windowed, so
 * scrolling all the way to the bottom of ~1,500 real rows does mount all
 * of them. Chosen over hand-rolled absolute-position virtualization
 * because sticky month/day headers and variable row heights make that
 * machinery disproportionate to a bounded, mostly-filtered dataset — if
 * a real device shows jank, true windowing is a Phase 17 candidate.
 *
 * `resetKey` should change whenever the caller's filter changes, so a
 * new search starts back at PAGE_SIZE instead of staying scrolled 600
 * rows deep into stale results.
 *
 * `sentinelRef` is a callback ref (not a useRef) so its *identity*
 * changing on each new sentinel element is visible to the effect below —
 * the sentinel div moves to the end of the growing list every time
 * visibleCount changes, so a plain useRef would silently keep observing
 * a detached node.
 */
export function useIncrementalList(resetKey: string): {
  visibleCount: number;
  sentinelRef: (el: HTMLDivElement | null) => void;
} {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [sentinelEl, setSentinelEl] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [resetKey]);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") {
      // No IntersectionObserver available (old WebView) — render
      // everything rather than silently truncating the list with no way
      // to load more.
      setVisibleCount(Number.MAX_SAFE_INTEGER);
      return;
    }
    if (!sentinelEl) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisibleCount((count) => count + PAGE_SIZE);
        }
      },
      { rootMargin: "400px" },
    );
    observer.observe(sentinelEl);
    return () => observer.disconnect();
  }, [sentinelEl]);

  return { visibleCount, sentinelRef: setSentinelEl };
}
