-- Runtime shop controls. Deployment variables remain emergency capability
-- gates, while authenticated admin changes take effect immediately here.
-- Missing/invalid provider values always resolve to manual in server code.
insert into public.site_settings (key, enabled, value, label) values
  ('shop_fulfilment_provider', true, 'manual', 'Shop — fulfilment provider')
on conflict (key) do update
set label = excluded.label,
    value = case
      when public.site_settings.value = 'prodigi' then 'prodigi'
      else 'manual'
    end;

comment on table public.site_settings is
  'Public-safe site switches and small settings. Shop runtime controls are admin-written; server code treats missing provider state as manual.';
