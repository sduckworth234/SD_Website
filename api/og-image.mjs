// Social-share preview image (og:image target). Link crawlers (iMessage,
// WhatsApp, Facebook…) read the static og:image meta tag and never run the
// app, so a fixed PNG goes stale the moment the hero changes. This endpoint
// resolves the CURRENT landing hero — the same way Home does: the admin-chosen
// site_settings.hero_photo, else the featured/landscape fallback chain — and
// 302-redirects to its image, so every fresh share shows today's hero.
//
// Cached at the edge for 5 minutes; a hero change appears in new shares within
// that window. Falls back to the static /og-image.png if anything fails.

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const BUCKET = process.env.VITE_SUPABASE_PHOTO_BUCKET ?? "photos";

async function rest(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
  return res.json();
}

export default async function handler(req, res) {
  // Edge-cache the redirect briefly so crawler bursts don't hammer Supabase,
  // while hero changes still propagate quickly.
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");

  try {
    if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error("missing env");

    // The admin-chosen hero (site_settings), if set and still published.
    let photo = null;
    const settings = await rest("site_settings?key=eq.hero_photo&select=value");
    const chosenId = settings?.[0]?.value;
    if (chosenId) {
      const rows = await rest(
        `photos?id=eq.${encodeURIComponent(chosenId)}&is_published=eq.true&select=storage_bucket,storage_path,image_url`,
      );
      photo = rows?.[0] ?? null;
    }

    // Fallback chain, mirroring Home's heroPhoto memo over gallery order:
    // featured landscape/wide -> any wide -> any landscape -> first photo.
    if (!photo) {
      const rows = await rest(
        "photos?is_published=eq.true&location_id=not.is.null&select=storage_bucket,storage_path,image_url,aspect,is_featured&order=sort_order.asc,created_at.desc&limit=200",
      );
      const wideish = (p) => p.aspect === "landscape" || p.aspect === "wide";
      photo =
        rows.find((p) => p.is_featured && wideish(p)) ??
        rows.find((p) => p.aspect === "wide") ??
        rows.find((p) => p.aspect === "landscape") ??
        rows[0];
    }

    if (photo?.storage_path) {
      const path = `${photo.storage_bucket ?? BUCKET}/${photo.storage_path}`;
      // 1200px is the sweet spot for share cards; the render endpoint serves
      // JPEG to crawlers that don't advertise WebP support.
      res.redirect(
        302,
        `${SUPABASE_URL}/storage/v1/render/image/public/${path}?width=1200&quality=80&resize=contain`,
      );
      return;
    }
    if (photo?.image_url) {
      res.redirect(302, photo.image_url);
      return;
    }
    throw new Error("no hero resolved");
  } catch {
    res.redirect(302, "https://www.samduckworth.com/og-image.png");
  }
}
