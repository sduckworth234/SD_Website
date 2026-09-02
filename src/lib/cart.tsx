// Shop cart — a real cart, not the placeholder counter in ShopProduct. Backed
// by localStorage so it survives navigating between /shop and a product page
// (separate route matches in App(), so separate component trees) and a page
// refresh. Stripe checkout revalidates every item and price on the server.
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { ColourId, GlazingId, PaperId, SizeId } from "./printCatalogue";
import { COLOURS, GLAZING, PAPERS, SIZES, estimateShipping, priceCentsFor } from "./printCatalogue";
import { usePricingVersion } from "./usePricing";

export type CartItem = {
  photoId: string;
  title: string;
  location: string;
  thumb: string;
  size: SizeId;
  mounted: boolean;
  colour: ColourId;
  glazing: GlazingId;
  paper: PaperId;
  /** false = the unframed "print only" product (rolled in a tube). */
  framed: boolean;
  price: number;
};

const STORAGE_KEY = "sd_print_cart_v1";

const VALID_SIZES = new Set(SIZES.map((s) => s.id));
const VALID_COLOURS = new Set(COLOURS.map((c) => c.id));
const VALID_GLAZING = new Set(GLAZING.map((g) => g.id));
const VALID_PAPERS = new Set(PAPERS.map((p) => p.id));

/** Items stored before paper and "print only" existed are missing those
 * fields — fill them with what they implicitly were rather than dropping the
 * cart. Also guards against a value that ISN'T missing but no longer exists —
 * a size/colour/glazing/paper id retired in an admin change or a site update
 * (the paper stock was renamed once already: an old cart holding "archival_matte"
 * survived the rename in localStorage and crashed on the very next hydration,
 * since priceCentsFor has no such id to price). Any stored value outside the
 * CURRENT valid set is coerced to the default rather than trusted, so a future
 * rename of any of these can't repeat that crash. Price is recomputed on every
 * render anyway (see CartProvider). */
function normaliseStored(item: CartItem): CartItem {
  return {
    ...item,
    size: VALID_SIZES.has(item.size) ? item.size : "A3",
    colour: VALID_COLOURS.has(item.colour) ? item.colour : "natural",
    glazing: VALID_GLAZING.has(item.glazing) ? item.glazing : "clear",
    paper: VALID_PAPERS.has(item.paper) ? item.paper : "semi_gloss",
    framed: item.framed ?? true,
  };
}

function readStored(): CartItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CartItem[]).map(normaliseStored) : [];
  } catch {
    return [];
  }
}

type CartContextValue = {
  items: CartItem[];
  add: (item: CartItem) => void;
  remove: (index: number) => void;
  clear: () => void;
  subtotal: number;
  shipping: number;
};

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [stored, setItems] = useState<CartItem[]>(readStored);
  // Re-price when live pricing lands, or after an admin price edit — a price
  // captured at add-to-cart time can be minutes or days stale, and checkout
  // now rejects a cart whose quoted price doesn't match the server's.
  const pricingVersion = usePricingVersion();

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    } catch {
      // Storage can fail (private browsing, quota) — the cart just won't
      // survive a refresh; the server still validates every submitted item.
    }
  }, [stored]);

  const value = useMemo<CartContextValue>(() => {
    // Belt and braces alongside normaliseStored: even a validated item can in
    // principle fail to price (a component genuinely missing from a pricing
    // table read). One bad item must never crash the whole cart — drop it
    // from the priced total rather than throwing, and log it so it's not a
    // silent zero either.
    const items = stored.flatMap((it) => {
      try {
        return [{
          ...it,
          price: priceCentsFor({ size: it.size, mounted: it.mounted, colour: it.colour, glazing: it.glazing, paper: it.paper, framed: it.framed }) / 100,
        }];
      } catch (error) {
        console.error("cart: dropping an item that failed to price", it, error);
        return [];
      }
    });
    const subtotal = items.reduce((sum, it) => sum + it.price, 0);
    const shipping = estimateShipping(items.map((it) => ({ size: it.size, framed: it.framed })));
    return {
      items,
      add: (item) => setItems((prev) => [...prev, item]),
      remove: (index) => setItems((prev) => prev.filter((_, i) => i !== index)),
      clear: () => setItems([]),
      subtotal,
      shipping,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored, pricingVersion]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within a CartProvider");
  return ctx;
}

// Convenience for building a CartItem from the configurator's current state.
export function makeCartItem(
  photo: { id: string; title: string; location: string },
  thumb: string,
  size: SizeId,
  mounted: boolean,
  colour: ColourId,
  glazing: GlazingId,
  paper: PaperId = "semi_gloss",
  framed = true,
): CartItem {
  return {
    photoId: photo.id,
    title: photo.title,
    location: photo.location,
    thumb,
    size,
    mounted: framed && mounted,
    colour,
    glazing,
    paper,
    framed,
    price: priceCentsFor({ size, mounted, colour, glazing, paper, framed }) / 100,
  };
}
