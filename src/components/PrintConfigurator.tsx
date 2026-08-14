// The real print product page — true-to-size room mockup, size/frame/mount
// picker and cart, all driven by the real Prodigi catalogue (src/lib/printCatalogue.ts).
// Gated behind the `print_configurator` visibility flag (Admin → Visibility) so
// it can ship disabled until it's ready; see ShopProduct in App.tsx for the
// fallback to the old inline picker when the flag is off.
import { ShoppingCart, X } from "lucide-react";
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

const PROMO_CODES: Record<string, number> = { PRINT10: 0.10, WELCOME15: 0.15 };

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
  const [promoInput, setPromoInput] = useState("");
  const [promo, setPromo] = useState<{ code: string; pct: number } | null>(null);
  const [promoError, setPromoError] = useState(false);
  const [justAdded, setJustAdded] = useState(false);
  const [pulseCart, setPulseCart] = useState(false);

  // Reset the configurator to sane defaults whenever the product itself
  // changes (switching photo is a real route change — a fresh product).
  useEffect(() => {
    setSize("A3");
    setMounted(true);
    setColour("natural");
  }, [photo.id]);

  const roomWrapRef = useRef<HTMLDivElement | null>(null);
  const [frameStyle, setFrameStyle] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    const el = roomWrapRef.current;
    if (!el) return;
    const recompute = () => {
      const outerSize = sizeById(size).outer;
      const orient = orientOf(photo);
      const [shortEdge, longEdge] = outerSize;
      const outerW = orient === "landscape" ? longEdge : shortEdge;
      const outerH = orient === "landscape" ? shortEdge : longEdge;
      const pxPerCm = (el.clientWidth / ROOM.naturalW) * ROOM.pxPerCmAtNative;
      setFrameStyle({ width: outerW * pxPerCm, height: outerH * pxPerCm });
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [size, photo]);

  const sizeDef = sizeById(size);
  const colourDef = colourById(colour);
  const price = priceFor(size, mounted);
  const sku = skuFor(size, mounted);

  const pxPerCmForBand = frameStyle ? frameStyle.width / (orientOf(photo) === "landscape" ? sizeDef.outer[1] : sizeDef.outer[0]) : 0;
  const bandCm = mounted ? MOULDING_CM : UNMOUNTED_BAND_CM;
  const matCm = mounted ? Math.max(0, sizeDef.mat - MOULDING_CM) : 0;

  const pairPhotos = useMemo(() => {
    const others = otherShopPhotos.filter((p) => p.id !== photo.id);
    // Deterministic-ish shuffle keyed on photo id so it doesn't reshuffle on
    // every render, but still varies per product.
    const seed = photo.id.charCodeAt(0) || 1;
    return [...others].sort((a, b) => ((a.id.charCodeAt(0) * seed) % 97) - ((b.id.charCodeAt(0) * seed) % 97)).slice(0, 4);
  }, [otherShopPhotos, photo.id]);

  const switcherPhotos = useMemo(() => otherShopPhotos.filter((p) => p.id !== photo.id).slice(0, 4), [otherShopPhotos, photo.id]);

  function goToPhoto(p: Photo) {
    window.history.pushState({}, "", `/shop/${p.slug}`);
    onNavigate(`/shop/${p.slug}`);
    window.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior });
  }

  function addToCart() {
    cart.add(makeCartItem(photo, thumb(photo, 200), size, mounted, colour));
    setJustAdded(true);
    setPulseCart(false);
    requestAnimationFrame(() => setPulseCart(true));
    setTimeout(() => setJustAdded(false), 900);
  }

  function applyPromo() {
    const val = promoInput.trim().toUpperCase();
    if (PROMO_CODES[val]) {
      setPromo({ code: val, pct: PROMO_CODES[val] });
      setPromoError(false);
    } else {
      setPromo(null);
      setPromoError(Boolean(val));
    }
  }

  const discount = promo ? cart.subtotal * promo.pct : 0;
  const total = cart.subtotal - discount + cart.shipping;

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
          <div className="pc-room-wrap" ref={roomWrapRef}>
            <img className="pc-room-img" src={ROOM.src} alt="A framed print hung on a bright, minimal wall" />
            {frameStyle ? (
              <div
                className="pc-frame"
                style={{
                  width: frameStyle.width,
                  height: frameStyle.height,
                  left: `${ROOM.centerX * 100}%`,
                  top: `${ROOM.centerY * 100}%`,
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
          <div className="pc-scroll-hint">Configure ↓</div>
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
              {SIZES.map((s) => (
                <button key={s.id} className={`pc-size-btn${s.id === size ? " on" : ""}`} type="button" onClick={() => setSize(s.id)}>
                  <b>{s.id}</b>
                  <span>{s.outer[0].toFixed(0)}×{s.outer[1].toFixed(0)}cm</span>
                </button>
              ))}
            </div>
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
        <section className="pc-pairs">
          <h3>Pairs well with</h3>
          <p className="pc-pairs-callout">Pick one to configure — adding it to the same order usually costs about $5 in shipping, not $15.</p>
          <div className="pc-pairs-grid">
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
          <div className="pc-promo">
            <input type="text" placeholder="Discount code" value={promoInput} onChange={(e) => setPromoInput(e.target.value)} autoComplete="off" />
            <button type="button" onClick={applyPromo}>Apply</button>
          </div>
          {promo ? <p className="pc-promo-msg ok">{promo.code} applied — {Math.round(promo.pct * 100)}% off</p> : null}
          {promoError ? <p className="pc-promo-msg err">That code isn't valid.</p> : null}
          {cart.items.length ? (
            <div className="pc-cart-lines">
              <div className="row"><span>Subtotal</span><span>{money(cart.subtotal)}</span></div>
              {promo ? <div className="row discount"><span>{promo.code}</span><span>−{money(discount)}</span></div> : null}
              <div className="row"><span>Shipping (AU)</span><span>{money(cart.shipping)}</span></div>
              <div className="row total"><span>Total</span><span>{money(total)}</span></div>
            </div>
          ) : null}
          <p className="pc-au-note">Shipping within Australia only. Exact cost is confirmed at checkout.</p>
          <button className="pc-checkout-btn" type="button" onClick={() => cart.items.length && alert("This is a demo — Stripe checkout isn't wired up yet.")}>Checkout</button>
          <p className="pc-checkout-note">Demo cart — real checkout isn't wired up yet.</p>
        </div>
      </div>
    </main>
  );
}
