// Bootstrap data inlined into the prerendered home page by
// scripts/prerender.mjs as <script type="application/json" id="sd-boot">.
//
// WHY: the landing hero is admin-chosen (site_settings.hero_photo) and used to
// be unknowable until the gallery + settings queries came back — so the first
// paint was an empty black stage for as long as those took, and only THEN did
// the hero image start downloading. The prerender resolves the same hero, adds
// a <link rel=preload> for the exact variant the Hero requests, and drops the
// details here so the hero renders on the first frame.
//
// It is a HINT, never the truth. The admin changes the hero (and places, and
// contact details) without a redeploy, so this payload is only as fresh as the
// last deploy — every consumer must let live Supabase data replace it the
// moment it lands.
//
// It is a JSON data block rather than an inline script on purpose: the CSP in
// vercel.json allow-lists inline scripts by sha256 hash, and a per-build hash
// cannot be added to a static config file. type="application/json" is inert,
// so no CSP entry is needed.

export type BootHero = {
  id: string;
  title: string;
  location: string;
  aspect: "portrait" | "landscape" | "square" | "wide";
  imageUrl: string;
};

export type BootContent = Partial<{
  siteName: string;
  publicEmail: string;
  publicPhone: string;
  publicLocation: string;
  instagramHandle: string;
  instagramUrl: string;
}>;

export type BootData = {
  hero: BootHero | null;
  locations: string[];
  content: BootContent;
};

let cached: BootData | null | undefined;

export function readBootData(): BootData | null {
  if (cached !== undefined) return cached;
  cached = null;
  try {
    const node = document.getElementById("sd-boot");
    if (node?.textContent) {
      const parsed = JSON.parse(node.textContent) as BootData;
      if (parsed && typeof parsed === "object") {
        cached = {
          hero: parsed.hero?.imageUrl ? parsed.hero : null,
          locations: Array.isArray(parsed.locations) ? parsed.locations : [],
          content: parsed.content ?? {},
        };
      }
    }
  } catch {
    // A malformed payload must never break the app — the normal data path
    // still fills everything in a moment later.
    cached = null;
  }
  return cached;
}
