// Pulls the latest Instagram posts into Supabase so the home page can show a
// live feed without the browser ever touching Instagram.
//
// Runs on a Vercel Cron (see vercel.json). Each run:
//   1. reads the current long-lived token (Supabase, falling back to the env
//      seed on the very first run),
//   2. fetches the most recent media from graph.instagram.com,
//   3. MIRRORS each image into the photos bucket — Instagram's media_url values
//      are signed and expire, so linking them directly would rot the feed,
//   4. upserts the posts and prunes anything no longer in the feed,
//   5. refreshes the token when it's over ~50 days old and stores the new one.
//
// Note: the app secret is NOT needed here. It's only used once, by
// scripts/instagram-token.mjs, to mint the first long-lived token; refreshing
// needs the token alone. So it never has to be stored on Vercel.
//
// Everything here uses the SERVICE ROLE key: it writes to instagram_posts and
// is the only thing allowed to read integration_secrets (anon cannot).
//
// Safe to call repeatedly — it's idempotent, keyed on the Instagram media id.

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = process.env.VITE_SUPABASE_PHOTO_BUCKET ?? "photos";
const TOKEN_SEED = process.env.INSTAGRAM_TOKEN;
const CRON_SECRET = process.env.CRON_SECRET;

const LIMIT = Number(process.env.INSTAGRAM_LIMIT ?? 12);
const GRAPH = "https://graph.instagram.com";
const TOKEN_KEY = "instagram_token";
const TOKEN_AT_KEY = "instagram_token_refreshed_at";
// Tokens live 60 days; renew with plenty of runway so a few failed runs are fine.
const REFRESH_AFTER_DAYS = 50;

// ---- tiny Supabase REST helpers (no SDK needed for this) -------------------
const sbHeaders = {
  apikey: SERVICE_KEY,
  authorization: `Bearer ${SERVICE_KEY}`,
  "content-type": "application/json",
};

