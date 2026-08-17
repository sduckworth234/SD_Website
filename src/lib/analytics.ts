/**
 * Small, typed GA4 event layer for the photography and print-shop journeys.
 *
 * All functions intentionally no-op when gtag has not loaded (for example when
 * analytics is blocked or while rendering outside the browser). Commerce must
 * never depend on measurement succeeding.
 */

export type AnalyticsItem = {
  item_id: string;
  item_name: string;
  affiliation?: string;
  coupon?: string;
  currency?: "AUD" | string;
  discount?: number;
  index?: number;
  item_brand?: string;
  item_category?: string;
  item_category2?: string;
  item_list_id?: string;
  item_list_name?: string;
  item_variant?: string;
  location_id?: string;
  price?: number;
  quantity?: number;
};

type CommerceValue = {
  currency: "AUD" | string;
  value: number;
  items: AnalyticsItem[];
  coupon?: string;
};

export type ShopAnalyticsEvents = {
  page_view: {
    page_title?: string;
    page_location?: string;
    page_path?: string;
  };
  view_item: CommerceValue;
  select_item: {
    item_list_id?: string;
    item_list_name?: string;
    items: AnalyticsItem[];
  };
  add_to_cart: CommerceValue;
  view_cart: CommerceValue;
  begin_checkout: CommerceValue;
  add_shipping_info: CommerceValue & { shipping_tier?: string };
  purchase: CommerceValue & {
    transaction_id: string;
    shipping?: number;
    tax?: number;
  };
  product_view_changed: {
    item_id: string;
    item_name: string;
    view: "studio" | "detail";
  };
  size_guide_opened: {
    item_id?: string;
    item_name?: string;
    source?: string;
  };
  product_link_clicked: {
    item_id: string;
    item_name: string;
    source: "gallery" | "map" | "similar_images" | "shop_showcase" | string;
  };
  contact_form_opened: { source: string };
  contact_form_submitted: { source: string };
};

type Gtag = (command: "event", eventName: string, params?: Record<string, unknown>) => void;

declare global {
  interface Window {
    gtag?: Gtag;
  }
}

function gtag(): Gtag | undefined {
  if (typeof window === "undefined" || typeof window.gtag !== "function") return undefined;
  return window.gtag;
}

export function trackAnalyticsEvent<Name extends keyof ShopAnalyticsEvents>(
  name: Name,
  params: ShopAnalyticsEvents[Name],
): void {
  gtag()?.("event", name, params as Record<string, unknown>);
}

export function trackPageView(params: ShopAnalyticsEvents["page_view"] = {}): void {
  trackAnalyticsEvent("page_view", {
    page_title: typeof document === "undefined" ? undefined : document.title,
    page_location: typeof window === "undefined" ? undefined : window.location.href,
    page_path:
      typeof window === "undefined"
        ? undefined
        : `${window.location.pathname}${window.location.search}`,
    ...params,
  });
}

export const trackViewItem = (params: ShopAnalyticsEvents["view_item"]) =>
  trackAnalyticsEvent("view_item", params);

export const trackSelectItem = (params: ShopAnalyticsEvents["select_item"]) =>
  trackAnalyticsEvent("select_item", params);

export const trackAddToCart = (params: ShopAnalyticsEvents["add_to_cart"]) =>
  trackAnalyticsEvent("add_to_cart", params);

export const trackViewCart = (params: ShopAnalyticsEvents["view_cart"]) =>
  trackAnalyticsEvent("view_cart", params);

export const trackBeginCheckout = (params: ShopAnalyticsEvents["begin_checkout"]) =>
  trackAnalyticsEvent("begin_checkout", params);

export const trackAddShippingInfo = (params: ShopAnalyticsEvents["add_shipping_info"]) =>
  trackAnalyticsEvent("add_shipping_info", params);

export const trackPurchase = (params: ShopAnalyticsEvents["purchase"]) =>
  trackAnalyticsEvent("purchase", params);

export const trackProductViewChanged = (
  params: ShopAnalyticsEvents["product_view_changed"],
) => trackAnalyticsEvent("product_view_changed", params);

export const trackSizeGuideOpened = (params: ShopAnalyticsEvents["size_guide_opened"] = {}) =>
  trackAnalyticsEvent("size_guide_opened", params);

export const trackProductLinkClicked = (
  params: ShopAnalyticsEvents["product_link_clicked"],
) => trackAnalyticsEvent("product_link_clicked", params);

export const trackContactFormOpened = (params: ShopAnalyticsEvents["contact_form_opened"]) =>
  trackAnalyticsEvent("contact_form_opened", params);

export const trackContactFormSubmitted = (params: ShopAnalyticsEvents["contact_form_submitted"]) =>
  trackAnalyticsEvent("contact_form_submitted", params);
