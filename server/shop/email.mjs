import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM = process.env.SHOP_EMAIL_FROM ?? "Sam Duckworth Photography <orders@mail.samduckworth.com>";
const INSTAGRAM_URL = process.env.SHOP_INSTAGRAM_URL ?? "https://instagram.com/sam.duckworth";
const SITE_URL = (process.env.SITE_URL ?? process.env.VITE_SITE_URL ?? "https://www.samduckworth.com").replace(/\/$/, "");

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
}[char]));

function safeUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

// What was actually ordered, in the words Sam needs when placing the
// Frameshop job — including whether it's the unframed "print only" product
// and which paper stock.
function itemFinish(item) {
  const paper = escapeHtml(String(item.paper ?? "archival_matte").replace(/_/g, " "));
  if (item.framed === false) return `print only, unframed and rolled, ${paper} paper`;
  const glazing = escapeHtml(String(item.glazing ?? "clear").replace(/_/g, " "));
  return `${item.mounted ? "mounted" : "unmounted"}, ${escapeHtml(item.colour)}, ${glazing} glass, ${paper} paper`;
}

function money(cents) {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(Number(cents ?? 0) / 100);
}

function shell(title, body) {
  const instagram = safeUrl(INSTAGRAM_URL);
  return `<!doctype html><html><body style="margin:0;background:#111;color:#eee;font-family:Arial,sans-serif"><div style="max-width:620px;margin:auto;padding:42px 24px"><p style="letter-spacing:.16em;text-transform:uppercase;color:#b99667;font-size:12px">Sam Duckworth Photography</p><h1 style="font-size:30px;line-height:1.15">${escapeHtml(title)}</h1>${body}<p style="margin-top:38px;padding-top:22px;border-top:1px solid #333;color:#999;font-size:12px;line-height:1.7">Fine-art photography · Printed to order in Australia${instagram ? `<br><a style="color:#d1ad79" href="${escapeHtml(instagram)}">Follow @sam.duckworth on Instagram</a>` : ""}</p></div></body></html>`;
}

async function send(message) {
  if (!resend) {
    console.info(`Email skipped (RESEND_API_KEY missing): ${message.subject}`);
    return { skipped: true };
  }
  return resend.emails.send({ from: FROM, ...message });
}

export async function sendOrderConfirmation(order, items) {
  const rows = items.map((item) => `<li style="margin:8px 0">${escapeHtml(item.title)} — ${escapeHtml(item.size)}, ${itemFinish(item)}</li>`).join("");
  const pickup = order.delivery_method === "pickup";
  // The pickup address is never published on the site; it is shared here, once
  // the print exists and there is a person to share it with.
  const method = pickup
    ? "<p>You chose to <strong>collect your print on the Northern Beaches</strong>. I’ll email you the pickup location and a time to suit once it’s framed and ready.</p>"
    : "<p>Your print will be dispatched with tracked delivery, and I’ll email the tracking details when it leaves.</p>";
  const discount = Number(order.discount_cents ?? 0) > 0
    ? `<p>Discount${order.discount_code ? ` (${escapeHtml(order.discount_code)})` : ""}: −${escapeHtml(money(order.discount_cents))}</p>`
    : "";
  const cutoff = new Date(order.submit_after).toLocaleString("en-AU", { timeZone: "Australia/Sydney", dateStyle: "medium", timeStyle: "short" });
  const receipt = safeUrl(order.stripe_receipt_url);
  const invoice = safeUrl(order.stripe_invoice_url) ?? safeUrl(order.stripe_invoice_pdf);
  const proof = [
    receipt ? `<a style="display:inline-block;margin:8px 10px 0 0;padding:11px 16px;border:1px solid #b99667;color:#d1ad79;text-decoration:none" href="${escapeHtml(receipt)}">View payment receipt</a>` : "",
    invoice ? `<a style="display:inline-block;margin:8px 0 0;padding:11px 16px;border:1px solid #b99667;color:#d1ad79;text-decoration:none" href="${escapeHtml(invoice)}">View paid invoice</a>` : "",
  ].join("");
  return send({
    to: order.customer_email,
    subject: `Thank you for your order — ${order.id.slice(0, 8).toUpperCase()}`,
    html: shell("Thank you for supporting my work.", `<p>Hi ${escapeHtml(order.customer_name)},</p><p>Your payment is confirmed and I’m looking forward to preparing your order.</p><ul>${rows}</ul>${discount}<p><strong>Total: ${escapeHtml(money(order.total_cents))}</strong></p>${method}<p>Your order is held until <strong>${escapeHtml(cutoff)} Sydney time</strong> in case you need to correct the address or request a cancellation.</p>${proof ? `<p>${proof}</p>` : ""}<p style="color:#aaa;font-size:13px">Order reference: ${escapeHtml(order.id.slice(0, 8).toUpperCase())}</p>`),
  });
}

