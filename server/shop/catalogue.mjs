// Single server-side source of truth for every amount charged at checkout.
// The browser's CartItem.price is display-only and is never accepted here.

export const PRINT_SIZES = Object.freeze({
  A5: { cfpCents: 5110, cfpmCents: 5710 },
  A4: { cfpCents: 5710, cfpmCents: 5710 },
  A3: { cfpCents: 7510, cfpmCents: 7710 },
  A2: { cfpCents: 9510, cfpmCents: 11010 },
  A1: { cfpCents: 13655, cfpmCents: 16155 },
});

export const COLOURS = new Set(["natural", "black", "white"]);
export const MAX_CART_ITEMS = 20;

export function skuFor(size, mounted) {
  return `GLOBAL-${mounted ? "CFPM" : "CFP"}-${size}`;
}

export function priceCentsFor(size, mounted) {
  const row = PRINT_SIZES[size];
  if (!row) throw new Error(`Unsupported print size: ${size}`);
  return mounted ? row.cfpmCents : row.cfpCents;
}

export function estimateShippingCents(items) {
  if (!items.length) return 0;
  const sorted = [...items].sort((a, b) => (b.size === "A1" ? 1 : 0) - (a.size === "A1" ? 1 : 0));
  let total = sorted[0].size === "A1" ? 2155 : 1510;
  let a1Count = sorted[0].size === "A1" ? 1 : 0;
  for (const item of sorted.slice(1)) {
    if (item.size === "A1") {
      total += a1Count >= 1 ? 1000 : 500;
      a1Count += 1;
    } else {
      total += 500;
    }
  }
  return total;
}

export function normaliseCart(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > MAX_CART_ITEMS) {
    throw new Error(`Cart must contain between 1 and ${MAX_CART_ITEMS} prints.`);
  }
  return input.map((raw) => {
    const photoId = typeof raw?.photoId === "string" ? raw.photoId.trim() : "";
    const size = typeof raw?.size === "string" ? raw.size.toUpperCase() : "";
    const mounted = raw?.mounted === true;
    const colour = typeof raw?.colour === "string" ? raw.colour.toLowerCase() : "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(photoId)) {
      throw new Error("Cart contains an invalid photo id.");
    }
    if (!PRINT_SIZES[size]) throw new Error("Cart contains an unsupported size.");
    if (!COLOURS.has(colour)) throw new Error("Cart contains an unsupported frame colour.");
    return {
      photoId,
      size,
      mounted,
      colour,
      sku: skuFor(size, mounted),
      unitPriceCents: priceCentsFor(size, mounted),
    };
  });
}
