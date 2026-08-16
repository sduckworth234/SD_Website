import Stripe from "stripe";
import { checkoutEnabled, fulfilmentEnabled } from "../server/shop/features.mjs";
import { json, methodAllowed, readJson, safeError } from "../server/shop/http.mjs";
import { requireAdmin, signedMasterUrl, supabaseRest, updateOrder } from "../server/shop/supabase.mjs";

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

async function attachMaster(body) {
  const photoId = typeof body.photoId === "string" ? body.photoId : "";
  const path = typeof body.path === "string" ? body.path : "";
  const width = Number(body.width);
  const height = Number(body.height);
  if (!path.startsWith(`${photoId}/`) || !/\.jpe?g$/i.test(path) || !Number.isInteger(width) || !Number.isInteger(height)) {
    throw new Error("Invalid print-master attachment.");
  }
  const signed = await signedMasterUrl(path, 60);
  const file = await fetch(signed, { method: "HEAD" });
  if (!file.ok || !(file.headers.get("content-type") ?? "").toLowerCase().includes("image/jpeg")) {
    throw new Error("Uploaded print master is not a readable JPEG.");
  }
  const changed = await supabaseRest(`order_items?photo_id=eq.${encodeURIComponent(photoId)}`, {
    method: "PATCH",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({ print_master_path: path, print_master_width: width, print_master_height: height }),
  });
  const orderIds = [...new Set((changed ?? []).map((item) => item.order_id))];
  for (const orderId of orderIds) {
    const missing = await supabaseRest(`order_items?order_id=eq.${encodeURIComponent(orderId)}&print_master_path=is.null&select=id&limit=1`);
    if (!missing?.length) {
      await supabaseRest(`orders?id=eq.${encodeURIComponent(orderId)}&status=eq.awaiting_master`, {
        method: "PATCH",
        body: JSON.stringify({ status: "paid", last_fulfilment_error: null }),
      });
    }
  }
  return { attached: changed?.length ?? 0 };
}

export default async function handler(req, res) {
  if (!methodAllowed(req, res, ["GET", "POST"])) return;
  try {
    const admin = await requireAdmin(req);
    if (!admin) return json(res, 401, { error: "unauthorized" });
    if (req.method === "GET") {
      const search = typeof req.query?.q === "string"
        ? req.query.q.trim().replace(/[^a-zA-Z0-9@._+\- ]/g, "").slice(0, 100)
        : "";
      const filter = search ? `&or=(customer_email.ilike.*${encodeURIComponent(search)}*,customer_name.ilike.*${encodeURIComponent(search)}*)` : "";
      const rows = await supabaseRest(`orders?select=*,order_items(*)&order=created_at.desc&limit=100${filter}`);
      return json(res, 200, {
        orders: rows ?? [],
        features: { checkoutEnabled: checkoutEnabled(), fulfilmentEnabled: fulfilmentEnabled() },
      });
    }
    const body = await readJson(req);
    if (body.action === "attach_master") return json(res, 200, await attachMaster(body));
    const orderId = typeof body.orderId === "string" ? body.orderId : "";
    const rows = await supabaseRest(`orders?id=eq.${encodeURIComponent(orderId)}&select=*&limit=1`);
    const order = rows?.[0];
    if (!order) return json(res, 404, { error: "Order not found." });
    if (body.action === "submit_now") {
      if (!fulfilmentEnabled()) {
        return json(res, 409, { error: "Prodigi fulfilment is disabled in this environment." });
      }
      if (["submitted", "in_production", "shipped", "cancelled", "refunded"].includes(order.status)) {
        return json(res, 409, { error: `Order cannot be queued from ${order.status}.` });
      }
      const updated = await updateOrder(order.id, { submit_after: new Date().toISOString(), status: order.status === "awaiting_master" ? "awaiting_master" : "queued" });
      return json(res, 200, { order: updated });
    }
    if (body.action === "refund") {
      if (!stripe || !order.stripe_payment_intent_id) return json(res, 503, { error: "Stripe refund is unavailable." });
      if (order.prodigi_order_id || ["submitting", "submitted", "in_production", "shipped"].includes(order.status)) {
        return json(res, 409, { error: "This order reached Prodigi; cancel it there before refunding." });
      }
      await stripe.refunds.create({ payment_intent: order.stripe_payment_intent_id }, { idempotencyKey: `refund-${order.id}` });
      const updated = await updateOrder(order.id, { status: "refunded" });
      return json(res, 200, { order: updated });
    }
    json(res, 400, { error: "Unknown admin action." });
  } catch (error) {
    const message = safeError(error);
    console.error("admin orders:", message);
    json(res, 500, { error: message });
  }
}
