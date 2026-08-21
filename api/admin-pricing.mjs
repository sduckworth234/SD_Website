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

async function fetchFrameshopPricing() {
  const [components, colours, glazing, marginRows] = await Promise.all([
    supabaseRest("print_pricing_components?select=*&order=size.asc"),
    supabaseRest("print_pricing_colours?select=*&order=id.asc"),
    supabaseRest("print_pricing_glazing?select=*&order=id.asc"),
    supabaseRest("site_settings?select=value&key=eq.print_margin_percent"),
  ]);
  return {
    components: components ?? [],
    colours: colours ?? [],
    glazing: glazing ?? [],
    marginPercent: marginRows?.[0]?.value != null ? Number(marginRows[0].value) : 15,
  };
}

async function saveFrameshopComponents(body) {
  const updates = Array.isArray(body.components) ? body.components : [];
  if (!updates.length) throw new Error("No components to save.");
  for (const row of updates) {
    const size = typeof row?.size === "string" ? row.size.toUpperCase() : "";
    const frameUnmountedCents = Number(row?.frameCostUnmountedCents);
    const frameMountedCents = Number(row?.frameCostMountedCents);
    const matCents = Number(row?.matCostCents);
    const glassUnmountedCents = Number(row?.glassCostUnmountedCents);
    const glassMountedCents = Number(row?.glassCostMountedCents);
    if (!SIZES.includes(size)) throw new Error("Invalid size.");
    const values = [frameUnmountedCents, frameMountedCents, matCents, glassUnmountedCents, glassMountedCents];
    if (!values.every((n) => Number.isInteger(n) && n >= 0 && n <= 10_000_00)) {
      throw new Error(`Invalid component cost for ${size}.`);
    }
    await supabaseRest(`print_pricing_components?size=eq.${size}`, {
      method: "PATCH",
      body: JSON.stringify({
        frame_cost_unmounted_cents: frameUnmountedCents,
        frame_cost_mounted_cents: frameMountedCents,
        mat_cost_cents: matCents,
        glass_cost_unmounted_cents: glassUnmountedCents,
        glass_cost_mounted_cents: glassMountedCents,
        updated_at: new Date().toISOString(),
      }),
    });
  }
  return { saved: updates.length, ...(await fetchFrameshopPricing()) };
}

async function saveFrameshopMultipliers(body) {
  const colourUpdates = Array.isArray(body.colours) ? body.colours : [];
  const glazingUpdates = Array.isArray(body.glazing) ? body.glazing : [];
  for (const row of colourUpdates) {
    const id = typeof row?.id === "string" ? row.id : "";
    const mult = Number(row?.costMultiplier);
    if (!id || !Number.isFinite(mult) || mult <= 0 || mult > 20) throw new Error(`Invalid colour multiplier for ${id || "(unknown)"}.`);
    await supabaseRest(`print_pricing_colours?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ cost_multiplier: mult, updated_at: new Date().toISOString() }),
    });
  }
  for (const row of glazingUpdates) {
    const id = typeof row?.id === "string" ? row.id : "";
    const mult = Number(row?.costMultiplier);
    // Glazing allows 0 — "No Glass" is a real, zero-cost option.
    if (!id || !Number.isFinite(mult) || mult < 0 || mult > 20) throw new Error(`Invalid glazing multiplier for ${id || "(unknown)"}.`);
    await supabaseRest(`print_pricing_glazing?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ cost_multiplier: mult, updated_at: new Date().toISOString() }),
    });
  }
  if (!colourUpdates.length && !glazingUpdates.length) throw new Error("No multipliers to save.");
  return { saved: colourUpdates.length + glazingUpdates.length, ...(await fetchFrameshopPricing()) };
}

async function saveFrameshopMargin(body) {
  const marginPercent = Number(body.marginPercent);
  if (!Number.isFinite(marginPercent) || marginPercent < 0 || marginPercent > 500) throw new Error("Invalid margin percent.");
  await supabaseRest("site_settings?on_conflict=key", {
    method: "POST",
    headers: { prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ key: "print_margin_percent", enabled: true, value: String(marginPercent), label: "Shop — print margin %" }),
  });
  return { saved: 1, ...(await fetchFrameshopPricing()) };
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
      return json(res, 200, { rows: await fetchAllRows(), prodigiConfigured: prodigiConfigured(), frameshop: await fetchFrameshopPricing() });
    }

    const body = await readJson(req);
    if (body.action === "save_prices") return json(res, 200, await savePrices(body));
    if (body.action === "refresh_costs") return json(res, 200, await refreshCosts());
    if (body.action === "save_frameshop_components") return json(res, 200, await saveFrameshopComponents(body));
    if (body.action === "save_frameshop_multipliers") return json(res, 200, await saveFrameshopMultipliers(body));
    if (body.action === "save_frameshop_margin") return json(res, 200, await saveFrameshopMargin(body));
    json(res, 400, { error: "Unknown pricing action." });
  } catch (error) {
    const message = safeError(error);
    console.error("admin pricing:", message);
    json(res, 500, { error: message });
  }
}
