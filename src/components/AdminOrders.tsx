import type { Session } from "@supabase/supabase-js";
import { ExternalLink, LoaderCircle, PackageCheck, Search, Upload } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

type OrderItem = { id: string; photo_id: string | null; title: string; size: string; mounted: boolean; colour: string; print_master_path: string | null };
type Order = { id: string; status: string; customer_email: string; customer_name: string; total_cents: number; created_at: string; submit_after: string; prodigi_order_id: string | null; tracking_url: string | null; last_fulfilment_error: string | null; order_items: OrderItem[] };
type ShopFeatures = { checkoutEnabled: boolean; fulfilmentEnabled: boolean };

const REQUIRED: Record<string, [number, number]> = {
  "GLOBAL-CFP-A5": [1748, 2480], "GLOBAL-CFPM-A5": [1164, 1890],
  "GLOBAL-CFP-A4": [2490, 3510], "GLOBAL-CFPM-A4": [1594, 2622],
  "GLOBAL-CFP-A3": [3507, 4960], "GLOBAL-CFPM-A3": [2385, 3825],
  "GLOBAL-CFP-A2": [4960, 7015], "GLOBAL-CFPM-A2": [3780, 5835],
  "GLOBAL-CFP-A1": [7020, 9930], "GLOBAL-CFPM-A1": [5895, 8805],
};

async function imageSize(file: File) {
  const bitmap = await createImageBitmap(file);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
}

export function AdminOrders({ session }: { session: Session }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState("");
  const [message, setMessage] = useState("");
  const [features, setFeatures] = useState<ShopFeatures>({ checkoutEnabled: false, fulfilmentEnabled: false });

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
      setOrders(data.orders);
      setFeatures(data.features ?? { checkoutEnabled: false, fulfilmentEnabled: false });
    }
    catch (error) { setMessage(error instanceof Error ? error.message : "Orders could not be loaded."); }
    finally { setLoading(false); }
  }, [request]);

  useEffect(() => { load(); }, [load]);

  async function action(orderId: string, kind: "submit_now" | "refund") {
    if (kind === "refund" && !window.confirm("Refund this Stripe payment? This cannot be undone.")) return;
    setWorking(`${orderId}-${kind}`);
    try {
      await request({ method: "POST", body: JSON.stringify({ action: kind, orderId }) });
      setMessage(kind === "refund" ? "Refund submitted." : "Order queued for the next fulfilment run.");
      await load(query);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Action failed."); }
    finally { setWorking(""); }
  }

  async function uploadMaster(item: OrderItem, file: File) {
    if (!supabase || !item.photo_id) return;
    setWorking(`${item.id}-upload`);
    try {
      if (file.type !== "image/jpeg" || !/\.jpe?g$/i.test(file.name)) throw new Error("Export the print master as a JPEG first.");
      const dimensions = await imageSize(file);
      const sku = `GLOBAL-${item.mounted ? "CFPM" : "CFP"}-${item.size}`;
      const required = REQUIRED[sku];
      const [short, long] = [dimensions.width, dimensions.height].sort((a, b) => a - b);
      if (required && (short < required[0] || long < required[1])) throw new Error(`${item.title} needs at least ${required[0]} × ${required[1]} px for ${item.size}; this file is ${short} × ${long} px.`);
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-");
      const path = `${item.photo_id}/${Date.now()}-${safeName}`;
      const uploaded = await supabase.storage.from("print-masters").upload(path, file, { contentType: "image/jpeg", upsert: false });
      if (uploaded.error) throw uploaded.error;
      await request({ method: "POST", body: JSON.stringify({ action: "attach_master", photoId: item.photo_id, path, ...dimensions }) });
      setMessage(`Print master attached to every order for “${item.title}”.`);
      await load(query);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Print master upload failed."); }
    finally { setWorking(""); }
  }

  return <section className="admin-orders"><div className="admin-orders-head"><div><p className="eyebrow">Shop</p><h2>Orders</h2><p>Paid orders pause for 45 minutes, then move to Prodigi once every item has a print master.</p></div><PackageCheck /></div><div className="admin-feature-row"><span className={features.checkoutEnabled ? "is-on" : ""}><b>Public checkout</b>{features.checkoutEnabled ? "Enabled" : "Disabled · admin testing available"}</span><span className={features.fulfilmentEnabled ? "is-on" : ""}><b>Prodigi fulfilment</b>{features.fulfilmentEnabled ? "Enabled" : "Disabled"}</span></div><form className="admin-search" onSubmit={(e) => { e.preventDefault(); load(query); }}><Search size={16} /><input aria-label="Search orders" onChange={(e) => setQuery(e.target.value)} placeholder="Search customer name or email…" value={query} /><button className="text-button" type="submit">Search</button></form>{message ? <p className="form-note">{message}</p> : null}{loading ? <p className="loading-note"><LoaderCircle className="spin" /> Loading orders…</p> : null}<div className="admin-order-list">{orders.map((order) => <article className="admin-order" key={order.id}><header><div><b>{order.customer_name}</b><span>{order.customer_email}</span></div><div><strong>${(order.total_cents / 100).toFixed(2)}</strong><span>{new Date(order.created_at).toLocaleDateString("en-AU")}</span></div></header><div className="admin-order-status"><span className={`status ${order.status}`}>{order.status.replace(/_/g, " ")}</span><code>{order.id.slice(0, 8).toUpperCase()}</code>{order.prodigi_order_id ? <code>{order.prodigi_order_id}</code> : null}</div>{order.last_fulfilment_error ? <p className="admin-order-error">{order.last_fulfilment_error}</p> : null}<div className="admin-order-items">{order.order_items.map((item) => <div key={item.id}><span><b>{item.title}</b><small>{item.size} · {item.colour} · {item.mounted ? "mounted" : "unmounted"}</small></span>{item.print_master_path ? <em>JPEG ready</em> : <label className="master-upload"><Upload size={13} /> {working === `${item.id}-upload` ? "Uploading…" : "Add print master"}<input accept="image/jpeg,.jpg,.jpeg" disabled={Boolean(working)} onChange={(e) => e.target.files?.[0] && uploadMaster(item, e.target.files[0])} type="file" /></label>}</div>)}</div><footer><button className="solid-button" disabled={!features.fulfilmentEnabled || Boolean(working) || ["submitted", "in_production", "shipped", "refunded", "cancelled"].includes(order.status)} onClick={() => action(order.id, "submit_now")} title={features.fulfilmentEnabled ? undefined : "Prodigi fulfilment is disabled"} type="button">Submit now</button><button className="text-button danger" disabled={Boolean(working) || Boolean(order.prodigi_order_id) || ["refunded", "cancelled", "shipped"].includes(order.status)} onClick={() => action(order.id, "refund")} type="button">Refund</button>{order.tracking_url ? <a href={order.tracking_url} rel="noreferrer" target="_blank">Tracking <ExternalLink size={12} /></a> : null}</footer></article>)}</div>{!loading && !orders.length ? <p className="admin-card">No orders yet.</p> : null}</section>;
}
