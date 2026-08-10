import { useEffect, useMemo, useRef, useState } from "react";

// The landing "ignition": the archive appears as a contact sheet and collapses
// inward into the hero. It answers the question a first-time visitor actually
// has — "is there enough here to be worth my time" — in about a second, before
// they've had to scroll or read anything.
//
// It runs at the LCP moment, so the constraints are stricter than the motion:
//
//   1. It never blocks the hero. The hero image loads underneath at high
//      priority exactly as before; this is an overlay on top of it.
//   2. It never waits. Thumbnails get a hard budget — miss it and the whole
//      effect is skipped rather than making someone watch a blank screen.
//   3. Compositor-only: transform and opacity, nothing that lays out or
//      repaints per frame.
//   4. It unmounts when finished, so it costs nothing for the rest of the visit.
//   5. Once per session, not on every client-side return to the home page. A
//      load animation seen five times is an obstacle, not a flourish.

const DECODE_BUDGET_MS = 700; // longest we'll wait for thumbnails
const GIVE_UP_MS = 2500; // longest we'll wait for photo data to arrive at all
const TILE_MS = 640;
const MAX_STAGGER_MS = 220;
const TEARDOWN_MS = TILE_MS + MAX_STAGGER_MS + 120;
const DISTINCT = 18; // distinct files fetched; cells reuse them
const THUMB_W = 180;
const SESSION_KEY = "sd-ignited";

type Cell = {
  key: number; src: string;
  left: number; top: number; w: number; h: number;
  tx: number; ty: number; rot: number; delay: number;
};

function shouldRun() {
  if (typeof window === "undefined") return false;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  // A decorative grid of photographs is exactly what data-saver is asking us
  // not to download.
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (conn?.saveData) return false;
  try {
    if (sessionStorage.getItem(SESSION_KEY)) return false;
  } catch {
    // Private mode — just play it.
  }
  return true;
}

export function Ignition({ sources }: { sources: string[] }) {
  const [phase, setPhase] = useState<"waiting" | "armed" | "firing" | "done">(
    () => (shouldRun() ? "waiting" : "done"),
  );

  // Freeze the first usable set of sources.
  //
  // The gallery data arrives empty, fills, and can briefly empty again on a
  // refetch (focus/visibility). Reacting to every change meant the sheet was
  // rebuilt mid-sequence and the phase machine raced its own timers — the
  // effect silently never ran. Latching once removes that entire class of bug:
  // after the first non-empty value this component has a fixed input.
  const latched = useRef<string[] | null>(null);
  if (!latched.current && sources.length) latched.current = sources;
  const ready = latched.current;

  // Build the sheet once, sized to the viewport it opened at. Denser on desktop
  // because there's room for it — that's where the breadth reads, and where the
  // collapse has distance to travel.
  const cells = useMemo<Cell[]>(() => {
    if (typeof window === "undefined" || !ready?.length) return [];
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cols = vw >= 1600 ? 14 : vw >= 1100 ? 11 : vw >= 760 ? 8 : 5;
    const cellW = vw / cols;
    const rows = Math.max(3, Math.ceil(vh / cellW));
    const cellH = vh / rows;
    const cx = vw / 2;
    const cy = vh / 2;
    // Normalises the stagger so the inward wave reads the same on a phone and
    // on a 27-inch display.
    const maxDist = Math.hypot(cx, cy) || 1;

    const out: Cell[] = [];
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const i = r * cols + c;
        const mx = c * cellW + cellW / 2;
        const my = r * cellH + cellH / 2;
        out.push({
          key: i,
          src: ready[i % ready.length],
          left: (c * cellW * 100) / vw,
          top: (r * cellH * 100) / vh,
          w: (cellW * 100) / vw,
          h: (cellH * 100) / vh,
          // Converge on the middle of the screen, where the hero is.
          tx: cx - mx,
          ty: cy - my,
          // Deterministic tilt: scattered-looking, but stable across renders.
          rot: ((i * 37) % 13) - 6,
          // Outermost tiles leave first, so the sheet closes inward.
          delay: Math.round((1 - Math.hypot(mx - cx, my - cy) / maxDist) * MAX_STAGGER_MS),
        });
      }
    }
    return out;
  }, [ready]);

  // Give up if the photo data never shows. One timer, started once.
  useEffect(() => {
    if (phase !== "waiting") return;
    const t = window.setTimeout(() => setPhase((p) => (p === "waiting" ? "done" : p)), GIVE_UP_MS);
    return () => window.clearTimeout(t);
    // Deliberately only on mount-in-waiting: this is a wall-clock deadline, not
    // something to restart whenever the inputs change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Decode the thumbnails before anything is shown, racing a budget so a slow
  // connection gets the plain hero rather than a stalled animation.
  useEffect(() => {
    if (phase !== "waiting" || !cells.length) return;
    let cancelled = false;
    const distinct = Array.from(new Set(cells.map((c) => c.src)));
    const decoded = Promise.all(
      distinct.map(
        (src) =>
          new Promise<void>((resolve) => {
            const im = new Image();
            im.decoding = "async";
            im.src = src;
            im.decode().then(() => resolve()).catch(() => resolve());
          }),
      ),
    ).then(() => "ready" as const);
    const budget = new Promise<"late">((resolve) =>
      window.setTimeout(() => resolve("late"), DECODE_BUDGET_MS),
    );
    Promise.race([decoded, budget]).then((result) => {
      if (!cancelled) setPhase(result === "ready" ? "armed" : "done");
    });
    return () => { cancelled = true; };
  }, [phase, cells]);

  // Paint the full sheet for one frame before the transforms start, or the
  // collapse can appear to begin halfway through.
  useEffect(() => {
    if (phase !== "armed") return;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setPhase("firing"));
    });
    return () => { cancelAnimationFrame(outer); cancelAnimationFrame(inner); };
  }, [phase]);

  useEffect(() => {
    if (phase !== "firing") return;
    try {
      sessionStorage.setItem(SESSION_KEY, "1");
    } catch {
      // Not remembering isn't a reason to fail.
    }
    const t = window.setTimeout(() => setPhase("done"), TEARDOWN_MS);
    return () => window.clearTimeout(t);
  }, [phase]);

  // Nothing in the DOM before the sheet is ready, or after it's gone.
  if (phase === "waiting" || phase === "done" || !cells.length) return null;

  return (
    <div className={`ignition${phase === "firing" ? " is-firing" : ""}`} aria-hidden="true">
      {cells.map((c) => (
        <span
          className="ign-cell"
          key={c.key}
          style={
            {
              left: `${c.left}%`,
              top: `${c.top}%`,
              width: `${c.w}%`,
              height: `${c.h}%`,
              backgroundImage: `url(${c.src})`,
              "--tx": `${c.tx.toFixed(1)}px`,
              "--ty": `${c.ty.toFixed(1)}px`,
              "--rot": `${c.rot}deg`,
              animationDelay: `${c.delay}ms`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

export const IGNITION_DISTINCT = DISTINCT;
export const IGNITION_THUMB_W = THUMB_W;
