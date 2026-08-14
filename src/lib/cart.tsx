// Shop cart — a real cart, not the placeholder counter in ShopProduct. Backed
// by localStorage so it survives navigating between /shop and a product page
// (separate route matches in App(), so separate component trees) and a page
// refresh. Demo only: no checkout wired up yet, this just gets the shape right.
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { ColourId, SizeId } from "./printCatalogue";
import { estimateShipping, priceFor } from "./printCatalogue";

export type CartItem = {
  photoId: string;
  title: string;
  location: string;
  thumb: string;
  size: SizeId;
  mounted: boolean;
  colour: ColourId;
  price: number;
};

const STORAGE_KEY = "sd_print_cart_v1";

function readStored(): CartItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CartItem[]) : [];
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
  const [items, setItems] = useState<CartItem[]>(readStored);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      // Storage can fail (private browsing, quota) — the cart just won't
      // survive a refresh, which is a fine degradation for a demo cart.
    }
  }, [items]);

  const value = useMemo<CartContextValue>(() => {
    const subtotal = items.reduce((sum, it) => sum + it.price, 0);
    const shipping = estimateShipping(items.map((it) => it.size));
    return {
      items,
      add: (item) => setItems((prev) => [...prev, item]),
      remove: (index) => setItems((prev) => prev.filter((_, i) => i !== index)),
      clear: () => setItems([]),
      subtotal,
      shipping,
    };
  }, [items]);

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
): CartItem {
  return {
    photoId: photo.id,
    title: photo.title,
    location: photo.location,
    thumb,
    size,
    mounted,
    colour,
    price: priceFor(size, mounted),
  };
}
