import { useEffect } from "react";

export const SITE_URL = "https://www.samduckworth.com";
export const DEFAULT_DESCRIPTION =
  "Aerial drone and landscape photography by Sam Duckworth, based on Sydney's Northern Beaches — fine-art prints and commissions.";

const DEFAULT_IMAGE = `${SITE_URL}/api/og-image`;
const STRUCTURED_DATA_ID = "route-structured-data";

export type StructuredData = Record<string, unknown>;

export type SeoOptions = {
  description?: string;
  path?: string;
  image?: string;
  type?: "website" | "article" | "product" | string;
  noindex?: boolean;
  structuredData?: StructuredData | StructuredData[];
};

export type ProductStructuredDataInput = {
  name: string;
  description: string;
  path: string;
  image: string | string[];
  price: number;
  currency?: string;
  available?: boolean;
  category?: string;
  material?: string;
  sku?: string;
};

function ensureElement(selector: string, create: () => HTMLElement): HTMLElement {
  const existing = document.head.querySelector<HTMLElement>(selector);
  if (existing) return existing;
  const element = create();
  document.head.appendChild(element);
  return element;
}

function setMeta(selector: string, attrName: "name" | "property", attrValue: string, value: string) {
  const el = ensureElement(selector, () => {
    const meta = document.createElement("meta");
    meta.setAttribute(attrName, attrValue);
    return meta;
  });
  el.setAttribute("content", value);
}

function absoluteUrl(value: string): string {
  if (/^https?:\/\//i.test(value)) return value;
  return `${SITE_URL}${value.startsWith("/") ? value : `/${value}`}`;
}

export function productStructuredData(input: ProductStructuredDataInput): StructuredData {
  const product: StructuredData = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: input.name,
    description: input.description,
    image: Array.isArray(input.image)
      ? input.image.map(absoluteUrl)
      : absoluteUrl(input.image),
    url: absoluteUrl(input.path),
    brand: {
      "@type": "Brand",
      name: "Sam Duckworth Photography",
    },
    offers: {
      "@type": "Offer",
      priceCurrency: input.currency ?? "AUD",
      price: input.price.toFixed(2),
      availability: input.available === false
        ? "https://schema.org/OutOfStock"
        : "https://schema.org/InStock",
      itemCondition: "https://schema.org/NewCondition",
      url: absoluteUrl(input.path),
      seller: {
        "@type": "Organization",
        name: "Sam Duckworth Photography",
      },
      shippingDetails: {
        "@type": "OfferShippingDetails",
        shippingDestination: {
          "@type": "DefinedRegion",
          addressCountry: "AU",
        },
      },
    },
  };
  if (input.category) product.category = input.category;
  if (input.material) product.material = input.material;
  if (input.sku) product.sku = input.sku;
  return product;
}

// Per-view SEO: updates the document title plus the description / canonical /
// Open Graph / Twitter tags for the current route. Googlebot renders JS, so
// these per-route values are read for indexing; it also keeps the browser tab
// label correct. (Non-JS social scrapers still get the static index.html tags —
// full per-URL share previews would need prerendering, a later step.)
export function useSeo(title: string, opts: SeoOptions = {}) {
  const description = opts.description ?? DEFAULT_DESCRIPTION;
  const path = opts.path ?? "/";
  const image = absoluteUrl(opts.image ?? DEFAULT_IMAGE);
  const type = opts.type ?? "website";
  const noindex = opts.noindex ?? false;
  const structuredData = opts.structuredData;
  useEffect(() => {
    const url = absoluteUrl(path);
    document.title = title;
    setMeta('meta[name="description"]', "name", "description", description);
    const canonical = ensureElement('link[rel="canonical"]', () => {
      const link = document.createElement("link");
      link.setAttribute("rel", "canonical");
      return link;
    });
    canonical.setAttribute("href", url);
    setMeta('meta[name="robots"]', "name", "robots", noindex ? "noindex, nofollow" : "index, follow");
    setMeta('meta[property="og:type"]', "property", "og:type", type);
    setMeta('meta[property="og:title"]', "property", "og:title", title);
    setMeta('meta[property="og:description"]', "property", "og:description", description);
    setMeta('meta[property="og:url"]', "property", "og:url", url);
    setMeta('meta[property="og:image"]', "property", "og:image", image);
    setMeta('meta[name="twitter:card"]', "name", "twitter:card", "summary_large_image");
    setMeta('meta[name="twitter:title"]', "name", "twitter:title", title);
    setMeta('meta[name="twitter:description"]', "name", "twitter:description", description);
    setMeta('meta[name="twitter:image"]', "name", "twitter:image", image);

    document.getElementById(STRUCTURED_DATA_ID)?.remove();
    if (structuredData) {
      const script = document.createElement("script");
      script.id = STRUCTURED_DATA_ID;
      script.type = "application/ld+json";
      script.textContent = JSON.stringify(structuredData);
      document.head.appendChild(script);
    }

    return () => {
      document.getElementById(STRUCTURED_DATA_ID)?.remove();
    };
  }, [title, description, path, image, type, noindex, structuredData]);
}
