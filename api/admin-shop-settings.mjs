import { checkoutEnabled } from "../server/shop/features.mjs";
import { json, methodAllowed, readJson, safeError } from "../server/shop/http.mjs";
import { prodigiConfigured } from "../server/shop/prodigi.mjs";
import {
  requireAdmin,
  setShopRuntimeEnabled,
  setShopRuntimeFulfilmentProvider,
  shopRuntimeConfig,
} from "../server/shop/supabase.mjs";

function publicCapabilityEnabled() {
  return process.env.VITE_SHOP_ENABLED === "true" && checkoutEnabled();
}

async function responseState() {
  const runtime = await shopRuntimeConfig();
  return {
    shopEnabled: runtime.shopEnabled,
    fulfilmentProvider: runtime.fulfilmentProvider,
    publicCapabilityEnabled: publicCapabilityEnabled(),
    prodigiConfigured: prodigiConfigured(),
  };
}

export default async function handler(req, res) {
  if (!methodAllowed(req, res, ["GET", "POST"])) return;
  try {
    const admin = await requireAdmin(req);
    if (!admin) return json(res, 401, { error: "unauthorized" });
    if (req.method === "GET") return json(res, 200, await responseState());

    const body = await readJson(req);
    if (body.action === "set_shop_enabled") {
      if (typeof body.enabled !== "boolean") return json(res, 400, { error: "Shop enabled state must be true or false." });
      if (body.enabled && !publicCapabilityEnabled()) {
        return json(res, 409, { error: "The deployment shop capability is disabled. Enable VITE_SHOP_ENABLED and SHOP_CHECKOUT_ENABLED, then redeploy once." });
      }
      await setShopRuntimeEnabled(body.enabled);
      return json(res, 200, await responseState());
    }

    if (body.action === "set_fulfilment_provider") {
      const provider = body.provider === "prodigi" ? "prodigi" : body.provider === "manual" ? "manual" : null;
      if (!provider) return json(res, 400, { error: "Fulfilment provider must be manual or prodigi." });
      if (provider === "prodigi" && !prodigiConfigured()) {
        return json(res, 409, { error: "Prodigi cannot be enabled until its API key is configured in Production." });
      }
      await setShopRuntimeFulfilmentProvider(provider);
      return json(res, 200, await responseState());
    }

    return json(res, 400, { error: "Unknown shop setting action." });
  } catch (error) {
    const message = safeError(error);
    console.error("admin shop settings:", message);
    return json(res, 500, { error: message });
  }
}
