import { useEffect, useRef, useState } from "react";

// Image with a shimmer skeleton + fade-in, so partially-loaded images never
// flash in half-rendered. Skeleton is removed from the DOM once loaded.
export function SmartImage({
  alt,
  className,
  eager = false,
  onMeasure,
  src,
}: {
  alt: string;
  className?: string;
  eager?: boolean;
  // Reports the loaded image's width/height aspect ratio (w / h).
  onMeasure?: (ratio: number) => void;
  src: string;
}) {
  const [loaded, setLoaded] = useState(false);
  const ref = useRef<HTMLImageElement | null>(null);

  function handleLoaded(img: HTMLImageElement | null) {
    setLoaded(true);
    if (img && img.naturalHeight > 0) onMeasure?.(img.naturalWidth / img.naturalHeight);
  }

  useEffect(() => {
    if (ref.current?.complete) handleLoaded(ref.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  return (
    <>
      {loaded ? null : <span className="img-skeleton" aria-hidden="true" />}
      <img
        alt={alt}
        className={`smart-img${loaded ? " is-loaded" : ""}${className ? ` ${className}` : ""}`}
        decoding="async"
        loading={eager ? "eager" : "lazy"}
        onLoad={(event) => handleLoaded(event.currentTarget)}
        ref={ref}
        src={src}
      />
    </>
  );
}
