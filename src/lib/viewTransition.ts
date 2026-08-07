import { flushSync } from "react-dom";

// Native page transitions via the View Transitions API — the thing that makes a
// tapped photo *expand* into the lightbox instead of the page cutting to it.
//
// Support: same-document transitions ship in Safari on iOS 18.1+, Chrome 111+
// and Firefox 133+. Anywhere else this degrades to the old instant swap, which
// is exactly what the site did before, so there's nothing to guard against.

const NAME = "vt-photo";

type Doc = Document & {
  startViewTransition?: (cb: () => void) => { finished: Promise<void> };
};

function findTile(photoId: string) {
  return document.querySelector<HTMLElement>(`[data-vt="${CSS.escape(photoId)}"]`);
}

/**
 * Morph between a grid tile and the lightbox.
 *
 * `photoId` is the photo being opened, or the one being closed back onto.
 * `update` must synchronously apply the React state change — hence flushSync,
 * because the browser snapshots the DOM the moment the callback returns and a
 * normal async setState would not have rendered yet.
 */
export function morphPhoto(photoId: string | null, update: () => void) {
  const doc = document as Doc;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (!doc.startViewTransition || reduced || !photoId) {
    update();
    return;
  }

  const tile = findTile(photoId);

  // Tag the tile so it's captured as the "old" state. The lightbox image
  // carries the same name via CSS, so the browser pairs them and tweens the
  // box between the two.
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
 * Closing runs the same pairing backwards: the lightbox holds the name in the
 * old frame, and the tile has to claim it for the new one.
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
    // After the update the grid is back; whichever tile matches takes the name
    // so the lightbox collapses onto it rather than fading out in place.
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
