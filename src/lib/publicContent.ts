import { useEffect, useState } from "react";
import { supabase } from "./supabase";

export type PublicContent = {
  siteName: string;
  publicEmail: string;
  instagramHandle: string;
  instagramUrl: string;
  footerLabel: string;
  heroEyebrow: string;
  aboutEyebrow: string;
  aboutHeading: string;
  aboutIntro: string;
  aboutBody: string;
  aboutPortraitPath: string;
  contactEyebrow: string;
  contactHeading: string;
  contactIntro: string;
  contactPromptHeading: string;
  contactPromptBody: string;
};

export const DEFAULT_PUBLIC_CONTENT: PublicContent = {
  siteName: "Sam Duckworth Photography",
  publicEmail: "samduckworthphoto@gmail.com",
  instagramHandle: "sam.duckworth",
  instagramUrl: "https://www.instagram.com/sam.duckworth/",
  footerLabel: "SD Gallery",
  heroEyebrow: "Aerial & Landscape · Northern Beaches",
  aboutEyebrow: "About Me",
  aboutHeading: "Sam Duckworth",
  aboutIntro: "Photographer and videographer, born in Manly and based on Sydney's Northern Beaches.",
  aboutBody: "I have been taking photographs for more than ten years. I especially enjoy aerial photography, whether I am creating work for prints, helping commercial businesses, or shooting simply because I love it.",
  aboutPortraitPath: "/about-sam.webp",
  contactEyebrow: "Get in touch",
  contactHeading: "Contact me directly.",
  contactIntro: "Commissions, prints and licensing — drop me a note and I’ll get back to you.",
  contactPromptHeading: "Let's work together.",
  contactPromptBody: "Commissions, prints & licensing enquiries — say hello.",
};

type ContentRow = {
  site_name: string;
  public_email: string;
  instagram_handle: string;
  instagram_url: string;
  footer_label: string;
  hero_eyebrow: string;
  about_eyebrow: string;
  about_heading: string;
  about_intro: string;
  about_body: string;
  about_portrait_path: string;
  contact_eyebrow: string;
  contact_heading: string;
  contact_intro: string;
  contact_prompt_heading: string;
  contact_prompt_body: string;
};

function mapRow(row: ContentRow): PublicContent {
  return {
    siteName: row.site_name,
    publicEmail: row.public_email,
    instagramHandle: row.instagram_handle,
    instagramUrl: row.instagram_url,
    footerLabel: row.footer_label,
    heroEyebrow: row.hero_eyebrow,
    aboutEyebrow: row.about_eyebrow,
    aboutHeading: row.about_heading,
    aboutIntro: row.about_intro,
    aboutBody: row.about_body,
    aboutPortraitPath: row.about_portrait_path,
    contactEyebrow: row.contact_eyebrow,
    contactHeading: row.contact_heading,
    contactIntro: row.contact_intro,
    contactPromptHeading: row.contact_prompt_heading,
    contactPromptBody: row.contact_prompt_body,
  };
}

function toRow(content: PublicContent): ContentRow & { id: number } {
  return {
    id: 1,
    site_name: content.siteName.trim(),
    public_email: content.publicEmail.trim(),
    instagram_handle: content.instagramHandle.trim().replace(/^@/, ""),
    instagram_url: content.instagramUrl.trim(),
    footer_label: content.footerLabel.trim(),
    hero_eyebrow: content.heroEyebrow.trim(),
    about_eyebrow: content.aboutEyebrow.trim(),
    about_heading: content.aboutHeading.trim(),
    about_intro: content.aboutIntro.trim(),
    about_body: content.aboutBody.trim(),
    about_portrait_path: content.aboutPortraitPath.trim(),
    contact_eyebrow: content.contactEyebrow.trim(),
    contact_heading: content.contactHeading.trim(),
    contact_intro: content.contactIntro.trim(),
    contact_prompt_heading: content.contactPromptHeading.trim(),
    contact_prompt_body: content.contactPromptBody.trim(),
  };
}

let contentRequest: Promise<PublicContent> | null = null;

export async function getPublicContent() {
  if (!supabase) return DEFAULT_PUBLIC_CONTENT;
  if (!contentRequest) {
    contentRequest = (async () => {
      const { data, error } = await supabase
        .from("site_content")
        .select("site_name,public_email,instagram_handle,instagram_url,footer_label,hero_eyebrow,about_eyebrow,about_heading,about_intro,about_body,about_portrait_path,contact_eyebrow,contact_heading,contact_intro,contact_prompt_heading,contact_prompt_body")
        .eq("id", 1)
        .maybeSingle();
      if (error || !data) return DEFAULT_PUBLIC_CONTENT;
      return mapRow(data as ContentRow);
    })();
  }
  return contentRequest ?? DEFAULT_PUBLIC_CONTENT;
}

export async function savePublicContent(content: PublicContent) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.from("site_content").upsert(toRow(content), { onConflict: "id" }).select().single();
  if (error) throw error;
  const saved = mapRow(data as ContentRow);
  contentRequest = Promise.resolve(saved);
  window.dispatchEvent(new CustomEvent("sd-public-content", { detail: saved }));
  return saved;
}

export function usePublicContent() {
  const [content, setContent] = useState(DEFAULT_PUBLIC_CONTENT);

  useEffect(() => {
    let active = true;
    getPublicContent().then((next) => { if (active) setContent(next); });
    const onUpdate = (event: Event) => setContent((event as CustomEvent<PublicContent>).detail);
    window.addEventListener("sd-public-content", onUpdate);
    return () => {
      active = false;
      window.removeEventListener("sd-public-content", onUpdate);
    };
  }, []);

  return content;
}
