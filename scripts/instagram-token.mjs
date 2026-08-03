// One-time helper: turn the SHORT-LIVED token from the Meta App Dashboard into
// the LONG-LIVED one the site actually runs on, and check it works.
//
// Meta's dashboard hands you a token that dies in about an hour. This swaps it
// for a 60-day token, confirms it can read your account, and prints exactly what
// to paste into Vercel. After that the sync job keeps it alive on its own and
// you shouldn't need this again.
//
// Usage:
//   node scripts/instagram-token.mjs <SHORT_LIVED_TOKEN> <APP_SECRET>
//
// Both values come from the Meta App Dashboard — see CLAUDE.md for where.

const [shortToken, appSecret] = process.argv.slice(2);

if (!shortToken || !appSecret) {
  console.error(`
Usage: node scripts/instagram-token.mjs <SHORT_LIVED_TOKEN> <APP_SECRET>

  SHORT_LIVED_TOKEN  Meta App Dashboard -> Instagram -> API setup with Instagram
                     login -> "Generate token" next to @sam.duckworth
  APP_SECRET         Same app -> App settings -> Basic -> App secret ("Show")
`);
  process.exit(1);
}

const GRAPH = "https://graph.instagram.com";

const exchangeUrl =
  `${GRAPH}/access_token?grant_type=ig_exchange_token` +
  `&client_secret=${encodeURIComponent(appSecret)}` +
  `&access_token=${encodeURIComponent(shortToken)}`;

const res = await fetch(exchangeUrl);
const data = await res.json();

if (!res.ok || !data.access_token) {
  console.error("\nCould not exchange the token. Instagram said:\n");
  console.error(JSON.stringify(data, null, 2));
  console.error(`
Most likely causes:
  - the short-lived token has already expired (they last ~1 hour) — generate a fresh one
  - the app secret belongs to a different app
  - @sam.duckworth isn't connected to this app yet
`);
  process.exit(1);
}

const days = data.expires_in ? Math.round(data.expires_in / 86400) : "~60";

// Prove it actually works before telling anyone to rely on it.
const meRes = await fetch(`${GRAPH}/me?fields=username,account_type,media_count&access_token=${encodeURIComponent(data.access_token)}`);
const me = await meRes.json();

console.log(`\n✅ Long-lived token created — valid for ${days} days.\n`);
if (meRes.ok) {
  console.log(`   Account:  @${me.username}`);
  console.log(`   Type:     ${me.account_type}`);
  console.log(`   Posts:    ${me.media_count}\n`);
  if (me.account_type && !String(me.account_type).toUpperCase().includes("BUSINESS")
      && !String(me.account_type).toUpperCase().includes("CREATOR")) {
    console.log(`   ⚠️  Account type is "${me.account_type}". The feed API needs Business or Creator.\n`);
  }
} else {
  console.log(`   (Could not read the account back: ${JSON.stringify(me)})\n`);
}

console.log("Add these to Vercel -> Settings -> Environment Variables:\n");
console.log(`  INSTAGRAM_TOKEN   ${data.access_token}`);
console.log(`  CRON_SECRET       ${crypto.randomUUID()}   (any random string; locks the sync endpoint)\n`);
console.log("The app secret is NOT needed on Vercel — it's only used here, once.");
console.log("Rotate it whenever you like (App settings -> Basic -> Reset app secret).\n");
console.log("Then redeploy, and hit /api/instagram-sync once to fill the feed.\n");
