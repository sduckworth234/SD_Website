import type { Session } from "@supabase/supabase-js";
import { ExternalLink, LoaderCircle, PackageCheck, Search, Upload } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { REQUIRED_PX, type SizeId } from "../lib/printCatalogue";

type OrderItem = {
  id: string;
  photo_id: string | null;
  title: string;
  thumb_url: string;
  size: string;
  mounted: boolean;
  colour: string;
  glazing?: string;
  print_master_path: string | null;
};

type ShippingAddress = { line1?: string; line2?: string; suburb?: string; state?: string; postcode?: string };

type Order = {
  id: string;
  status: string;
  customer_email: string;
  customer_name: string;
  shipping_address: ShippingAddress;
  total_cents: number;
  created_at: string;
  submit_after: string;
  // Absent until the delivery_method migration is applied — treated as a
  // courier delivery, which is what every order before it was.
  delivery_method?: string | null;
  fulfilment_provider: string;
  prodigi_order_id: string | null;
  tracking_carrier: string | null;
  tracking_number: string | null;
  tracking_url: string | null;
  stripe_receipt_url: string | null;
  stripe_invoice_url: string | null;
  stripe_invoice_pdf: string | null;
  last_fulfilment_error: string | null;
  order_items: OrderItem[];
};

type ShopFeatures = {
  checkoutEnabled: boolean;
  fulfilmentProvider: "manual" | "prodigi";
  prodigiConfigured: boolean;
  paidInvoicesEnabled: boolean;
};

type TrackingDraft = { carrier: string; number: string; url: string };

const DEFAULT_FEATURES: ShopFeatures = {
  checkoutEnabled: false,
  fulfilmentProvider: "manual",
  prodigiConfigured: false,
  paidInvoicesEnabled: false,
};

async function imageSize(file: File) {
  const bitmap = await createImageBitmap(file);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
}

