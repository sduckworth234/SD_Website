// SPA fallback that can return a real 404.
//
// WHY: the catch-all rewrite used to send every unmatched path to
// /index.html, which Vercel serves with HTTP 200. Google treats that as a
// "soft 404" — /about, /gallerys, an old deleted product URL and any random
// crawl target all looked like valid pages. The app rendered its NotFound
// screen with a client-side noindex, but only a JS-rendering crawler ever saw
// that.
//
// HOW: every prerendered route (see scripts/prerender.mjs) is a real file in
// dist/, and Vercel checks the filesystem BEFORE rewrites — so those never
// reach this function. What lands here is either a genuinely unknown path
// (404) or one of the routes that only exist client-side (200):
//
//   /admin, /checkout, /checkout/success, /cart   — app-only routes
//   /shop/<slug>, /galleries/<slug>               — data-driven routes
//
// The two data-driven prefixes answer 200 even when the slug was not
// prerendered: the catalogue and the location list are edited in /admin and
// go live WITHOUT a redeploy, so a brand-new product would otherwise 404
// until the next push. A dead slug there redirects itself client-side (the
// shop) or falls back to the whole gallery. Everything else is a hard 404.
//
// The body is the built index.html, fetched once from this deployment's own
// origin and cached in module scope for the life of the lambda instance — it
// carries the hashed asset URLs, so it cannot be inlined here.

const APP_ROUTES = new Set([
  "/admin",
  "/cart",
  "/checkout",
  "/checkout/success",
]);
const APP_PREFIXES = ["/shop/", "/galleries/", "/admin/"];

const MINIMAL_404 = `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>Page not found — Sam Duckworth Photography</title></head>
<body style="font-family:system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh">
<main style="text-align:center"><p>404</p><h1>Page not found.</h1>
<p><a href="/">Back to the gallery</a></p></main></body></html>`;

let shellCache = null;

async function shell(req) {
  if (shellCache) return shellCache;
  const host = req.headers["x-forwarded-host"] ?? req.headers.host ?? process.env.VERCEL_URL;
  if (!host) return MINIMAL_404;
  const proto = req.headers["x-forwarded-proto"] ?? "https";
  try {
    // /index.html is a static file, so this never re-enters this function.
    const response = await fetch(`${proto}://${host}/index.html`, {
      headers: { "user-agent": "sd-spa-fallback" },
    });
    if (!response.ok) return MINIMAL_404;
    const html = await response.text();
    if (!html.includes("<div id=\"root\">")) return MINIMAL_404;
    shellCache = html;
    return shellCache;
  } catch {
    return MINIMAL_404;
  }
}

function normalise(url) {
  const path = String(url ?? "/").split("?")[0].split("#")[0];
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

function isKnown(path) {
  if (path === "/" || APP_ROUTES.has(path)) return true;
  return APP_PREFIXES.some((prefix) => path.startsWith(prefix) && path.length > prefix.length);
}

export default async function handler(req, res) {
  const path = normalise(req.url);
  const known = isKnown(path);
  let html = await shell(req);

  // The shell is the HOME page's prerendered HTML, so its canonical, og:url and
  // #sd-boot payload describe "/" — none of which is true for whatever path
  // actually landed here. Drop them and let the app's own useSeo (src/lib/seo.ts)
  // be the only source of canonical/OG for these routes.
  html = html
    .replace(/<link rel="canonical"[^>]*>/i, "")
    .replace(/<meta property="og:url"[^>]*>/i, "")
    .replace(/<script type="application\/json" id="sd-boot">[\s\S]*?<\/script>/i, "")
    .replace(/<link rel="preload" as="image"[^>]*>/i, "");

  if (!known) {
    html = html
      .replace(/<meta name="robots"[^>]*>/i, "")
      .replace(/<title>[\s\S]*?<\/title>/i, "<title>Page not found — Sam Duckworth Photography</title>")
      .replace("</head>", '<meta name="robots" content="noindex, nofollow" /></head>');
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader(
    "Cache-Control",
    known ? "public, max-age=0, s-maxage=600, stale-while-revalidate=86400" : "public, max-age=0, s-maxage=60",
  );
  res.status(known ? 200 : 404).send(html);
}
