function enabled(name) {
  return process.env[name] === "true";
}

// Separate server gates keep taking payment and sending work to Prodigi as two
// explicit production decisions. Both default off when the env var is absent.
export function checkoutEnabled() {
  return enabled("SHOP_CHECKOUT_ENABLED");
}

export function fulfilmentEnabled() {
  return enabled("SHOP_FULFILMENT_ENABLED");
}
