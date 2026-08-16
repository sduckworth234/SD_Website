function enabled(name) {
  return process.env[name] === "true";
}

// Separate server gates keep public payment and sending work to Prodigi as two
// explicit production decisions. Both default off when the env var is absent.
// create-checkout-session may separately admit a verified admin for testing;
// Prodigi fulfilment never bypasses its gate.
export function checkoutEnabled() {
  return enabled("SHOP_CHECKOUT_ENABLED");
}

export function fulfilmentEnabled() {
  return enabled("SHOP_FULFILMENT_ENABLED");
}
