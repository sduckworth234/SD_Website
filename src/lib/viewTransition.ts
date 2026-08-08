// Pre-warming for the lightbox image.
//
// There used to be a shared-element morph here (View Transitions API) that
// animated the tapped tile into the lightbox. It was removed: the tile is
// cover-cropped and the lightbox is contain-fitted, so the two frames are
// different shapes, and pairing them meant every open depended on decode
// timing, layout settling and a crop mismatch all landing together. On a phone
// it never looked clean.
//
// What's left is the part that was actually doing the work — getting the
// image decoded before the lightbox appears, so the photo is simply THERE when
// the panel opens instead of popping in a beat later. The panel itself now
// animates with plain CSS, which costs nothing and can't stall.

export type WarmTarget = {
  id: string;
  src: string;
  srcSet?: string;
  sizes?: string;
};

const warming = new Map<string, Promise<boolean>>();

/**
 * Start fetching a photo's lightbox variant on finger-down, before the tap has
 * even completed.
 *
 * The lightbox asks for a much larger variant than the tile: measured at ~4ms
 * to decode warm versus over 450ms cold. Pointer-down buys back the 100–250ms
 * before click, which is usually enough to cover it.
 *
 * Setting sizes + srcset + src on a detached Image makes the browser run the
 * same candidate selection the real <img> will, so this warms the exact URL it
 * ends up requesting rather than a different variant that wouldn't help.
 */
export function prewarmPhoto(target: WarmTarget) {
  if (warming.has(target.id)) return;
  const job = new Promise<boolean>((resolve) => {
    const img = new Image();
    // sizes must be set before srcset for the selection to be correct.
    if (target.sizes) img.sizes = target.sizes;
    if (target.srcSet) img.srcset = target.srcSet;
    img.src = target.src;
    img.decode().then(() => resolve(true)).catch(() => resolve(false));
  });
  warming.set(target.id, job);
}
