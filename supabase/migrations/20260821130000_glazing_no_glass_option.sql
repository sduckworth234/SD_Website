-- Adds "No Glass" as a real, selectable glazing option — verified live
-- against frameshop.com.au: with glass-type=none on a 103RO A2 frame, the
-- price breakdown drops the glass line entirely (frame [+ mat if mounted]
-- cost only, e.g. $100.50 unmounted / $144.30 mounted, matching
-- print_pricing_components exactly with a $0 glass contribution). So
-- cost_multiplier for this option is 0 — see printCatalogue.ts / catalogue.mjs.

alter table public.print_pricing_glazing
  drop constraint print_pricing_glazing_id_check,
  add constraint print_pricing_glazing_id_check
    check (id in ('clear', 'non_reflective', 'perspex', 'uv_clear', 'uv_non_reflective', 'none'));

-- Glazing (unlike colour) can legitimately cost nothing — an empty frame.
alter table public.print_pricing_glazing
  drop constraint print_pricing_glazing_cost_multiplier_check,
  add constraint print_pricing_glazing_cost_multiplier_check
    check (cost_multiplier >= 0);

insert into public.print_pricing_glazing (id, label, description, cost_multiplier) values
  ('none', 'No Glass', 'An empty frame with no glazing — for canvas or already-protected artwork.', 0.000)
on conflict (id) do nothing;

alter table public.order_items
  drop constraint order_items_glazing_check,
  add constraint order_items_glazing_check
    check (glazing in ('clear', 'non_reflective', 'perspex', 'uv_clear', 'uv_non_reflective', 'none'));