function orderAddress(order: Order) {
  const address = order.shipping_address ?? {};
  return [address.line1, address.line2, [address.suburb, address.state, address.postcode].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
}

export function AdminOrders({ session }: { session: Session }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState("");
  const [message, setMessage] = useState("");
  const [features, setFeatures] = useState<ShopFeatures>(DEFAULT_FEATURES);
  const [tracking, setTracking] = useState<Record<string, TrackingDraft>>({});

  const request = useCallback(async (init?: RequestInit, q = "") => {
    const response = await fetch(`/api/admin-orders${q ? `?q=${encodeURIComponent(q)}` : ""}`, {
      ...init,
      headers: { authorization: `Bearer ${session.access_token}`, "content-type": "application/json", ...(init?.headers ?? {}) },
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Order request failed.");
    return data;
  }, [session.access_token]);

  const load = useCallback(async (q = "") => {
    setLoading(true);
    try {
      const data = await request(undefined, q);
      const nextOrders = (data.orders ?? []) as Order[];
      setOrders(nextOrders);
      setFeatures(data.features ?? DEFAULT_FEATURES);
      setTracking((current) => {
        const next = { ...current };
        for (const order of nextOrders) {
          next[order.id] ??= {
            carrier: order.tracking_carrier ?? "",
            number: order.tracking_number ?? "",
            url: order.tracking_url ?? "",
          };
        }
        return next;
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Orders could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => { load(); }, [load]);

  async function action(orderId: string, kind: "submit_now" | "refund" | "mark_processing" | "mark_shipped") {
    if (kind === "refund" && !window.confirm("Refund this Stripe payment? This cannot be undone.")) return;
    if (kind === "mark_shipped" && !window.confirm("Mark this order shipped and email the customer now?")) return;
    setWorking(`${orderId}-${kind}`);
    try {
      // Only mark_shipped reads tracking fields server-side — sending them
      // on every action was harmless dead payload, but pointless.
      const draft = tracking[orderId] ?? { carrier: "", number: "", url: "" };
      const data = await request({
        method: "POST",
        body: JSON.stringify({
          action: kind,
          orderId,
          ...(kind === "mark_shipped" ? { trackingCarrier: draft.carrier, trackingNumber: draft.number, trackingUrl: draft.url } : {}),
        }),
      });
      const notes: Record<typeof kind, string> = {
        refund: "Refund submitted.",
        submit_now: "Order queued for the next Prodigi run.",
        mark_processing: "Manual fulfilment started.",
        mark_shipped: "Order marked shipped and the customer was notified.",
      };
      setMessage(data.emailWarning || notes[kind]);
      await load(query);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Action failed.");
    } finally {
      setWorking("");
    }
  }

  async function uploadMaster(item: OrderItem, file: File) {
    if (!supabase || !item.photo_id) return;
    setWorking(`${item.id}-upload`);
    try {
      if (file.type !== "image/jpeg" || !/\.jpe?g$/i.test(file.name)) throw new Error("Export the print master as a JPEG first.");
      const dimensions = await imageSize(file);
      const required = REQUIRED_PX[item.size as SizeId]?.[item.mounted ? "cfpm" : "cfp"];
      const [short, long] = [dimensions.width, dimensions.height].sort((a, b) => a - b);
      if (required && (short < required[0] || long < required[1])) throw new Error(`${item.title} needs at least ${required[0]} × ${required[1]} px for ${item.size}; this file is ${short} × ${long} px.`);
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-");
      const path = `${item.photo_id}/${Date.now()}-${safeName}`;
      const uploaded = await supabase.storage.from("print-masters").upload(path, file, { contentType: "image/jpeg", upsert: false });
      if (uploaded.error) throw uploaded.error;
      await request({ method: "POST", body: JSON.stringify({ action: "attach_master", photoId: item.photo_id, path, ...dimensions }) });
      setMessage(`Print master attached to every order for “${item.title}”.`);
      await load(query);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Print master upload failed.");
    } finally {
      setWorking("");
    }
  }

  function setTrackingField(orderId: string, field: keyof TrackingDraft, value: string) {
    setTracking((current) => ({
      ...current,
      [orderId]: { ...(current[orderId] ?? { carrier: "", number: "", url: "" }), [field]: value },
    }));
  }

  return (
    <section className="admin-orders">
      <div className="admin-orders-head">
        <div>
          <p className="eyebrow">Admin</p>
          <h2>Shop Orders</h2>
          <p>Every paid order appears here. Manual mode keeps checkout live without contacting Prodigi; mark each order processing and shipped when you fulfil it.</p>
        </div>
        <PackageCheck aria-hidden="true" />
      </div>

      <div className="admin-feature-row">
        <span className={features.checkoutEnabled ? "is-on" : ""}><b>Public checkout</b>{features.checkoutEnabled ? "Enabled" : "Disabled · admin testing available"}</span>
        <span className="is-on"><b>New-order fulfilment</b>{features.fulfilmentProvider === "manual" ? "Manual · safe default" : `Prodigi${features.prodigiConfigured ? " · connected" : " · key missing"}`}</span>
        <span className={features.paidInvoicesEnabled ? "is-on" : ""}><b>Stripe paid invoices</b>{features.paidInvoicesEnabled ? "Enabled" : "Off · receipts still available"}</span>
      </div>

      <details className="admin-order-help">
        <summary>Manual order workflow and button guide</summary>
        <ol>
          <li><b>Check the paid order</b><span>Open Receipt to confirm Stripe’s payment record, then check the customer, address, print, size, frame and mount.</span></li>
          <li><b>Prepare the artwork</b><span>Add the print-master JPEG if you want it stored against this photograph. In manual mode you can also supply the file directly to your chosen lab.</span></li>
          <li><b>Start fulfilment</b><span>Marks the order “in production”. It does not charge anything, email the customer or send the order to Prodigi.</span></li>
          <li><b>Mark shipped</b><span>Saves the carrier and tracking details, marks the order shipped and immediately sends the customer’s dispatch email.</span></li>
        </ol>
        <p><b>Refund</b> creates a real Stripe refund and closes the order. Use it before shipping; the original Stripe processing fee may not be returned. <b>Receipt</b> only opens Stripe’s hosted payment receipt and changes nothing.</p>
      </details>

      <form className="admin-search" onSubmit={(event) => { event.preventDefault(); load(query); }}>
        <Search size={16} aria-hidden="true" />
        <input aria-label="Search orders" onChange={(event) => setQuery(event.target.value)} placeholder="Search customer name or email…" value={query} />
        <button className="text-button" type="submit">Search</button>
      </form>
      {message ? <p className="form-note" role="status">{message}</p> : null}
      {loading ? <p className="loading-note"><LoaderCircle className="spin" /> Loading orders…</p> : null}

      <div className="admin-order-list">
        {orders.map((order) => {
          const manual = order.fulfilment_provider !== "prodigi";
          const closed = ["refunded", "cancelled"].includes(order.status);
          const shipped = order.status === "shipped";
          const pickup = order.delivery_method === "pickup";
          const draft = tracking[order.id] ?? { carrier: "", number: "", url: "" };
          return (
            <article className="admin-order" key={order.id}>
              <div className="admin-order-col admin-order-info">
                <header>
                  <div><b>{order.customer_name}</b><span>{order.customer_email}</span><small>{orderAddress(order)}</small></div>
                  <div><strong>${(order.total_cents / 100).toFixed(2)}</strong><span>{new Date(order.created_at).toLocaleString("en-AU")}</span></div>
                </header>
                <div className="admin-order-status">
                  <span className={`status ${order.status}`}>{order.status.replace(/_/g, " ")}</span>
                  <span className={`provider ${manual ? "manual" : "prodigi"}`}>{manual ? "Manual fulfilment" : "Prodigi"}</span>
                  <span className={`delivery ${pickup ? "pickup" : "courier"}`}>{pickup ? "Collecting in person" : "Tracked delivery"}</span>
                  <code>{order.id.slice(0, 8).toUpperCase()}</code>
                  {order.prodigi_order_id ? <code>{order.prodigi_order_id}</code> : null}
                </div>
                {order.last_fulfilment_error ? <p className="admin-order-error">{order.last_fulfilment_error}</p> : null}
              </div>

              <div className="admin-order-col admin-order-items">
                {order.order_items.map((item) => (
                  <div key={item.id}>
                    {item.thumb_url ? <img alt="" src={item.thumb_url} /> : null}
                    <span><b>{item.title}</b><small>{item.size} · {item.colour} · {item.mounted ? "mounted" : "unmounted"} · {String(item.glazing ?? "clear").replace(/_/g, " ")} glass</small></span>
                    {item.print_master_path ? <em>JPEG ready</em> : (
                      <label className="master-upload"><Upload size={13} /> {working === `${item.id}-upload` ? "Uploading…" : "Add print master"}<input accept="image/jpeg,.jpg,.jpeg" disabled={Boolean(working)} onChange={(event) => event.target.files?.[0] && uploadMaster(item, event.target.files[0])} type="file" /></label>
                    )}
                  </div>
                ))}
              </div>

              <div className="admin-order-col admin-order-actions">
                {manual && !closed && pickup ? (
                  <div className="manual-fulfilment">
                    <p>This order is being collected in person. Marking it ready emails the customer that the print is finished and asks them to arrange a time — no tracking details are needed.</p>
                  </div>
                ) : null}
                {manual && !closed && !pickup ? (
                  <div className="manual-fulfilment">
                    <div>
                      <label>Carrier<input onChange={(event) => setTrackingField(order.id, "carrier", event.target.value)} placeholder="e.g. Australia Post" value={draft.carrier} /></label>
                      <label>Tracking number<input onChange={(event) => setTrackingField(order.id, "number", event.target.value)} placeholder="Optional" value={draft.number} /></label>
                      <label>Tracking link<input onChange={(event) => setTrackingField(order.id, "url", event.target.value)} placeholder="https://…" type="url" value={draft.url} /></label>
                    </div>
                    <p>Marking shipped sends the customer their dispatch email immediately.</p>
                  </div>
                ) : null}

                <footer>
                  {manual ? (
                    <>
                      <button className="text-button" disabled={Boolean(working) || closed || shipped || order.status === "in_production"} onClick={() => action(order.id, "mark_processing")} title="Set this manual order to in production. No email is sent." type="button">Start fulfilment</button>
                      <button className="solid-button" disabled={Boolean(working) || closed || shipped} onClick={() => action(order.id, "mark_shipped")} title={pickup ? "Close fulfilment and email the customer that their print is ready to collect." : "Save tracking, close fulfilment and email the customer."} type="button">{pickup ? "Mark ready to collect" : "Mark shipped"}</button>
                    </>
                  ) : (
                    <button className="solid-button" disabled={features.fulfilmentProvider !== "prodigi" || !features.prodigiConfigured || Boolean(working) || ["submitted", "in_production", "shipped", "refunded", "cancelled"].includes(order.status)} onClick={() => action(order.id, "submit_now")} title={features.fulfilmentProvider === "prodigi" ? undefined : "Prodigi mode is disabled"} type="button">Submit to Prodigi</button>
                  )}
                  <button className="text-button danger" disabled={Boolean(working) || Boolean(order.prodigi_order_id) || ["refunded", "cancelled", "shipped"].includes(order.status)} onClick={() => action(order.id, "refund")} title="Create a Stripe refund and close this order." type="button">Refund</button>
                  <div className="admin-order-links">
                    {order.tracking_url ? <a href={order.tracking_url} rel="noreferrer" target="_blank">Tracking{order.tracking_carrier ? ` (${order.tracking_carrier})` : ""} <ExternalLink size={12} /></a> : null}
                    {!order.tracking_url && order.tracking_carrier ? <span className="admin-order-tracking-plain">{order.tracking_carrier}{order.tracking_number ? ` · ${order.tracking_number}` : ""}</span> : null}
                    {order.stripe_receipt_url ? <a href={order.stripe_receipt_url} rel="noreferrer" target="_blank">Receipt <ExternalLink size={12} /></a> : null}
                    {order.stripe_invoice_url || order.stripe_invoice_pdf ? <a href={order.stripe_invoice_url ?? order.stripe_invoice_pdf ?? "#"} rel="noreferrer" target="_blank">Invoice <ExternalLink size={12} /></a> : null}
                  </div>
                </footer>
              </div>
            </article>
          );
        })}
      </div>
      {!loading && !orders.length ? <p className="admin-card">No orders yet.</p> : null}
    </section>
  );
}
