export function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

export function methodAllowed(req, res, methods) {
  if (methods.includes(req.method)) return true;
  res.setHeader("Allow", methods.join(", "));
  json(res, 405, { error: "method_not_allowed" });
  return false;
}

export async function rawBody(req, maxBytes = 1_000_000) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") return Buffer.from(req.body);
  if (req.body && typeof req.body === "object") return Buffer.from(JSON.stringify(req.body));
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function readJson(req, maxBytes = 100_000) {
  if (req.body && !Buffer.isBuffer(req.body) && typeof req.body === "object") return req.body;
  const body = await rawBody(req, maxBytes);
  if (!body.length) return {};
  return JSON.parse(body.toString("utf8"));
}

export function publicOrigin(req) {
  const configured = process.env.SITE_URL ?? process.env.VITE_SITE_URL;
  if (configured) return configured.replace(/\/$/, "");
  const host = req.headers["x-forwarded-host"] ?? req.headers.host;
  const proto = req.headers["x-forwarded-proto"] ?? "https";
  return `${proto}://${host}`;
}

export function safeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/(sk_(?:test|live)_[A-Za-z0-9]+)/g, "[redacted]").slice(0, 500);
}
