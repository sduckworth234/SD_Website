// One-off: point the public contact address at the domain mailbox.
//
// The site reads site_content.public_email at runtime, so the DEFAULT in
// src/lib/publicContent.ts only applies when that row is missing — the live
// row has to be updated too, or the old address keeps showing.
//
//   node --env-file=.env.local scripts/set-public-email.mjs
// Knobs: DRY_RUN=1 (report only), EMAIL=... (override the address).

import { createClient } from "@supabase/supabase-js";

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (use --env-file=.env.local)");
  process.exit(1);
}

const email = process.env.EMAIL ?? "hello@samduckworth.com";
const dryRun = process.env.DRY_RUN === "1";
const supabase = createClient(url, key);

const { data: current, error: readError } = await supabase
  .from("site_content")
  .select("id, public_email")
  .eq("id", 1)
  .maybeSingle();
if (readError) {
  console.error("Could not read site_content:", readError.message);
  process.exit(1);
}

if (!current) {
  console.log("No site_content row — the app is using its built-in defaults, nothing to update.");
  process.exit(0);
}
console.log(`site_content.public_email: ${current.public_email} -> ${email}`);
if (current.public_email === email) {
  console.log("Already set. Nothing to do.");
  process.exit(0);
}
if (dryRun) {
  console.log("DRY_RUN=1 — no write made.");
  process.exit(0);
}

const { error } = await supabase.from("site_content").update({ public_email: email }).eq("id", 1);
if (error) {
  console.error("Update failed:", error.message);
  process.exit(1);
}
console.log("Updated.");
