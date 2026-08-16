function enabled(name) {
  return process.env[name] === "true";
}

// Checkout and fulfilment are deliberately independent. Manual fulfilment is
// the safe default: a missing/misspelled environment value must never submit a
// paid order to an external printer.
export function checkoutEnabled() {
  return enabled("SHOP_CHECKOUT_ENABLED");
}

export function fulfilmentProvider() {
  return process.env.SHOP_FULFILMENT_PROVIDER?.trim().toLowerCase() === "prodigi"
    ? "prodigi"
    : "manual";
}

// Kept as a small compatibility helper for the API/UI. It now means precisely
// "automatic Prodigi submission is active", not that orders can be fulfilled.
export function fulfilmentEnabled() {
  return fulfilmentProvider() === "prodigi";
}

export function paidInvoicesEnabled() {
  return enabled("STRIPE_PAID_INVOICES_ENABLED");
}
