// The two ways a print can reach its buyer. Both are ordinary Stripe
// shipping_options on the Checkout Session, so Stripe owns the arithmetic and
// the customer's choice comes back on the paid session — we never trust a
// browser-supplied delivery method.
//
// The pickup address is deliberately NOT published anywhere: the rate name
// says "Northern Beaches", and the exact location is emailed once the print is
// ready. The rate's metadata is the machine-readable half; display_name is the
// human half, and the metadata is what fulfilment code reads.

export const DELIVERY_LABEL = "Tracked delivery within Australia";
export const PICKUP_LABEL = "Collect from the Northern Beaches (free)";

export function shippingOptionsFor(deliveryCents) {
  return [
    {
      shipping_rate_data: {
        type: "fixed_amount",
        fixed_amount: { amount: deliveryCents, currency: "aud" },
        display_name: DELIVERY_LABEL,
        metadata: { delivery_method: "delivery" },
        delivery_estimate: {
          minimum: { unit: "business_day", value: 3 },
          maximum: { unit: "business_day", value: 8 },
        },
      },
    },
    {
      shipping_rate_data: {
        type: "fixed_amount",
        fixed_amount: { amount: 0, currency: "aud" },
        display_name: PICKUP_LABEL,
        metadata: { delivery_method: "pickup" },
        delivery_estimate: {
          minimum: { unit: "business_day", value: 2 },
          maximum: { unit: "business_day", value: 7 },
        },
      },
    },
  ];
}

// Read the method the customer actually paid for. Retrieve the session with
// expand: ["shipping_cost.shipping_rate"] so the rate object (and its
// metadata) is present; anything unrecognised falls back to delivery, which is
// the safe assumption — an order posted by mistake is recoverable, a print
// that silently waits on a shelf is not.
export function deliveryMethodFromSession(session) {
  const rate = session?.shipping_cost?.shipping_rate;
  if (rate && typeof rate === "object") {
    if (rate.metadata?.delivery_method === "pickup") return "pickup";
    if (rate.display_name === PICKUP_LABEL) return "pickup";
  }
  return "delivery";
}

export function isPickup(order) {
  return order?.delivery_method === "pickup";
}
