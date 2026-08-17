import { ArrowUpFromLine, Frame, Globe, Images, MapPin, X } from "lucide-react";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { getTransformedPublicUrl, photoBucket } from "../lib/supabase";
import type { Photo } from "../types";
import { SmartImage } from "./SmartImage";

export const PHOTO_LIGHTBOX_SIZES = "(max-width: 920px) 92vw, 60vw";
const LIGHTBOX_EXIT_MS = 190;
const SRCSET_WIDTHS = [400, 700, 1000, 1400, 1800];
const BUCKET_RATIO: Record<Photo["aspect"], number> = { portrait: 0.75, landscape: 1.45, square: 1, wide: 2 };

export function photoLightboxSrcSet(photo: Photo): string | undefined {
  if (!photo.storagePath) return undefined;
  return SRCSET_WIDTHS.map((width) => `${getTransformedPublicUrl(photoBucket, photo.storagePath as string, width)} ${width}w`).join(", ");
}

function altitudeMeters(photo: Photo): number | null {
  const altitude = photo.relativeAltitude;
  if (altitude == null) return null;
  const metres = Math.round(altitude);
  return metres >= 1 && metres <= 1000 ? metres : null;
}

function AltitudeBadge({ photo }: { photo: Photo }) {
  const metres = altitudeMeters(photo);
  if (metres === null) return null;
  return (
    <span className="alt-badge" title={`Flown at ${metres} m above launch`} aria-label={`Altitude ${metres} metres`}>
      <ArrowUpFromLine size={11} aria-hidden="true" />
      {metres} m
    </span>
  );
}

export function PhotoLightbox({
  photo,
  origin,
  onClose,
  onViewOnMap,
  onViewGallery,
  onOrderPrint,
}: {
  photo: Photo;
  origin?: { x: number; y: number } | null;
  onClose: () => void;
  onViewOnMap?: (photo: Photo) => void;
  onViewGallery?: (photo: Photo) => void;
  onOrderPrint?: (photo: Photo) => void;
}) {
  const ratio = photo.ratio ?? BUCKET_RATIO[photo.aspect] ?? 1.45;
  const exactRatio = photo.ratio ?? null;
  const isPortrait = ratio < 1;
  const panelRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    if (!origin) {
      panel.style.removeProperty("transform-origin");
      return;
    }
    const box = panel.getBoundingClientRect();
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    if (!width || !height) return;
    const left = box.left + (box.width - width) / 2;
    const top = box.top + (box.height - height) / 2;
    const clamp = (value: number) => Math.max(-40, Math.min(140, value));
    const x = clamp(((origin.x - left) / width) * 100);
    const y = clamp(((origin.y - top) / height) * 100);
    panel.style.transformOrigin = `${x.toFixed(1)}% ${y.toFixed(1)}%`;
  }, [origin, photo.id]);

  const [closing, setClosing] = useState(false);
  const closeTimer = useRef<number | undefined>(undefined);
  const dismiss = useCallback(() => {
    if (closeTimer.current) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      onClose();
      return;
    }
    setClosing(true);
    closeTimer.current = window.setTimeout(onClose, LIGHTBOX_EXIT_MS);
  }, [onClose]);
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") dismiss(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dismiss]);

  const canViewMap = Boolean(onViewOnMap && photo.latitude != null && photo.longitude != null);
  const canViewGallery = Boolean(onViewGallery && photo.location && photo.location !== "Unsorted");
  const canOrderPrint = Boolean(onOrderPrint);

  return (
    <div className={`lightbox${closing ? " is-closing" : ""}`} role="dialog" aria-modal="true" aria-label={photo.title}>
      <button className="lightbox-backdrop" onClick={dismiss} type="button" aria-label="Close" />
      <section className={`lightbox-panel${isPortrait ? " is-portrait" : ""}`} ref={panelRef}>
        <button className="icon-button close-button" onClick={dismiss} type="button" aria-label="Close">
          <X size={18} aria-hidden="true" />
        </button>
        <div className="lightbox-image" style={exactRatio ? ({ "--shot-ratio": String(exactRatio) } as CSSProperties) : undefined}>
          <SmartImage
            noFade
            src={photo.imageUrl}
            srcSet={photoLightboxSrcSet(photo)}
            sizes={PHOTO_LIGHTBOX_SIZES}
            alt={`${photo.title}, ${photo.location}`}
          />
          <AltitudeBadge photo={photo} />
        </div>
        <aside className="lightbox-copy">
          <span className="lightbox-location"><MapPin size={13} aria-hidden="true" />{photo.location}</span>
          <h2>{photo.title}</h2>
          {photo.year ? <small>{photo.year}</small> : null}
          {canViewMap || canViewGallery || canOrderPrint ? (
            <div className="lightbox-actions">
              {canOrderPrint ? <button className="map-link-button order-print-button" onClick={() => onOrderPrint!(photo)} type="button"><Frame size={14} aria-hidden="true" />Order a print</button> : null}
              {canViewGallery ? <button className="map-link-button" onClick={() => onViewGallery!(photo)} type="button"><Images size={14} aria-hidden="true" />View gallery</button> : null}
              {canViewMap ? <button className="map-link-button" onClick={() => onViewOnMap!(photo)} type="button"><Globe size={14} aria-hidden="true" />View on map</button> : null}
            </div>
          ) : null}
        </aside>
      </section>
    </div>
  );
}
