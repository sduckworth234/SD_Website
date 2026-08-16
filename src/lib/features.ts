// Deployment-level kill switch for every public shop surface. Vite only
// exposes VITE_ variables, so this contains no secret. Missing/unknown values
// are deliberately false: merging the shop code cannot open it in production.
export const SHOP_FEATURE_ENABLED = import.meta.env.VITE_SHOP_ENABLED === "true";
