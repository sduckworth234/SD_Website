// The real print product page — true-to-size room mockup, size/frame/mount
// picker and cart, all driven by the real Prodigi catalogue (src/lib/printCatalogue.ts).
// Gated behind the `print_configurator` visibility flag (Admin → Visibility) so
// it can ship disabled until it's ready; see ShopProduct in App.tsx for the
// fallback to the old inline picker when the flag is off.
import { ChevronLeft, ChevronRight, Menu, ShoppingCart, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getTransformedPublicUrl, photoBucket } from "../lib/supabase";
import { trackAddToCart, trackProductLinkClicked, trackProductViewChanged, trackViewItem } from "../lib/analytics";
import { productStructuredData, useSeo } from "../lib/seo";
import type { Photo } from "../types";
import {
  COLOURS,
  MOULDING_CM,
  ROOM,
  SIZES,
  UNMOUNTED_BAND_CM,
  colourById,
  isSizeSellable,
  money,
  priceFor,
  sizeById,
} from "../lib/printCatalogue";
import type { ColourId, SizeId } from "../lib/printCatalogue";
import { makeCartItem, useCart } from "../lib/cart";
import { CartDrawer } from "./CartDrawer";
import { ShopLegalFooter } from "./LegalPages";
import { ContactOverlay } from "./ContactOverlay";

function thumb(photo: Photo, width: number): string {
  return photo.storagePath ? getTransformedPublicUrl(photoBucket, photo.storagePath, width) : photo.imageUrl;
}

const orientOf = (p: Photo) => (p.aspect === "portrait" || p.aspect === "square" ? "portrait" : "landscape");
type PreviewMode = "studio" | "detail";

/** Is `size`/`mounted` sellable for this photo? Prefers the resolved
 * sellable_sizes map (computed resolution merged with any admin override —
 * see supabase/migrations/20260816130000_photo_size_overrides.sql), falls
 * back to the simple maxSellable label for photos that predate it. Fails
 * open when there's no gating data at all — never block on missing data. */