export async function sendNewOrderAlert(order, items) {
  const to = process.env.SHOP_ALERT_EMAIL;
  if (!to) {
    console.error(`New order alert skipped (SHOP_ALERT_EMAIL missing): ${order.id}`);
    return { skipped: true };
  }
  const address = order.shipping_address ?? {};
  const rows = items.map((item) => `<li style="margin:8px 0">${escapeHtml(item.title)} — ${escapeHtml(item.size)}, ${itemFinish(item)}</li>`).join("");
  const adminUrl = safeUrl(`${SITE_URL}/admin`);
  const addressLines = [address.line1, address.line2, `${address.suburb ?? ""} ${address.state ?? ""} ${address.postcode ?? ""}`.trim()].filter(Boolean).map(escapeHtml).join("<br>");
  const reference = order.id.slice(0, 8).toUpperCase();
  return send({
    to,
    subject: `${order.delivery_method === "pickup" ? "New pickup order" : "New shop order"} ${reference} · ${money(order.total_cents)}`,
    html: shell("A new shop order has been paid.", `<p><strong>${escapeHtml(order.customer_name)}</strong><br>${escapeHtml(order.customer_email)}</p><ul>${rows}</ul><p><strong>${escapeHtml(money(order.total_cents))}</strong> · ${escapeHtml(order.fulfilment_provider)} fulfilment · ${order.delivery_method === "pickup" ? "collecting in person" : "tracked delivery"}</p><p>${addressLines}</p>${adminUrl ? `<p><a style="display:inline-block;padding:11px 16px;background:#b99667;color:#111;text-decoration:none" href="${escapeHtml(adminUrl)}">Open Shop Orders</a></p>` : ""}<p style="color:#aaa;font-size:13px">Order reference: ${escapeHtml(reference)}</p>`),
  });
}

export async function sendShippingNotice(order) {
  // A collected order has no carrier and no tracking number, so the dispatch
  // email becomes a "ready for collection" note instead. The pickup address is
  // shared here rather than published on the site.
  if (order.delivery_method === "pickup") {
    return send({
      to: order.customer_email,
      subject: "Your print is ready to collect",
      html: shell("Your print is ready.", `<p>Your framed print is finished and ready to collect on the Northern Beaches.</p><p>Reply to this email and I’ll share the pickup location and arrange a time that suits you.</p><p style="color:#aaa;font-size:13px">Order reference: ${escapeHtml(order.id.slice(0, 8).toUpperCase())}</p>`),
    });
  }
  const tracking = order.tracking_url
    && safeUrl(order.tracking_url)
    ? `<p><a style="color:#d1ad79" href="${escapeHtml(safeUrl(order.tracking_url))}">Track your delivery${order.tracking_number ? ` — ${escapeHtml(order.tracking_number)}` : ""}</a></p>`
    : `<p>Tracking number: ${escapeHtml(order.tracking_number || "available shortly")}</p>`;
  return send({
    to: order.customer_email,
    subject: "Your print order has shipped",
    html: shell("Your order is on the way.", `<p>Your print order has been dispatched${order.tracking_carrier ? ` with ${escapeHtml(order.tracking_carrier)}` : ""}.</p>${tracking}<p style="color:#aaa;font-size:13px">Order reference: ${escapeHtml(order.id.slice(0, 8).toUpperCase())}</p>`),
  });
}

// Sent to the BUYER, not the recipient — the buyer decides how to hand the
// voucher over. The code itself is the whole product, so it is the loudest
// thing in the email.
export async function sendGiftVoucher(voucher) {
  const shopUrl = safeUrl(`${SITE_URL}/shop`);
  const recipient = voucher.recipient_name ? `<p>For <strong>${escapeHtml(voucher.recipient_name)}</strong>.</p>` : "";
  const note = voucher.message
    ? `<p style="white-space:pre-wrap;border-left:2px solid #b99667;padding-left:14px;color:#ccc;line-height:1.7">${escapeHtml(voucher.message)}</p>`
    : "";
  return send({
    to: voucher.buyer_email,
    subject: `Your ${money(voucher.amount_cents)} gift voucher — ${voucher.code}`,
    html: shell("Your gift voucher.", `<p>Thank you — here is the voucher code to pass on.</p>${recipient}<p style="margin:26px 0;padding:20px;border:1px solid #b99667;text-align:center;font-size:26px;letter-spacing:.18em;color:#d1ad79">${escapeHtml(voucher.code)}</p><p><strong>${escapeHtml(money(voucher.amount_cents))}</strong> towards any framed print.</p>${note}<p>To redeem, choose a photograph, configure the print and enter this code in the promotion field at checkout. It can be used once, on one order, and doesn’t expire.</p>${shopUrl ? `<p><a style="display:inline-block;padding:11px 16px;border:1px solid #b99667;color:#d1ad79;text-decoration:none" href="${escapeHtml(shopUrl)}">Browse framed editions</a></p>` : ""}`),
  });
}

export async function sendFulfilmentAlert(subject, detail) {
  const to = process.env.SHOP_ALERT_EMAIL;
  if (!to) {
    console.error(`Fulfilment alert (SHOP_ALERT_EMAIL missing): ${subject} — ${detail}`);
    return { skipped: true };
  }
  return send({
    to,
    subject: `[Shop alert] ${subject}`,
    html: shell(subject, `<p>${escapeHtml(detail)}</p>`),
  });
}

export async function sendContactEnquiry({ name, email, message, context }) {
  const to = process.env.SHOP_ALERT_EMAIL ?? "hello@samduckworth.com";
  const safeContext = String(context ?? "Website enquiry").slice(0, 160);
  return send({
    to,
    replyTo: email,
    subject: `${safeContext} · ${name}`,
    html: shell("A new website enquiry.", `<p><strong>${escapeHtml(name)}</strong><br><a style="color:#d1ad79" href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></p><p style="white-space:pre-wrap;line-height:1.7">${escapeHtml(message)}</p><p style="color:#aaa;font-size:13px">Source: ${escapeHtml(safeContext)}</p>`),
  });
}
