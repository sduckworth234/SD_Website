import { sendContactEnquiry } from "../server/shop/email.mjs";
import { json, methodAllowed, readJson, safeError } from "../server/shop/http.mjs";

const attempts = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function clean(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function requester(req) {
  return String(req.headers["x-forwarded-for"] ?? req.socket?.remoteAddress ?? "unknown")
    .split(",")[0]
    .trim();
}

function rateLimited(req) {
  const now = Date.now();
  const key = requester(req);
  const recent = (attempts.get(key) ?? []).filter((time) => now - time < WINDOW_MS);
  recent.push(now);
  attempts.set(key, recent);
  return recent.length > MAX_ATTEMPTS;
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const requestHost = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "").split(",")[0].trim();
    return Boolean(requestHost) && new URL(origin).host === requestHost;
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  if (!methodAllowed(req, res, ["POST"])) return;
  try {
    if (!sameOrigin(req)) return json(res, 403, { error: "This request could not be verified." });
    if (rateLimited(req)) return json(res, 429, { error: "Please wait a few minutes before sending another message." });

    const body = await readJson(req, 20_000);
    // A hidden field catches basic form bots without revealing the check.
    if (clean(body.website, 200)) return json(res, 200, { ok: true });

    const name = clean(body.name, 80);
    const email = clean(body.email, 254).toLowerCase();
    const message = clean(body.message, 5_000);
    const context = clean(body.context, 160) || "Website enquiry";

    if (name.length < 2) return json(res, 400, { error: "Please enter your name." });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(res, 400, { error: "Please enter a valid email address." });
    if (message.length < 10) return json(res, 400, { error: "Please add a little more detail to your message." });

    const result = await sendContactEnquiry({ name, email, message, context });
    if (result?.skipped) return json(res, 503, { error: "Email is temporarily unavailable. Please try again shortly." });
    if (result?.error) throw new Error(result.error.message ?? "Email delivery failed.");
    return json(res, 200, { ok: true });
  } catch (error) {
    console.error("contact:", safeError(error));
    return json(res, 500, { error: "Your message could not be sent. Please try again." });
  }
}
