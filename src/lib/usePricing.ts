// Live pricing lands asynchronously (fetchPricingSettings in supabase.ts) and
// is stored in a plain module variable inside printCatalogue.ts, which is kept
// framework-free so scripts/pricing-parity.mjs can import it from plain Node.
// This is the React side of that store: subscribe here and any component that
// renders a price re-renders when the live tables arrive, instead of showing
// the fallback price for the rest of the session.
import { useSyncExternalStore } from "react";
import { pricingSnapshot, subscribePricing } from "./printCatalogue";

/** Returns a counter that changes whenever active pricing changes. Depend on
 * it (directly or via a useMemo dep) anywhere a price is computed. */
export function usePricingVersion(): number {
  return useSyncExternalStore(subscribePricing, pricingSnapshot, pricingSnapshot);
}
