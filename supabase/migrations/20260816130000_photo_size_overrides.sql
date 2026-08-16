-- Manual per-size sale overrides, admin-curated. Complements the computed
-- max_sellable_mounted/max_sellable_unmounted (20260816020000): those are
-- always DPI-derived from the best available source file, but Sam sometimes
-- knows better than the formula — a marginal-DPI print that looks fine in
-- hand, or one he simply doesn't want to offer at A1 regardless of
-- resolution. size_overrides is the admin's input; sellable_sizes is the
-- derived, PUBLIC-safe merge of computed + override that the shop UI and
-- checkout enforcement actually read, so there's exactly one source of
-- truth for "can this photo be sold at this size" everywhere in the app.
--
-- size_overrides shape: {"A5":{"unmounted":true|false,"mounted":true|false},
-- "A4":{...}, ...}. A present true/false forces that size on/off; an absent
-- key (or the whole column null) means "use the computed value". Admin-only
-- — read via the get_admin_photos() RPC, which bypasses column grants, so no
-- explicit grant is needed here (same as raw_source_path).
--
-- sellable_sizes shape: {"A5":{"unmounted":bool,"mounted":bool}, ...} for
-- all five sizes — the fully resolved, ready-to-use per-SKU availability.
-- Recomputed by the admin client (src/lib/printCatalogue.ts's
-- computeSellableSizes) whenever raw/source dims or size_overrides change,
-- using the same formula server/shop/printSizing.mjs uses for checkout
-- enforcement, so the two can't drift.
alter table public.photos
  add column if not exists size_overrides jsonb,
  add column if not exists sellable_sizes jsonb;

comment on column public.photos.size_overrides is
  'Admin per-size/mount sale overrides: {"A5":{"unmounted":true|false,"mounted":true|false},...}. Absent key or column = use the computed value. Admin-only, read via get_admin_photos().';
comment on column public.photos.sellable_sizes is
  'Derived, public-safe per-size/mount availability (computed resolution merged with size_overrides): {"A5":{"unmounted":bool,"mounted":bool},...}. This is what the shop UI and checkout enforcement read — not raw dimensions.';

grant select (sellable_sizes) on public.photos to anon;
