const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PUBLIC_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;

function requireEnv() {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("Missing Supabase server environment.");
}

export async function supabaseRest(path, init = {}) {
  requireEnv();
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      authorization: `Bearer ${SERVICE_KEY}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw new Error(`Supabase ${init.method ?? "GET"} failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

export async function fetchShopPhotos(photoIds) {
  const ids = [...new Set(photoIds)];
  const filter = ids.map((id) => `"${id}"`).join(",");
  const rows = await supabaseRest(
    `photos?id=in.(${encodeURIComponent(filter)})&is_published=eq.true&in_shop=eq.true&select=id,title,image_url,storage_bucket,storage_path,locations(name)`,
  );
  const map = new Map();
  for (const row of rows ?? []) {
    map.set(row.id, {
      id: row.id,
      title: row.title || "Untitled",
      location: row.locations?.name || "Australia",
      thumbUrl: row.storage_path
        ? `${SUPABASE_URL}/storage/v1/render/image/public/${row.storage_bucket ?? "photos"}/${row.storage_path}?width=400&quality=80&resize=cover`
        : row.image_url,
    });
  }
  if (map.size !== ids.length) throw new Error("One or more prints are no longer available in the shop.");
  return map;
}

export async function shopRuntimeEnabled() {
  const rows = await supabaseRest(
    "site_settings?key=in.(shop_public,print_configurator)&enabled=eq.true&select=key",
  );
  const enabled = new Set((rows ?? []).map((row) => row.key));
  return enabled.has("shop_public") && enabled.has("print_configurator");
}

export async function insertPaidOrder(order, items) {
  const orderId = await supabaseRest("rpc/create_paid_order", {
    method: "POST",
    body: JSON.stringify({ p_order: order, p_items: items }),
  });
  if (typeof orderId !== "string") throw new Error("Atomic order insert returned no id.");
  const rows = await supabaseRest(`orders?id=eq.${encodeURIComponent(orderId)}&select=*&limit=1`);
  if (!rows?.[0]) throw new Error("Atomic order insert returned no row.");
  return rows[0];
}

export async function getOrderBySession(sessionId) {
  const rows = await supabaseRest(
    `orders?stripe_checkout_session_id=eq.${encodeURIComponent(sessionId)}&select=*,order_items(*)&limit=1`,
  );
  return rows?.[0] ?? null;
}

export async function updateOrder(orderId, patch) {
  const rows = await supabaseRest(`orders?id=eq.${encodeURIComponent(orderId)}`, {
    method: "PATCH",
    headers: { prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
  return rows?.[0] ?? null;
}

export async function signedMasterUrl(path, expiresIn = 3600) {
  requireEnv();
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/print-masters/${path.split("/").map(encodeURIComponent).join("/")}`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      authorization: `Bearer ${SERVICE_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ expiresIn }),
  });
  if (!response.ok) throw new Error(`Could not sign print master (${response.status}).`);
  const data = await response.json();
  return data.signedURL?.startsWith("http") ? data.signedURL : `${SUPABASE_URL}/storage/v1${data.signedURL}`;
}

export async function requireAdmin(req) {
  if (!SUPABASE_URL || !PUBLIC_KEY) throw new Error("Missing Supabase auth environment.");
  const authorization = req.headers.authorization ?? "";
  if (!authorization.startsWith("Bearer ")) return null;
  // Ask Postgres to resolve membership from auth.uid(). The hardened
  // is_admin() function joins the verified Auth user to admin_users by email;
  // admin_users intentionally has no user_id column.
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_admin`, {
    method: "POST",
    headers: {
      apikey: PUBLIC_KEY,
      authorization,
      "content-type": "application/json",
    },
    body: "{}",
  });
  if (!response.ok) return null;
  return (await response.json()) === true ? { verified: true } : null;
}
