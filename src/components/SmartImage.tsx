import { useEffect, useRef, useState } from "react";

// Image with a shimmer skeleton + fade-in, so partially-loaded images never
// flash in half-rendered. Skeleton is removed from the DOM once loaded.
// Failed loads retry automatically (Supabase's transform endpoint can be slow
// or drop requests on a cold first visit); after the retries the skeleton is
// dropped rather than shimmering forever.
const MAX_RETRIES = 2;

export function SmartImage({
  alt,
  className,
  eager = false,
  onMeasure,
  priority = false,
  sizes,
  src,
  srcSet,
  vtId,
}: {
  alt: string;
  className?: string;
  eager?: boolean;
  // Marks this image as a view-transition candidate for the given photo id.
  // lib/viewTransition.ts finds it by this attribute to morph a tile into the
  // lightbox — see morphPhoto().
  vtId?: string;
  // Marks the LCP-critical image (e.g. the landing hero): loads eagerly at
  // high network priority.
  priority?: boolean;
  // Reports the loaded image's width/height aspect ratio (w / h).
  onMeasure?: (ratio: number) => void;
  // Responsive image hints: srcSet lists width variants, sizes the rendered width.
  sizes?: string;
  src: string;
  srcSet?: string;
}) {
  const [loaded, setLoaded] = useState(false);
  // Already-cached images (e.g. pre-warmed by the gallery gate) appear
  // instantly instead of re-playing the fade — the surrounding reveal
  // animation stays the only motion.
  const [instant, setInstant] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const ref = useRef<HTMLImageElement | null>(null);
  const retryTimer = useRef<number | undefined>(undefined);

  function handleLoaded(img: HTMLImageElement | null) {
    setLoaded(true);
    if (img && img.naturalHeight > 0) onMeasure?.(img.naturalWidth / img.naturalHeight);
  }

  function handleError() {
    setAttempt((current) => {
      if (current >= MAX_RETRIES) {
        // Out of retries: drop the shimmer so the tile doesn't pulse forever.
        setLoaded(true);
        return current;
      }
      window.clearTimeout(retryTimer.current);
      retryTimer.current = window.setTimeout(
        () => setAttempt(current + 1),
        900 * (current + 1),
      );
      return current;
    });
  }

  useEffect(() => {
    setLoaded(false);
    setAttempt(0);
    const cached = Boolean(ref.current?.complete && ref.current.naturalHeight > 0);
    setInstant(cached);
    if (cached) handleLoaded(ref.current);
    return () => window.clearTimeout(retryTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  return (
    <>
      {loaded ? null : <span className="img-skeleton" aria-hidden="true" />}
      <img
        alt={alt}
        className={`smart-img${loaded ? " is-loaded" : ""}${instant ? " is-instant" : ""}${className ? ` ${className}` : ""}`}
        data-vt={vtId}
        decoding="async"
        draggable={false}
        fetchPriority={priority ? "high" : undefined}
        // Remount on each retry so the browser actually re-requests the URL.
        key={`${src}#${attempt}`}
        loading={eager || priority ? "eager" : "lazy"}
        onError={handleError}
        onLoad={(event) => handleLoaded(event.currentTarget)}
        ref={ref}
        sizes={sizes}
        src={src}
        srcSet={srcSet}
      />
    </>
  );
}
