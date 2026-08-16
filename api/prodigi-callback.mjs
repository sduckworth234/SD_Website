import { sendShippingNotice } from "../server/shop/email.mjs";
import { json, methodAllowed, readJson, safeError } from "../server/shop/http.mjs";
import { fetchProdigiOrder } from "../server/shop/prodigi.mjs";
import { supabaseRest, updateOrder } from "../server/shop/supabase.mjs";

function shipmentData(order) {
  const shipments = order?.shipments ?? [];
  const tracked = shipments.find((shipment) => shipment.tracking?.url || shipment.tracking?.number) ?? shipments[0];
  return {
    tracking_number: tracked?.tracking?.number ?? null,
    tracking_url: tracked?.tracking?.url ?? null,
  };
}

function localStatus(stage, order) {
  if ((order?.shipments ?? []).length || /complete|shipped/i.test(stage)) return "shipped";
  if (/cancel/i.test(stage)) return "cancelled";
  if (/error|issue|failed/i.test(stage)) return "failed";
  if (/progress|production/i.test(stage)) return "in_production";
  return "submitted";
}

export default async function handler(req, res) {
  if (!methodAllowed(req, res, ["POST"])) return;
  const token = typeof req.query?.token === "string" ? req.query.token : "";
  if (!process.env.PRODIGI_CALLBACK_SECRET || token !== process.env.PRODIGI_CALLBACK_SECRET) {
    return json(res, 401, { error: "unauthorized" });
  }
  try {
    const event = await readJson(req);
    const prodigiId = event.subject ?? event.data?.order?.id ?? event.data?.id;
    if (!prodigiId || !/^ord_/.test(prodigiId)) return json(res, 400, { error: "invalid_event" });

    // Prodigi callbacks have no documented signature. The callback URL carries
    // a secret, then we fetch the authoritative order from Prodigi rather than
    // trusting any status/tracking fields in the inbound payload.
    const authoritative = await fetchProdigiOrder(prodigiId);
    const prodigiOrder = authoritative?.order ?? authoritative;
    const rows = await supabaseRest(`orders?prodigi_order_id=eq.${encodeURIComponent(prodigiId)}&select=*&limit=1`);
    const current = rows?.[0];
    if (!current) return json(res, 202, { received: true, matched: false });
    const stage = prodigiOrder.status?.stage ?? "Submitted";
    const nextStatus = localStatus(stage, prodigiOrder);
    const tracking = shipmentData(prodigiOrder);
    const updated = await updateOrder(current.id, {
      status: nextStatus,
      prodigi_stage: stage,
      prodigi_status: prodigiOrder.status ?? null,
      ...tracking,
      shipped_at: nextStatus === "shipped" ? (current.shipped_at ?? new Date().toISOString()) : current.shipped_at,
      last_fulfilment_error: prodigiOrder.status?.issues?.length ? JSON.stringify(prodigiOrder.status.issues).slice(0, 1000) : null,
    });
    if (nextStatus === "shipped" && current.status !== "shipped") {
      sendShippingNotice(updated).catch((error) => console.error("shipping email:", safeError(error)));
    }
    json(res, 200, { received: true, matched: true });
  } catch (error) {
    console.error("prodigi callback:", safeError(error));
    json(res, 500, { error: "callback_failed" });
  }
}
