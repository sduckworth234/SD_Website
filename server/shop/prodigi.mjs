import { estimateShippingCents } from "./catalogue.mjs";

const API_KEY = process.env.PRODIGI_API_KEY;
const API_BASE = (process.env.PRODIGI_API_BASE_URL ?? "https://api.sandbox.prodigi.com/v4.0").replace(/\/$/, "");

async function prodigi(path, init = {}) {
  if (!API_KEY) throw new Error("PRODIGI_API_KEY is not configured.");
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "X-API-Key": API_KEY, "content-type": "application/json", ...(init.headers ?? {}) },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`Prodigi ${init.method ?? "GET"} failed (${response.status}): ${text.slice(0, 400)}`);
  return data;
}

export async function quoteShippingCents(items, { useProdigi = false } = {}) {
  if (!useProdigi || !API_KEY) return { cents: estimateShippingCents(items), source: "verified-catalogue-estimate" };
  const data = await prodigi("/quotes", {
    method: "POST",
    body: JSON.stringify({
      shippingMethod: "Standard",
      destinationCountryCode: "AU",
      currencyCode: "AUD",
      items: items.map((item) => ({
        sku: item.sku,
        copies: 1,
        attributes: { color: item.colour },
        assets: [{ printArea: "default" }],
      })),
    }),
  });
  const quote = (data?.quotes ?? []).find((row) => row.shipmentMethod?.toLowerCase() === "standard") ?? data?.quotes?.[0];
  if (!quote || quote.costSummary?.shipping?.currency !== "AUD") throw new Error("Prodigi did not return an AUD Standard shipping quote.");
  return { cents: Math.round(Number(quote.costSummary.shipping.amount) * 100), source: "prodigi-live-quote" };
}

// Live per-SKU cost + shipping, for the admin Pricing tab's "refresh live
// Prodigi prices" button. Reuses the same /quotes endpoint quoteShippingCents
// uses — its costSummary carries item cost as well as shipping, just never
// read before now. One /quotes call per SKU (Prodigi doesn't offer a
// cheaper multi-SKU cost lookup); called on demand, not on page load.
export async function quoteSkuCostCents(sku, colour = "natural") {
  if (!API_KEY) throw new Error("PRODIGI_API_KEY is not configured.");
  const data = await prodigi("/quotes", {
    method: "POST",
    body: JSON.stringify({
      shippingMethod: "Standard",
      destinationCountryCode: "AU",
      currencyCode: "AUD",
      items: [{ sku, copies: 1, attributes: { color: colour }, assets: [{ printArea: "default" }] }],
    }),
  });
  const quote = (data?.quotes ?? []).find((row) => row.shipmentMethod?.toLowerCase() === "standard") ?? data?.quotes?.[0];
  const items = quote?.costSummary?.items;
  const shipping = quote?.costSummary?.shipping;
  if (!quote || items?.currency !== "AUD" || shipping?.currency !== "AUD") {
    throw new Error(`Prodigi did not return a full AUD quote for ${sku}.`);
  }
  return {
    itemCents: Math.round(Number(items.amount) * 100),
    shippingCents: Math.round(Number(shipping.amount) * 100),
  };
}

export async function createProdigiOrder(payload) {
  return prodigi("/orders", { method: "POST", body: JSON.stringify(payload) });
}

export async function fetchProdigiOrder(id) {
  return prodigi(`/orders/${encodeURIComponent(id)}`);
}

export function prodigiConfigured() {
  return Boolean(API_KEY);
}
