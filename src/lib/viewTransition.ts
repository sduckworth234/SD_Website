import { flushSync } from "react-dom";

// Native page transitions via the View Transitions API — the thing that makes a
// tapped photo *expand* into the lightbox instead of the page cutting to it.
//
// Support: same-document transitions ship in Safari on iOS 18.1+, Chrome 111+
// and Firefox 133+. Anywhere else this degrades to the old instant swap, which
// is exactly what the site did before.

const NAME = "vt-photo";

// How long we'll wait for the lightbox's image before giving up on animating.
// Past this a tap starts to feel unresponsive, and a plain open beats a late one.
const WARM_TIMEOUT_MS = 450;

type Doc = Document & {
  startViewTransition?: (cb: () => void) => { finished: Promise<void> };
};

export type MorphTarget = {
  id: string;
  src: string;
  srcSet?: string;
  sizes?: string;
};

function findTile(photoId: string) {
  return document.querySelector<HTMLElement>(`[data-vt="${CSS.escape(photoId)}"]`);
}

/**
 * Get the lightbox's image decoded and in cache BEFORE the transition starts.
 *
 * This is the whole reason the first version looked broken: the browser
 * snapshots the new frame the instant the update callback returns, and at that
 * point the lightbox's much larger variant hasn't downloaded — so the tile
 * animated into an empty box and the photo popped in afterwards.
 *
 * Setting sizes + srcset + src on a detached Image makes the browser run the
 * same candidate selection the real <img> will, so we warm the exact URL it
 * ends up requesting rather than a different variant that wouldn't help.
 */
const warming = new Map<string, Promise<boolean>>();

function warm(target: MorphTarget): Promise<boolean> {
  const existing = warming.get(target.id);
  if (existing) return existing;

  const job = new Promise<boolean>((resolve) => {
    const img = new Image();
    // sizes must be set before srcset for the selection to be correct.
    if (target.sizes) img.sizes = target.sizes;
    if (target.srcSet) img.srcset = target.srcSet;
    img.src = target.src;
    img.decode().then(() => resolve(true)).catch(() => resolve(false));
  });
  warming.set(target.id, job);
  return job;
}

/**
 * Start fetching a photo's lightbox variant on finger-down, before the tap has
 * even completed.
 *
 * Without this the FIRST tap on any photo never animates: the larger variant
 * takes ~450ms+ to arrive cold while a warm one decodes in about 4ms, so the
 * morph would silently skip itself exactly once per photo — which reads as
 * "sometimes it works". Pointer-down buys back the 100–250ms before click.
 */
export function prewarmPhoto(target: MorphTarget) {
  const doc = document as Doc;
  if (!doc.startViewTransition) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  void warm(target);
}

function warmWithin(target: MorphTarget, ms: number): Promise<boolean> {
  return Promise.race([
    warm(target),
    new Promise<boolean>((resolve) => window.setTimeout(() => resolve(false), ms)),
  ]);
}

/**
 * Morph a grid tile into the lightbox.
 *
 * `update` must synchronously apply the React state change — hence flushSync,
 * because the browser snapshots the DOM the moment the callback returns and a
 * normal async setState would not have rendered yet.
 */
export async function morphPhoto(target: MorphTarget, update: () => void) {
  const doc = document as Doc;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (!doc.startViewTransition || reduced) {
    update();
    return;
  }

  // No pixels, no morph. An animation into a blank frame is worse than none.
  const ready = await warmWithin(target, WARM_TIMEOUT_MS);
  if (!ready) {
    update();
    return;
  }

  const tile = findTile(target.id);
  if (tile) tile.style.viewTransitionName = NAME;

  const transition = doc.startViewTransition(() => {
    flushSync(() => {
      // Two elements must never hold the same name in one snapshot, or the
      // transition is abandoned. Releasing it here means the tile owns the name
      // in the old frame and the lightbox owns it in the new one.
      if (tile) tile.style.viewTransitionName = "";
      update();
    });
  });

  transition.finished
    .catch(() => {})
    .finally(() => {
      if (tile) tile.style.viewTransitionName = "";
    });
}

/**
 * Closing runs the same pairing backwards. No warming needed — the tile has
 * been on screen the whole time, so its image is already decoded.
 */
export function morphBack(photoId: string | null, update: () => void) {
  const doc = document as Doc;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (!doc.startViewTransition || reduced || !photoId) {
    update();
    return;
  }

  const transition = doc.startViewTransition(() => {
    flushSync(update);
    const tile = findTile(photoId);
    if (tile) tile.style.viewTransitionName = NAME;
  });

  transition.finished
    .catch(() => {})
    .finally(() => {
      const tile = findTile(photoId);
      if (tile) tile.style.viewTransitionName = "";
    });
}
