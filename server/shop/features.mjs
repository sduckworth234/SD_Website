function enabled(name) {
  return process.env[name] === "true";
}

// Deployment-level emergency kill switch. The authenticated admin runtime
// switch lives in site_settings; both must be on for public checkout.
export function checkoutEnabled() {
  return enabled("SHOP_CHECKOUT_ENABLED");
}

export function paidInvoicesEnabled() {
  return enabled("STRIPE_PAID_INVOICES_ENABLED");
}