async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { ...sbHeaders, ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Supabase ${init.method ?? "GET"} ${path} -> ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function getSecret(key) {
  const rows = await sb(`integration_secrets?key=eq.${encodeURIComponent(key)}&select=value`);
  return rows?.[0]?.value ?? null;
}

async function setSecret(key, value) {
  await sb("integration_secrets?on_conflict=key", {
    method: "POST",
    headers: { prefer: "resolution=merge-duplicates" },
    body: JSON.stringify([{ key, value }]),
  });
}

// ---- image mirroring -------------------------------------------------------
// Instagram's CDN links expire, so the bytes are copied into our own bucket and
// the feed only ever references storage paths we control.
async function mirrorImage(url, storagePath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`image fetch ${res.status}`);
  const body = Buffer.from(await res.arrayBuffer());
  const put = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${storagePath}`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      authorization: `Bearer ${SERVICE_KEY}`,
      "content-type": res.headers.get("content-type") ?? "image/jpeg",
      "x-upsert": "true",
    },
    body,
  });
  if (!put.ok) throw new Error(`storage upload ${put.status} ${await put.text()}`);
  return body.length;
}

// ---- token lifecycle -------------------------------------------------------
async function currentToken() {
  const stored = await getSecret(TOKEN_KEY);
  if (stored) return stored;
  if (!TOKEN_SEED) throw new Error("No Instagram token: set INSTAGRAM_TOKEN once, or seed integration_secrets.");
  // First run: adopt the env seed and take ownership of it from here on.
  await setSecret(TOKEN_KEY, TOKEN_SEED);
  await setSecret(TOKEN_AT_KEY, new Date().toISOString());
  return TOKEN_SEED;
}

async function maybeRefresh(token) {
  const at = await getSecret(TOKEN_AT_KEY);
  const ageDays = at ? (Date.now() - Date.parse(at)) / 86_400_000 : Infinity;
  if (ageDays < REFRESH_AFTER_DAYS) return { token, refreshed: false, ageDays: Math.round(ageDays) };

  const res = await fetch(`${GRAPH}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`);
  if (!res.ok) {
    // Don't throw: a failed refresh shouldn't stop today's feed from syncing.
    console.warn(`token refresh failed (${res.status}) — continuing with the existing token`);
    return { token, refreshed: false, ageDays: Math.round(ageDays), refreshError: res.status };
  }
  const data = await res.json();
  if (!data.access_token) return { token, refreshed: false, ageDays: Math.round(ageDays) };
  await setSecret(TOKEN_KEY, data.access_token);
  await setSecret(TOKEN_AT_KEY, new Date().toISOString());
  return { token: data.access_token, refreshed: true, ageDays: Math.round(ageDays) };
}

// ---- the sync ---------------------------------------------------------------
export default async function handler(req, res) {
  // Vercel Cron sends this header when CRON_SECRET is configured. When it is
  // set we require it, so the endpoint can't be triggered by anyone passing by.
  if (CRON_SECRET) {
    const auth = req.headers.authorization ?? "";
    if (auth !== `Bearer ${CRON_SECRET}`) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
  }

  if (!SUPABASE_URL || !SERVICE_KEY) {
    res.status(500).json({ error: "missing Supabase env" });
    return;
  }

  try {
    let token = await currentToken();
    const refresh = await maybeRefresh(token);
    token = refresh.token;

    const fields = "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count";
    const feedRes = await fetch(`${GRAPH}/me/media?fields=${fields}&limit=${LIMIT}&access_token=${encodeURIComponent(token)}`);
    if (!feedRes.ok) {
      const body = await feedRes.text();
      res.status(502).json({ error: "instagram fetch failed", status: feedRes.status, body: body.slice(0, 400) });
      return;
    }
    const feed = await feedRes.json();
    const items = (feed.data ?? [])
      // Videos/reels expose a still via thumbnail_url; anything with no image at
      // all is skipped rather than rendered as a hole in the strip.
      .map((m) => ({ ...m, image: m.media_type === "VIDEO" ? m.thumbnail_url : m.media_url }))
      .filter((m) => m.image)
      .slice(0, LIMIT);

    const rows = [];
    let mirrored = 0;
    const failures = [];
    for (let i = 0; i < items.length; i += 1) {
      const m = items[i];
      const storagePath = `instagram/${m.id}.jpg`;
      try {
        await mirrorImage(m.image, storagePath);
        mirrored += 1;
      } catch (error) {
        // Keep the post — an un-mirrored image is better than a missing post,
        // and the next run will retry the copy.
        failures.push({ id: m.id, reason: String(error).slice(0, 120) });
      }
      rows.push({
        id: m.id,
        caption: m.caption ?? null,
        permalink: m.permalink,
        media_type: m.media_type ?? null,
        posted_at: m.timestamp ?? null,
        storage_path: storagePath,
        like_count: m.like_count ?? null,
        comments_count: m.comments_count ?? null,
        sort_order: i,
        synced_at: new Date().toISOString(),
      });
    }

    if (rows.length) {
      await sb("instagram_posts?on_conflict=id", {
        method: "POST",
        headers: { prefer: "resolution=merge-duplicates" },
        body: JSON.stringify(rows),
      });
      // Drop posts that have fallen out of the feed (deleted or pushed past LIMIT).
      const keep = rows.map((r) => `"${r.id}"`).join(",");
      await sb(`instagram_posts?id=not.in.(${keep})`, { method: "DELETE" });
    }

    res.status(200).json({
      ok: true,
      posts: rows.length,
      mirrored,
      failures,
      token: { ageDays: refresh.ageDays, refreshed: refresh.refreshed, refreshError: refresh.refreshError ?? null },
    });
  } catch (error) {
    console.error("instagram-sync failed", error);
    res.status(500).json({ error: String(error).slice(0, 500) });
  }
}
