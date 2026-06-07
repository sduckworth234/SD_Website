import { useEffect } from "react";

export const SITE_URL = "https://www.samduckworth.com";
export const DEFAULT_DESCRIPTION =
  "Aerial drone and landscape photography by Sam Duckworth, based on Sydney's Northern Beaches — fine-art prints and commissions.";

function setAttr(selector: string, attr: string, value: string) {
  const el = document.head.querySelector(selector);
  if (el) el.setAttribute(attr, value);
}

// Per-view SEO: updates the document title plus the description / canonical /
// Open Graph / Twitter tags for the current route. Googlebot renders JS, so
// these per-route values are read for indexing; it also keeps the browser tab
// label correct. (Non-JS social scrapers still get the static index.html tags —
// full per-URL share previews would need prerendering, a later step.)
export function useSeo(title: string, opts: { description?: string; path?: string } = {}) {
  const description = opts.description ?? DEFAULT_DESCRIPTION;
  const path = opts.path ?? "/";
  useEffect(() => {
    const url = `${SITE_URL}${path}`;
    document.title = title;
    setAttr('meta[name="description"]', "content", description);
    setAttr('link[rel="canonical"]', "href", url);
    setAttr('meta[property="og:title"]', "content", title);
    setAttr('meta[property="og:description"]', "content", description);
    setAttr('meta[property="og:url"]', "content", url);
    setAttr('meta[name="twitter:title"]', "content", title);
    setAttr('meta[name="twitter:description"]', "content", description);
  }, [title, description, path]);
}
