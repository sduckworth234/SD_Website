// Shop cart — a real cart, not the placeholder counter in ShopProduct. Backed
// by localStorage so it survives navigating between /shop and a product page
// (separate route matches in App(), so separate component trees) and a page
// refresh. Stripe checkout revalidates every item and price on the server.
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { ColourId, GlazingId, PaperId, SizeId } from "./printCatalogue";
import { estimateShipping, priceCentsFor } from "./printCatalogue";
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

/** Items stored before paper and "print only" existed are missing those
 * fields — fill them with what they implicitly were rather than dropping the
 * cart. Price is recomputed on every render anyway (see CartProvider). */
function normaliseStored(item: CartItem): CartItem {
  return { ...item, paper: item.paper ?? "archival_matte", framed: item.framed ?? true };
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
    const items = stored.map((it) => ({
      ...it,
      price: priceCentsFor({ size: it.size, mounted: it.mounted, colour: it.colour, glazing: it.glazing, paper: it.paper, framed: it.framed }) / 100,
    }));
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
  paper: PaperId = "archival_matte",
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
