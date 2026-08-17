import { sendFulfilmentAlert, sendShippingNotice } from "../server/shop/email.mjs";
import { json, methodAllowed, publicOrigin, safeError } from "../server/shop/http.mjs";
import { createProdigiOrder, fetchProdigiOrder, prodigiConfigured } from "../server/shop/prodigi.mjs";
import { shopRuntimeConfig, signedMasterUrl, supabaseRest, updateOrder } from "../server/shop/supabase.mjs";

function cronAuthorised(req) {
  if (!process.env.CRON_SECRET) return process.env.NODE_ENV !== "production";
  return req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
}

async function claimOrder(order) {
  const statuses = "paid,queued,failed";
  const rows = await supabaseRest(`orders?id=eq.${encodeURIComponent(order.id)}&fulfilment_provider=eq.prodigi&status=in.(${statuses})`, {
    method: "PATCH",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({ status: "submitting", last_fulfilment_error: null }),
  });
  return rows?.[0] ?? null;
}

async function submitOne(order, req) {
  const missing = (order.order_items ?? []).filter((item) => !item.print_master_path);
  if (missing.length) {
    await updateOrder(order.id, { status: "awaiting_master", last_fulfilment_error: `${missing.length} print master${missing.length === 1 ? " is" : "s are"} missing.` });
    return { id: order.id, result: "awaiting_master" };
  }
  const claimed = await claimOrder(order);
  if (!claimed) return { id: order.id, result: "already_claimed" };
  try {
    const items = await Promise.all(order.order_items.map(async (item) => {
      if (!/\.jpe?g$/i.test(item.print_master_path)) throw new Error(`${item.title}: print master must be a JPEG.`);
      return {
        merchantReference: item.id,
        sku: item.sku,
        copies: 1,
        sizing: "fillPrintArea",
        attributes: { color: item.colour },
        assets: [{ printArea: "default", url: await signedMasterUrl(item.print_master_path, 6 * 3600) }],
      };
    }));
    const callbackSecret = process.env.PRODIGI_CALLBACK_SECRET;
    const callbackUrl = callbackSecret
      ? `${publicOrigin(req)}/api/prodigi-callback?token=${encodeURIComponent(callbackSecret)}`
      : undefined;
    const data = await createProdigiOrder({
      merchantReference: `SD-${order.id.slice(0, 8).toUpperCase()}`,
      shippingMethod: "Standard",
      idempotencyKey: order.id,
      callbackUrl,
      recipient: {
        name: order.customer_name,
        email: order.customer_email,
        phoneNumber: order.shipping_address?.phone || undefined,
        address: {
          line1: order.shipping_address.line1,
          line2: order.shipping_address.line2 || undefined,
          townOrCity: order.shipping_address.suburb,
          stateOrCounty: order.shipping_address.state,
          postalOrZipCode: order.shipping_address.postcode,
          countryCode: "AU",
        },
      },
      items,
      metadata: { shopOrderId: order.id, stripeSessionId: order.stripe_checkout_session_id },
    });
    const prodigiOrder = data?.order ?? data;
    if (!prodigiOrder?.id) throw new Error("Prodigi returned no order id.");
    await updateOrder(order.id, {
      status: "submitted",
      prodigi_order_id: prodigiOrder.id,
      prodigi_stage: prodigiOrder.status?.stage ?? "Submitted",
      prodigi_status: prodigiOrder.status ?? null,
      submitted_at: new Date().toISOString(),
      last_fulfilment_error: null,
    });
    return { id: order.id, result: "submitted", prodigiOrderId: prodigiOrder.id };
  } catch (error) {
    const message = safeError(error);
    await updateOrder(order.id, { status: "failed", last_fulfilment_error: message });
    await sendFulfilmentAlert(`Order ${order.id.slice(0, 8)} could not be submitted`, message).catch(() => {});
    return { id: order.id, result: "failed", error: message };
  }
}

async function monitorSubmitted() {
  const threshold = new Date(Date.now() - 10 * 60_000).toISOString();
  const rows = await supabaseRest(
    `orders?fulfilment_provider=eq.prodigi&status=in.(submitted,in_production)&submitted_at=lt.${encodeURIComponent(threshold)}&select=*&limit=25`,
  );
  const results = [];
  for (const row of rows ?? []) {
    if (!row.prodigi_order_id) continue;
    try {
      const data = await fetchProdigiOrder(row.prodigi_order_id);
      const prodigiOrder = data?.order ?? data;
      const status = prodigiOrder?.status ?? {};
      const stage = status.stage ?? "Submitted";
      const download = status.details?.downloadAssets;
      const shipment = (prodigiOrder?.shipments ?? []).find((entry) => entry.tracking?.url || entry.tracking?.number)
        ?? prodigiOrder?.shipments?.[0];
      const shipped = (prodigiOrder?.shipments ?? []).length > 0 || /complete|shipped/i.test(stage);
      const patch = {
        prodigi_stage: stage,
        prodigi_status: status,
        status: shipped ? "shipped" : /progress|production/i.test(stage) ? "in_production" : "submitted",
        tracking_number: shipment?.tracking?.number ?? null,
        tracking_url: shipment?.tracking?.url ?? null,
        shipped_at: shipped ? (row.shipped_at ?? new Date().toISOString()) : row.shipped_at,
      };
      if (download === "InProgress" && !row.last_fulfilment_error) {
        patch.last_fulfilment_error = "Prodigi has not completed downloadAssets within 10 minutes.";
        await sendFulfilmentAlert(`Prodigi asset download stalled for ${row.id.slice(0, 8)}`, patch.last_fulfilment_error).catch(() => {});
      }
      const updated = await updateOrder(row.id, patch);
      if (shipped && row.status !== "shipped") {
        await sendShippingNotice(updated).catch((error) => console.error("shipping email:", safeError(error)));
      }
      results.push({ id: row.id, stage, download });
    } catch (error) {
      results.push({ id: row.id, error: safeError(error) });
    }
  }
  return results;
}

export default async function handler(req, res) {
  if (!methodAllowed(req, res, ["GET", "POST"])) return;
  if (!cronAuthorised(req)) return json(res, 401, { error: "unauthorized" });
  const runtime = await shopRuntimeConfig();
  if (runtime.fulfilmentProvider !== "prodigi") {
    // A scheduled call in manual mode is healthy and intentionally does no
    // work. Returning 200 keeps the Cron history useful instead of noisy.
    return json(res, 200, { skipped: true, provider: "manual", submitted: [], monitored: [] });
  }
  if (!prodigiConfigured()) return json(res, 503, { error: "PRODIGI_API_KEY is not configured." });
  try {
    const now = new Date().toISOString();
    const orders = await supabaseRest(
      `orders?fulfilment_provider=eq.prodigi&status=in.(paid,queued,failed,awaiting_master)&submit_after=lte.${encodeURIComponent(now)}&select=*,order_items(*)&order=created_at.asc&limit=10`,
    );
    const submitted = [];
    for (const order of orders ?? []) submitted.push(await submitOne(order, req));
    const monitored = await monitorSubmitted();
    json(res, 200, { submitted, monitored });
  } catch (error) {
    console.error("submit orders:", safeError(error));
    json(res, 500, { error: "fulfilment_run_failed" });
  }
}
