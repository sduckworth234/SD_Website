-- Phone + location join the existing public_email/instagram fields on
-- site_content, so the About page and the new /work enquiry page can show a
-- complete contact block without hardcoding it in components.
alter table public.site_content
  add column if not exists public_phone text not null default '0423 638 403' check (char_length(public_phone) between 3 and 40),
  add column if not exists public_location text not null default 'Sydney, Australia' check (char_length(public_location) between 1 and 100);

comment on column public.site_content.public_phone is 'Public contact phone number, shown on About and /work.';
comment on column public.site_content.public_location is 'Public-facing location line (e.g. "Sydney, Australia"), shown on About and /work.';

-- site_content has a table-level (not column-restricted) SELECT grant, so no
-- additional grant is needed for these new columns.
