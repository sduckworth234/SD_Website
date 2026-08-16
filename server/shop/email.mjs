import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM = process.env.SHOP_EMAIL_FROM ?? "Sam Duckworth Photography <orders@samduckworth.com>";

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
}[char]));

function shell(title, body) {
  return `<!doctype html><html><body style="margin:0;background:#111;color:#eee;font-family:Arial,sans-serif"><div style="max-width:620px;margin:auto;padding:42px 24px"><p style="letter-spacing:.16em;text-transform:uppercase;color:#b99667;font-size:12px">Sam Duckworth Photography</p><h1 style="font-size:30px;line-height:1.15">${escapeHtml(title)}</h1>${body}<p style="margin-top:38px;color:#999;font-size:12px">Framed Editions · Printed to order in Australia</p></div></body></html>`;
}

async function send(message) {
  if (!resend) {
    console.info(`Email skipped (RESEND_API_KEY missing): ${message.subject}`);
    return { skipped: true };
  }
  return resend.emails.send({ from: FROM, ...message });
}

export async function sendOrderConfirmation(order, items) {
  const rows = items.map((item) => `<li style="margin:8px 0">${escapeHtml(item.title)} — ${escapeHtml(item.size)}, ${item.mounted ? "mounted" : "unmounted"}, ${escapeHtml(item.colour)}</li>`).join("");
  const cutoff = new Date(order.submit_after).toLocaleString("en-AU", { timeZone: "Australia/Sydney", dateStyle: "medium", timeStyle: "short" });
  return send({
    to: order.customer_email,
    subject: `Order received — ${order.id.slice(0, 8).toUpperCase()}`,
    html: shell("Your framed editions are reserved.", `<p>Thanks ${escapeHtml(order.customer_name)}. Payment is confirmed.</p><ul>${rows}</ul><p>Your order is held until <strong>${escapeHtml(cutoff)} Sydney time</strong> in case you need to correct the address or request a cancellation.</p>`),
  });
}

export async function sendShippingNotice(order) {
  const tracking = order.tracking_url
    ? `<p><a style="color:#d1ad79" href="${escapeHtml(order.tracking_url)}">Track your delivery${order.tracking_number ? ` — ${escapeHtml(order.tracking_number)}` : ""}</a></p>`
    : `<p>Tracking number: ${escapeHtml(order.tracking_number || "available shortly")}</p>`;
  return send({
    to: order.customer_email,
    subject: "Your framed editions have shipped",
    html: shell("Your order is on the way.", `<p>Your prints have left the Australian lab.</p>${tracking}`),
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
