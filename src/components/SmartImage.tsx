import { useEffect, useRef, useState } from "react";

// Image with a shimmer skeleton + fade-in, so partially-loaded images never
// flash in half-rendered. Skeleton is removed from the DOM once loaded.
export function SmartImage({
  alt,
  className,
  eager = false,
  src,
}: {
  alt: string;
  className?: string;
  eager?: boolean;
  src: string;
}) {
  const [loaded, setLoaded] = useState(false);
  const ref = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    if (ref.current?.complete) setLoaded(true);
  }, [src]);

  return (
    <>
      {loaded ? null : <span className="img-skeleton" aria-hidden="true" />}
      <img
        alt={alt}
        className={`smart-img${loaded ? " is-loaded" : ""}${className ? ` ${className}` : ""}`}
        decoding="async"
        loading={eager ? "eager" : "lazy"}
        onLoad={() => setLoaded(true)}
        ref={ref}
        src={src}
      />
    </>
  );
}