function isSizeAvailable(photo: Photo, size: SizeId, mounted: boolean): boolean {
  return isSizeSellable(size, mounted, photo.sellableSizes, mounted ? photo.maxSellableMounted : photo.maxSellableUnmounted);
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
  const [navOpen, setNavOpen] = useState(false);
  const [justAdded, setJustAdded] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [pulseCart, setPulseCart] = useState(false);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("studio");
  const [questionOpen, setQuestionOpen] = useState(false);
  const pairTrackRef = useRef<HTMLDivElement | null>(null);

  const roomWrapRef = useRef<HTMLDivElement | null>(null);
  const [frameStyle, setFrameStyle] = useState<{
    width: number;
    height: number;
    left: number;
    top: number;
    bandPx: number;
    matPx: number;
  } | null>(null);

  function navigate(route: string) {
    setNavOpen(false);
    window.history.pushState({}, "", route);
    onNavigate(route);
  }

  useEffect(() => {
    if (!navOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setNavOpen(false); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navOpen]);

  // Snap to the largest available size whenever the photo or mount option
  // changes and the currently-selected size is no longer offered for it —
  // e.g. switching to a lower-resolution photo, or toggling to unmounted
  // (which needs more pixels for the same size).
  useEffect(() => {
    setAddError(null);
    if (isSizeAvailable(photo, size, mounted)) return;
    const fallback = [...SIZES].reverse().find((s) => isSizeAvailable(photo, s.id, mounted));
    if (fallback) setSize(fallback.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo.id, size, mounted]);

  useLayoutEffect(() => {
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
      const nextBandCm = mounted ? MOULDING_CM : UNMOUNTED_BAND_CM;
      const nextMatCm = mounted ? Math.max(0, sizeById(size).mat - MOULDING_CM) : 0;
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

      // Commit the frame, moulding and mat as one animation target. Keeping
      // these together avoids a one-frame retarget where A1 mat proportions
      // were briefly calculated against the previous outer frame width.
      setFrameStyle({
        width,
        height,
        left,
        top,
        bandPx: nextBandCm * pxPerCm,
        matPx: nextMatCm * pxPerCm,
      });
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [size, mounted, photo, previewMode]);

  const sizeDef = sizeById(size);
  const colourDef = colourById(colour);
  const price = priceFor(size, mounted);
  const maxForMount = mounted ? photo.maxSellableMounted : photo.maxSellableUnmounted;
  // Only worth a note when it's an actual limitation — A1 (the top size) or
  // unknown/no restriction don't need a message at all.
  const maxIdeal = maxForMount && maxForMount !== "A1" && SIZES.some((s) => s.id === maxForMount) ? maxForMount : null;

  const bandCm = mounted ? MOULDING_CM : UNMOUNTED_BAND_CM;
  const matCm = mounted ? Math.max(0, sizeDef.mat - MOULDING_CM) : 0;
  const orientation = orientOf(photo);
  const [shortEdge, longEdge] = sizeDef.outer;
  const detailOuterW = orientation === "landscape" ? longEdge : shortEdge;
  const detailOuterH = orientation === "landscape" ? shortEdge : longEdge;
  const detailBandPct = (bandCm / detailOuterW) * 100;
  const detailInnerW = Math.max(detailOuterW - bandCm * 2, 0.1);
  const detailMatPct = (matCm / detailInnerW) * 100;
  const seoDescription = `${photo.title}, ${photo.location} — a fine-art photography print by Sam Duckworth, framed to order in Australia.`;
  const seoSchema = useMemo(() => productStructuredData({
    name: `${photo.title} — Framed photographic print`,
    description: seoDescription,
    path: `/shop/${photo.slug}`,
    image: thumb(photo, 1600),
    price: priceFor("A5", false),
    available: true,
    category: "Fine-art photography print",
    material: "Archival fine-art paper with professional frame",
  }), [photo, seoDescription]);

  useSeo(`${photo.title} print — Sam Duckworth Photography`, {
    description: seoDescription,
    path: `/shop/${photo.slug}`,
    image: thumb(photo, 1600),
    type: "product",
    structuredData: seoSchema,
  });

  useEffect(() => {
    trackViewItem({
      currency: "AUD",
      value: priceFor("A5", false),
      items: [{
        item_id: photo.id,
        item_name: photo.title,
        item_brand: "Sam Duckworth Photography",
        item_category: "Fine-art print",
        item_category2: photo.location,
        price: priceFor("A5", false),
        quantity: 1,
      }],
    });
  }, [photo.id, photo.location, photo.title]);

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
    ).slice(0, 10);
  }, [otherShopPhotos, photo]);

  const switcherPhotos = useMemo(() => otherShopPhotos.filter((p) => p.id !== photo.id).slice(0, 4), [otherShopPhotos, photo.id]);

  function goToPhoto(p: Photo) {
    trackProductLinkClicked({ item_id: p.id, item_name: p.title, source: "similar_images" });
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
    // Belt-and-braces: the size buttons are already disabled for an
    // unavailable size, but don't trust that alone (a stale tab still
    // running pre-gating JS, a disabled attribute stripped some other way).
    // This is the same check the checkout API enforces server-side —
    // catching it here just gives a clearer moment to fail than a checkout
    // error two steps later.
    if (!isSizeAvailable(photo, size, mounted)) {
      setAddError(`${size}${mounted ? " mounted" : ""} isn't available for this photo — refresh the page and pick another size.`);
      return;
    }
    setAddError(null);
    cart.add(makeCartItem(photo, thumb(photo, 200), size, mounted, colour));
    trackAddToCart({
      currency: "AUD",
      value: price,
      items: [{
        item_id: photo.id,
        item_name: photo.title,
        item_brand: "Sam Duckworth Photography",
        item_category: "Fine-art print",
        item_category2: photo.location,
        item_variant: `${size} · ${colourDef.label} · ${mounted ? "Mounted" : "Unmounted"}`,
        price,
        quantity: 1,
      }],
    });
    setJustAdded(true);
    setPulseCart(false);
    requestAnimationFrame(() => setPulseCart(true));
    setTimeout(() => setJustAdded(false), 900);
  }

  return (
    <main className="pc">
      <header className="pc-header">
        <button className="pc-back" type="button" onClick={() => navigate("/shop")}>
          ◀ Framed Editions
        </button>
        <div className="pc-header-actions">
          <button className="pc-cart-btn" type="button" onClick={() => setCartOpen(true)}>
            <ShoppingCart size={15} aria-hidden="true" />
            Cart
            <span className={`pc-cart-count${cart.items.length === 0 ? " is-empty" : ""}${pulseCart ? " pulse" : ""}`} onAnimationEnd={() => setPulseCart(false)}>
              {cart.items.length}
            </span>
          </button>
          <button className="pc-menu-toggle" type="button" aria-expanded={navOpen} aria-controls="pc-mobile-navigation" aria-label={navOpen ? "Close shop navigation" : "Open shop navigation"} onClick={() => setNavOpen((open) => !open)}>
            {navOpen ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}
          </button>
        </div>
        {navOpen ? <button className="pc-nav-dismiss" onClick={() => setNavOpen(false)} type="button" aria-label="Close shop navigation" /> : null}
        <nav id="pc-mobile-navigation" className={`pc-mobile-nav${navOpen ? " is-open" : ""}`} aria-label="Product mobile navigation" aria-hidden={!navOpen} inert={!navOpen}>
          <span className="shop-mobile-nav-label">Photography</span>
          <a href="/" onClick={(event) => { event.preventDefault(); navigate("/"); }}>Photography home</a>
          <a href="/galleries" onClick={(event) => { event.preventDefault(); navigate("/galleries"); }}>Gallery</a>
          <a href="/map" onClick={(event) => { event.preventDefault(); navigate("/map"); }}>Map</a>
          <a href="/?panel=about" onClick={(event) => { event.preventDefault(); navigate("/?panel=about"); }}>About Me</a>
          <a href="/?panel=contact" onClick={(event) => { event.preventDefault(); navigate("/?panel=contact"); }}>Contact</a>
          <span className="shop-mobile-nav-label">Print shop</span>
          <a href="/shop" aria-current="page" onClick={(event) => { event.preventDefault(); navigate("/shop"); }}>Framed Editions</a>
          <button type="button" onClick={() => { setNavOpen(false); setCartOpen(true); }}>Cart <span>{cart.items.length}</span></button>
        </nav>
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
              trackProductViewChanged({ item_id: photo.id, item_name: photo.title, view: nextMode });
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
              onClick={() => {
                setPreviewMode("studio");
                trackProductViewChanged({ item_id: photo.id, item_name: photo.title, view: "studio" });
              }}
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
              onClick={() => {
                setPreviewMode("detail");
                trackProductViewChanged({ item_id: photo.id, item_name: photo.title, view: "detail" });
              }}
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
                      padding: frameStyle.bandPx,
                    }}
                  >
                    <div className="pc-frame-mat" style={{ padding: frameStyle.matPx }}>
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
                    title={available ? undefined : "This size isn't offered for this photo."}
                    onClick={() => available && setSize(s.id)}
                  >
                    <b>{s.id}</b>
                    <span>{s.outer[0].toFixed(0)}×{s.outer[1].toFixed(0)}cm</span>
                    {available ? null : <em>Unavailable</em>}
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
          {addError ? <p className="pc-add-error" role="alert">{addError}</p> : null}
          <p className="pc-ship-note">
            Tracked Australia-wide delivery is calculated at checkout. Additional prints ship from $5 when they can be packed together.
          </p>
        </div>
      </div>

      <section className="pc-trust">
        <div><b>Printed to order</b><span>Made in Australia when you order — nothing sits in a warehouse.</span></div>
        <div><b>Archival fine-art paper</b><span>Gallery-quality giclée print, made to last on your wall.</span></div>
        <div><b>Typically dispatched in 2–3 business days</b><span>Tracked delivery from an Australian print lab.</span></div>
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
          <p className="pc-pairs-callout">Explore a curated selection of photographs that pair naturally with this one.</p>
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

      <section className="pc-help">
        <div>
          <b>Not sure which size is right, or have a question about this print?</b>
          <span>Sam answers these personally — sizing, framing, shipping, anything about {photo.title}.</span>
        </div>
        <button className="pc-help-btn" type="button" onClick={() => setQuestionOpen(true)}>
          Email a question
        </button>
      </section>

      <ShopLegalFooter className="pc-legal-footer" />

      <CartDrawer open={cartOpen} onClose={() => setCartOpen(false)} onNavigate={onNavigate} />
      {questionOpen ? (
        <ContactOverlay
          context={`Print question: ${photo.title}`}
          intro={`Ask about sizing, framing, shipping or anything else related to “${photo.title}”.`}
          onClose={() => setQuestionOpen(false)}
        />
      ) : null}
    </main>
  );
}
