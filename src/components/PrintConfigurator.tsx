// The real print product page — true-to-size room mockup, size/frame/mount
// picker and cart, all driven by the real Prodigi catalogue (src/lib/printCatalogue.ts).
// Gated behind the `print_configurator` visibility flag (Admin → Visibility) so
// it can ship disabled until it's ready; see ShopProduct in App.tsx for the
// fallback to the old inline picker when the flag is off.
import { ChevronLeft, ChevronRight, ShoppingCart, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { getTransformedPublicUrl, photoBucket } from "../lib/supabase";
import type { Photo } from "../types";
import {
  COLOURS,
  MOULDING_CM,
  ROOM,
  SIZES,
  UNMOUNTED_BAND_CM,
  colourById,
  money,
  priceFor,
  sizeById,
  skuFor,
} from "../lib/printCatalogue";
import type { ColourId, SizeId } from "../lib/printCatalogue";
import { makeCartItem, useCart } from "../lib/cart";

function thumb(photo: Photo, width: number): string {
  return photo.storagePath ? getTransformedPublicUrl(photoBucket, photo.storagePath, width) : photo.imageUrl;
}

const orientOf = (p: Photo) => (p.aspect === "portrait" || p.aspect === "square" ? "portrait" : "landscape");
type PreviewMode = "studio" | "detail";

/** Largest size this photo's `maxSellable*` field allows for a given mount
 * option, or Infinity (no restriction) when the field is absent — e.g. the
 * gating columns haven't been backfilled for this photo, or ship ahead of
 * their migration. Fails open: an unknown photo isn't blocked from any size. */
function sizeRank(id: SizeId): number {
  return SIZES.findIndex((s) => s.id === id);
}

function isSizeAvailable(photo: Photo, size: SizeId, mounted: boolean): boolean {
  const maxId = mounted ? photo.maxSellableMounted : photo.maxSellableUnmounted;
  if (maxId == null) return true; // no gating data yet — don't block
  if (!SIZES.some((s) => s.id === maxId)) return true; // unrecognised value — fail open
  return sizeRank(size) <= sizeRank(maxId as SizeId);
}

export function PrintConfigurator({
  photo,
  otherShopPhotos,
  onNavigate,
}: {
  photo: Photo;
  otherShopPhotos: Photo[];
  onNavigate: (route: string) => void;
}) {
  const cart = useCart();
  const [size, setSize] = useState<SizeId>("A3");
  const [mounted, setMounted] = useState(true);
  const [colour, setColour] = useState<ColourId>("natural");
  const [cartOpen, setCartOpen] = useState(false);
  const [justAdded, setJustAdded] = useState(false);
  const [pulseCart, setPulseCart] = useState(false);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("studio");
  const pairTrackRef = useRef<HTMLDivElement | null>(null);

  const roomWrapRef = useRef<HTMLDivElement | null>(null);
  const [frameStyle, setFrameStyle] = useState<{ width: number; height: number; left: number; top: number } | null>(null);

  // Snap to the largest available size whenever the photo or mount option
  // changes and the currently-selected size is no longer offered for it —
  // e.g. switching to a lower-resolution photo, or toggling to unmounted
  // (which needs more pixels for the same size).
  useEffect(() => {
    if (isSizeAvailable(photo, size, mounted)) return;
    const fallback = [...SIZES].reverse().find((s) => isSizeAvailable(photo, s.id, mounted));
    if (fallback) setSize(fallback.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo.id, mounted]);

  useEffect(() => {
    const el = roomWrapRef.current;
    if (!el) return;
    const recompute = () => {
      const outerSize = sizeById(size).outer;
      const orient = orientOf(photo);
      const [shortEdge, longEdge] = outerSize;
      const outerW = orient === "landscape" ? longEdge : shortEdge;
      const outerH = orient === "landscape" ? shortEdge : longEdge;
      const naturalPxPerCm = (el.clientWidth / ROOM.naturalW) * ROOM.pxPerCmAtNative;

      // Keep the calibrated room scale whenever possible. A portrait A1 can
      // exceed the usable wall height on short desktop windows, so first move
      // its centre within the safe wall area and only then scale it down just
      // enough to keep the complete outer frame visible.
      const sideMargin = Math.max(14, el.clientWidth * 0.025);
      const topMargin = 62; // clears the Studio / Detail control
      const bottomMargin = 18;
      const availableW = Math.max(1, el.clientWidth - sideMargin * 2);
      const availableH = Math.max(1, el.clientHeight - topMargin - bottomMargin);
      const pxPerCm = Math.min(naturalPxPerCm, availableW / outerW, availableH / outerH);
      const width = outerW * pxPerCm;
      const height = outerH * pxPerCm;
      const wantedLeft = el.clientWidth * ROOM.centerX;
      const wantedTop = el.clientHeight * ROOM.centerY;
      const left = Math.min(
        Math.max(wantedLeft, sideMargin + width / 2),
        el.clientWidth - sideMargin - width / 2,
      );
      const top = Math.min(
        Math.max(wantedTop, topMargin + height / 2),
        el.clientHeight - bottomMargin - height / 2,
      );

      setFrameStyle({ width, height, left, top });
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [size, photo, previewMode]);

  const sizeDef = sizeById(size);
  const colourDef = colourById(colour);
  const price = priceFor(size, mounted);
  const sku = skuFor(size, mounted);
  const maxForMount = mounted ? photo.maxSellableMounted : photo.maxSellableUnmounted;
  // Only worth a note when it's an actual limitation — A1 (the top size) or
  // unknown/no restriction don't need a message at all.
  const maxIdeal = maxForMount && maxForMount !== "A1" && SIZES.some((s) => s.id === maxForMount) ? maxForMount : null;

  const pxPerCmForBand = frameStyle ? frameStyle.width / (orientOf(photo) === "landscape" ? sizeDef.outer[1] : sizeDef.outer[0]) : 0;
  const bandCm = mounted ? MOULDING_CM : UNMOUNTED_BAND_CM;
  const matCm = mounted ? Math.max(0, sizeDef.mat - MOULDING_CM) : 0;
  const orientation = orientOf(photo);
  const [shortEdge, longEdge] = sizeDef.outer;
  const detailOuterW = orientation === "landscape" ? longEdge : shortEdge;
  const detailOuterH = orientation === "landscape" ? shortEdge : longEdge;
  const detailBandPct = (bandCm / detailOuterW) * 100;
  const detailInnerW = Math.max(detailOuterW - bandCm * 2, 0.1);
  const detailMatPct = (matCm / detailInnerW) * 100;

  const pairPhotos = useMemo(() => {
    const others = otherShopPhotos.filter((p) => p.id !== photo.id);
    const score = (candidate: Photo) => {
      const sameLocation = candidate.locationId && photo.locationId
        ? candidate.locationId === photo.locationId
        : candidate.location === photo.location;
      const sharedCollections = candidate.collectionIds?.filter((id) => photo.collectionIds?.includes(id)).length ?? 0;
      const sameOrientation = orientOf(candidate) === orientOf(photo);

      return (sameLocation ? 12 : 0)
        + sharedCollections * 6
        + (candidate.kind === photo.kind ? 3 : 0)
        + (sameOrientation ? 1 : 0)
        + (candidate.year === photo.year ? 1 : 0);
    };

    return [...others].sort((a, b) =>
      score(b) - score(a)
      || (a.shopOrder ?? Number.MAX_SAFE_INTEGER) - (b.shopOrder ?? Number.MAX_SAFE_INTEGER)
      || a.title.localeCompare(b.title),
    );
  }, [otherShopPhotos, photo]);

  const switcherPhotos = useMemo(() => otherShopPhotos.filter((p) => p.id !== photo.id).slice(0, 4), [otherShopPhotos, photo.id]);

  function goToPhoto(p: Photo) {
    window.history.pushState({}, "", `/shop/${p.slug}`);
    onNavigate(`/shop/${p.slug}`);
    window.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior });
  }

  function goToShop() {
    window.history.pushState({}, "", "/shop#shop-grid");
    onNavigate("/shop");
    requestAnimationFrame(() => document.getElementById("shop-grid")?.scrollIntoView({ block: "start" }));
  }

  function scrollPairs(direction: -1 | 1) {
    const track = pairTrackRef.current;
    if (!track) return;
    track.scrollBy({ left: direction * Math.round(track.clientWidth * 0.82), behavior: "smooth" });
  }

  function addToCart() {
    cart.add(makeCartItem(photo, thumb(photo, 200), size, mounted, colour));
    setJustAdded(true);
    setPulseCart(false);
    requestAnimationFrame(() => setPulseCart(true));
    setTimeout(() => setJustAdded(false), 900);
  }

  function checkout() {
    if (!cart.items.length) return;
    setCartOpen(false);
    window.history.pushState({}, "", "/checkout");
    onNavigate("/checkout");
  }

  return (
    <main className="pc">
      <header className="pc-header">
        <button className="pc-back" type="button" onClick={() => { window.history.pushState({}, "", "/shop"); onNavigate("/shop"); }}>
          ◀ Framed Editions
        </button>
        <button className="pc-cart-btn" type="button" onClick={() => setCartOpen(true)}>
          <ShoppingCart size={15} aria-hidden="true" />
          Cart
          <span className={`pc-cart-count${cart.items.length === 0 ? " is-empty" : ""}${pulseCart ? " pulse" : ""}`} onAnimationEnd={() => setPulseCart(false)}>
            {cart.items.length}
          </span>
        </button>
      </header>

      <div className="pc-shop">
        <div className="pc-stage">
          <div
            className="pc-preview-tabs"
            role="tablist"
            aria-label="Print preview"
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const nextMode: PreviewMode = event.key === "ArrowLeft" || event.key === "Home" ? "studio" : "detail";
              setPreviewMode(nextMode);
              requestAnimationFrame(() => document.getElementById(`pc-${nextMode}-tab`)?.focus());
            }}
          >
            <button
              id="pc-studio-tab"
              className={previewMode === "studio" ? "on" : ""}
              type="button"
              role="tab"
              aria-controls="pc-studio-panel"
              aria-selected={previewMode === "studio"}
              tabIndex={previewMode === "studio" ? 0 : -1}
              onClick={() => setPreviewMode("studio")}
            >
              Studio
            </button>
            <button
              id="pc-detail-tab"
              className={previewMode === "detail" ? "on" : ""}
              type="button"
              role="tab"
              aria-controls="pc-detail-panel"
              aria-selected={previewMode === "detail"}
              tabIndex={previewMode === "detail" ? 0 : -1}
              onClick={() => setPreviewMode("detail")}
            >
              Detail
            </button>
          </div>

          {previewMode === "studio" ? (
            <div className="pc-room-wrap pc-preview-panel" id="pc-studio-panel" role="tabpanel" aria-labelledby="pc-studio-tab" ref={roomWrapRef}>
              <img className="pc-room-img" src={ROOM.src} alt="A framed print hung on a bright, minimal wall" />
              {frameStyle ? (
                <div
                  className="pc-frame"
                  style={{
                    width: frameStyle.width,
                    height: frameStyle.height,
                    left: frameStyle.left,
                    top: frameStyle.top,
                  }}
                >
                  <div
                    className="pc-frame-band"
                    style={{
                      background: colourDef.grain ? `${colourDef.grain}, ${colourDef.css}` : colourDef.css,
                      padding: bandCm * pxPerCmForBand,
                    }}
                  >
                    <div className="pc-frame-mat" style={{ padding: matCm * pxPerCmForBand }}>
                      <div className="pc-frame-window">
                        <img src={thumb(photo, 1200)} alt={`${photo.title}, ${photo.location}, framed`} />
                        <div className="pc-frame-glass" aria-hidden="true" />
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
              <div className="pc-stage-tag">
                <p className="pc-k">Framed Editions</p>
                <h1>{photo.title}</h1>
                <p className="pc-loc">{photo.location}</p>
              </div>
            </div>
          ) : (
            <div className="pc-detail-wrap pc-preview-panel" id="pc-detail-panel" role="tabpanel" aria-labelledby="pc-detail-tab">
              <div
                className={`pc-detail-frame ${orientation}`}
                style={{ aspectRatio: `${detailOuterW} / ${detailOuterH}` }}
              >
                <div
                  className="pc-frame-band"
                  style={{
                    background: colourDef.grain ? `${colourDef.grain}, ${colourDef.css}` : colourDef.css,
                    padding: `${detailBandPct}%`,
                  }}
                >
                  <div className="pc-frame-mat" style={{ padding: `${detailMatPct}%` }}>
                    <div className="pc-frame-window">
                      <img key={photo.id} className="pc-detail-image" src={thumb(photo, 1600)} alt={`${photo.title}, ${photo.location}, frame detail`} />
                      <div className="pc-frame-glass" aria-hidden="true" />
                    </div>
                  </div>
                </div>
              </div>
              <div className="pc-detail-spec" aria-live="polite">
                <b>{size} · {detailOuterW.toFixed(1)} × {detailOuterH.toFixed(1)} cm</b>
                <span>
                  {mounted ? `${matCm.toFixed(1)} cm mat · ${MOULDING_CM.toFixed(1)} cm frame` : "Full-bleed presentation"}
                  {` · ${orientation}`}
                </span>
              </div>
            </div>
          )}
          {previewMode === "studio" ? <div className="pc-scroll-hint">Configure ↓</div> : null}
        </div>

        <div className="pc-panel">
          {switcherPhotos.length ? (
            <div className="pc-switcher-row">
              <label>Prefer a different shot?</label>
              <div className="pc-photo-strip">
                {switcherPhotos.map((p) => (
                  <button key={p.id} className="pc-photo-pick" type="button" onClick={() => goToPhoto(p)} title={`${p.title}, ${p.location}`}>
                    <img src={thumb(p, 120)} alt={p.title} />
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="pc-prod-head">
            <span className="pc-edition">Open edition · Fine-art giclée</span>
            <h2>{photo.title}</h2>
            <p className="pc-sub">{photo.location}{photo.year ? ` · ${photo.year}` : ""}</p>
          </div>

          <div className="pc-group">
            <div className="pc-group-head"><label>Size</label><span className="pc-val">{sizeDef.outer[0].toFixed(1)} × {sizeDef.outer[1].toFixed(1)} cm</span></div>
            <div className="pc-sizes">
              {SIZES.map((s) => {
                const available = isSizeAvailable(photo, s.id, mounted);
                return (
                  <button
                    key={s.id}
                    className={`pc-size-btn${s.id === size ? " on" : ""}${available ? "" : " unavailable"}`}
                    type="button"
                    disabled={!available}
                    title={available ? undefined : "This photo's source resolution doesn't support a sharp print at this size."}
                    onClick={() => available && setSize(s.id)}
                  >
                    <b>{s.id}</b>
                    <span>{s.outer[0].toFixed(0)}×{s.outer[1].toFixed(0)}cm</span>
                  </button>
                );
              })}
            </div>
            {maxIdeal ? <p className="pc-quality-note">Best print quality up to {maxIdeal}{mounted ? " mounted" : ""} for this image.</p> : null}
          </div>

          <div className="pc-group">
            <div className="pc-group-head"><label>Frame colour</label><span className="pc-val">{colourDef.label}</span></div>
            <div className="pc-swatches">
              {COLOURS.map((c) => (
                <button key={c.id} className={`pc-swatch-btn${c.id === colour ? " on" : ""}`} type="button" onClick={() => setColour(c.id)} title={c.label}>
                  <span className="pc-swatch-chip" style={{ background: c.css }} />
                  <span>{c.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="pc-group">
            <div className="pc-group-head"><label>Mount</label></div>
            <div className="pc-mount-toggle">
              <button type="button" className={mounted ? "on" : ""} onClick={() => setMounted(true)}>Mounted</button>
              <button type="button" className={!mounted ? "on" : ""} onClick={() => setMounted(false)}>Unmounted</button>
            </div>
            <p className="pc-mount-note">
              {mounted
                ? "Snow-white mat, fixed width per size — the frame's outer size doesn't change, mount or not."
                : "Print runs to the frame's edge. Same outer size as mounted, just no mat."}
            </p>
          </div>

          <div className="pc-price-row"><span className="pc-price">{money(price)}</span></div>
          <button className="pc-add-cart" type="button" onClick={addToCart}>{justAdded ? "Added ✓" : "Add to cart"}</button>
          <p className="pc-ship-note">
            Shipping isn't flat — it's quoted live from the print size (from $15.10, AU only). Add a second A5–A2 print to the same order and shipping adds exactly <b>$5.00</b>, not another full charge. (Two A1 prints together add $10 for the second — they can't share a parcel.)
          </p>
          <p className="pc-sku-note">SKU {sku}</p>
        </div>
      </div>

      <section className="pc-trust">
        <div><b>Printed to order</b><span>Made in Australia when you order — nothing sits in a warehouse.</span></div>
        <div><b>Archival fine-art paper</b><span>200gsm giclée print, rated to outlast a lifetime on the wall.</span></div>
        <div><b>Ships in 2–3 days</b><span>Tracked Australia Post, straight from an Australian lab.</span></div>
      </section>

      {pairPhotos.length ? (
        <section className="pc-pairs" aria-labelledby="pc-similar-title">
          <div className="pc-pairs-head">
            <h3 id="pc-similar-title">Similar images</h3>
            <div className="pc-pairs-actions">
              <div className="pc-pairs-nav" aria-label="Scroll similar images">
                <button type="button" onClick={() => scrollPairs(-1)} aria-label="Previous similar images">
                  <ChevronLeft size={16} aria-hidden="true" />
                </button>
                <button type="button" onClick={() => scrollPairs(1)} aria-label="Next similar images">
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              </div>
              <button className="pc-pairs-see-all" type="button" onClick={goToShop}>See all prints</button>
            </div>
          </div>
          <p className="pc-pairs-callout">Pick one to configure — adding it to the same order usually costs about $5 in shipping, not $15.</p>
          <div className="pc-pairs-track" ref={pairTrackRef}>
            {pairPhotos.map((p) => (
              <button key={p.id} className="pc-pair-card" type="button" onClick={() => goToPhoto(p)}>
                <div className="pc-pair-photo"><img src={thumb(p, 400)} alt={`${p.title}, ${p.location}`} loading="lazy" /></div>
                <b>{p.title}</b>
                <span>{p.location}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <div className={`pc-scrim${cartOpen ? " open" : ""}`} onClick={() => setCartOpen(false)} />
      <div className={`pc-cart-drawer${cartOpen ? " open" : ""}`} aria-label="Cart">
        <div className="pc-cart-head"><h3>Your cart</h3><button type="button" onClick={() => setCartOpen(false)} aria-label="Close cart"><X size={18} /></button></div>
        <div className="pc-cart-items">
          {cart.items.length === 0 ? (
            <p className="pc-cart-empty">Nothing in your cart yet — configure a print and add it.</p>
          ) : (
            cart.items.map((it, i) => (
              <div className="pc-cart-item" key={`${it.photoId}-${i}`}>
                <img src={it.thumb} alt={it.title} />
                <div className="pc-ci-info">
                  <b>{it.title}</b>
                  <span>{it.size} · {colourById(it.colour).label} · {it.mounted ? "Mounted" : "Unmounted"}</span>
                  <span className="pc-ci-remove" role="button" onClick={() => cart.remove(i)}>Remove</span>
                </div>
                <div className="pc-ci-price">{money(it.price)}</div>
              </div>
            ))
          )}
        </div>
        <div className="pc-cart-foot">
          {cart.items.length ? (
            <div className="pc-cart-lines">
              <div className="row"><span>Subtotal</span><span>{money(cart.subtotal)}</span></div>
              <div className="row"><span>Shipping (AU)</span><span>{money(cart.shipping)}</span></div>
              <div className="row total"><span>Estimated total</span><span>{money(cart.subtotal + cart.shipping)}</span></div>
            </div>
          ) : null}
          <p className="pc-au-note">Shipping within Australia only. Exact cost is confirmed at checkout.</p>
          <button className="pc-checkout-btn" disabled={!cart.items.length} type="button" onClick={checkout}>Secure checkout</button>
          <p className="pc-checkout-note">Promotion codes are applied securely at checkout.</p>
        </div>
      </div>
    </main>
  );
}
