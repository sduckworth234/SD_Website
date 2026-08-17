-- Typed, public-safe website identity and editorial copy. This deliberately
-- replaces duplicated hard-coded visitor content without turning the generic
-- site_settings text column into an unrestricted CMS.
create table public.site_content (
  id smallint primary key default 1 check (id = 1),
  site_name text not null default 'Sam Duckworth Photography' check (char_length(site_name) between 1 and 100),
  public_email text not null default 'samduckworthphoto@gmail.com' check (char_length(public_email) between 3 and 254),
  instagram_handle text not null default 'sam.duckworth' check (char_length(instagram_handle) between 1 and 80),
  instagram_url text not null default 'https://www.instagram.com/sam.duckworth/' check (instagram_url ~ '^https://'),
  footer_label text not null default 'SD Gallery' check (char_length(footer_label) between 1 and 100),
  hero_eyebrow text not null default 'Aerial & Landscape · Northern Beaches' check (char_length(hero_eyebrow) between 1 and 160),
  about_eyebrow text not null default 'About Me' check (char_length(about_eyebrow) between 1 and 80),
  about_heading text not null default 'Sam Duckworth' check (char_length(about_heading) between 1 and 100),
  about_intro text not null default 'Photographer and videographer, born in Manly and based on Sydney''s Northern Beaches.' check (char_length(about_intro) between 1 and 500),
  about_body text not null default 'I have been taking photographs for more than ten years. I especially enjoy aerial photography, whether I am creating work for prints, helping commercial businesses, or shooting simply because I love it.' check (char_length(about_body) between 1 and 2000),
  about_portrait_path text not null default '/about-sam.webp' check (char_length(about_portrait_path) between 1 and 500),
  contact_eyebrow text not null default 'Get in touch' check (char_length(contact_eyebrow) between 1 and 80),
  contact_heading text not null default 'Ask Sam directly.' check (char_length(contact_heading) between 1 and 140),
  contact_intro text not null default 'Commissions, prints and licensing — drop a note and Sam will get back to you.' check (char_length(contact_intro) between 1 and 600),
  contact_prompt_heading text not null default 'Let''s work together.' check (char_length(contact_prompt_heading) between 1 and 140),
  contact_prompt_body text not null default 'Commissions, prints & licensing enquiries — say hello.' check (char_length(contact_prompt_body) between 1 and 400),
  updated_at timestamptz not null default now()
);

comment on table public.site_content is
  'Singleton public-safe identity, About, contact and footer content. Public reads; verified site admins write.';

create trigger site_content_set_updated_at
  before update on public.site_content
  for each row execute function public.set_updated_at();

alter table public.site_content enable row level security;

create policy "Public can read site content"
on public.site_content for select
to anon, authenticated
using (true);

create policy "Admins can insert site content"
on public.site_content for insert
to authenticated
with check (public.is_admin());

create policy "Admins can update site content"
on public.site_content for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

grant select on public.site_content to anon;
grant select, insert, update on public.site_content to authenticated;

insert into public.site_content (id) values (1);
