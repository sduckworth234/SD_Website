// Admin-only print pricing: view/edit sell prices, and pull live Prodigi
// cost + shipping per SKU on demand. See supabase/migrations/
// 20260817010000_print_pricing.sql for the table this reads/writes — the
// single source of truth server/shop/catalogue.mjs's fetchPricing() also
// reads for real checkout amounts.
import { json, methodAllowed, readJson, safeError } from "../server/shop/http.mjs";
import { quoteSkuCostCents, prodigiConfigured } from "../server/shop/prodigi.mjs";
import { requireAdmin, supabaseRest } from "../server/shop/supabase.mjs";

const SIZES = ["A5", "A4", "A3", "A2", "A1"];

function skuFor(size, mounted) {
  return `GLOBAL-${mounted ? "CFPM" : "CFP"}-${size}`;
}

async function fetchAllRows() {
  const rows = await supabaseRest("print_pricing?select=*&order=size.asc,mounted.asc");
  return rows ?? [];
}

async function savePrices(body) {
  const updates = Array.isArray(body.prices) ? body.prices : [];
  if (!updates.length) throw new Error("No prices to save.");
  for (const row of updates) {
    const size = typeof row?.size === "string" ? row.size.toUpperCase() : "";
    const mounted = row?.mounted === true || row?.mounted === false ? row.mounted : null;
    const sellCents = Number(row?.sellCents);
    if (!SIZES.includes(size) || mounted === null) throw new Error("Invalid pricing row.");
    if (!Number.isInteger(sellCents) || sellCents < 0 || sellCents > 10_000_00) throw new Error(`Invalid price for ${size}${mounted ? " mounted" : ""}.`);
    await supabaseRest(`print_pricing?size=eq.${size}&mounted=eq.${mounted}`, {
      method: "PATCH",
      body: JSON.stringify({ sell_cents: sellCents, updated_at: new Date().toISOString() }),
    });
  }
  return { saved: updates.length, rows: await fetchAllRows() };
}

async function refreshCosts() {
  if (!prodigiConfigured()) throw new Error("PRODIGI_API_KEY is not configured — live costs are unavailable.");
  const checkedAt = new Date().toISOString();
  const errors = [];
  for (const size of SIZES) {
    for (const mounted of [false, true]) {
      const sku = skuFor(size, mounted);
      try {
        const { itemCents, shippingCents } = await quoteSkuCostCents(sku, "natural");
        await supabaseRest(`print_pricing?size=eq.${size}&mounted=eq.${mounted}`, {
          method: "PATCH",
          body: JSON.stringify({
            cost_cents: itemCents,
            shipping_cents: shippingCents,
            cost_source: "prodigi-live-quote",
            cost_checked_at: checkedAt,
          }),
        });
      } catch (error) {
        errors.push(`${sku}: ${safeError(error)}`);
      }
    }
  }
  return { refreshed: SIZES.length * 2 - errors.length, errors, rows: await fetchAllRows() };
}

export default async function handler(req, res) {
  if (!methodAllowed(req, res, ["GET", "POST"])) return;
  try {
    const admin = await requireAdmin(req);
    if (!admin) return json(res, 401, { error: "unauthorized" });

    if (req.method === "GET") {
      return json(res, 200, { rows: await fetchAllRows(), prodigiConfigured: prodigiConfigured() });
    }

    const body = await readJson(req);
    if (body.action === "save_prices") return json(res, 200, await savePrices(body));
    if (body.action === "refresh_costs") return json(res, 200, await refreshCosts());
    json(res, 400, { error: "Unknown pricing action." });
  } catch (error) {
    const message = safeError(error);
    console.error("admin pricing:", message);
    json(res, 500, { error: message });
  }
}
