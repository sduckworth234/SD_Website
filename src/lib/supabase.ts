import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const hasSupabaseEnv = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = hasSupabaseEnv
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

export function getTransformedPublicUrl(
  bucket: string,
  path: string,
  width = 1400,
  quality = 72,
) {
  if (!supabase) return "";

  const { data } = supabase.storage.from(bucket).getPublicUrl(path, {
    transform: {
      width,
      quality,
      resize: "cover",
    },
  });

  return data.publicUrl;
}
