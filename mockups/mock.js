// Shared helpers for the design mockups. Real photos, real metadata — the same
// Supabase transform CDN the live site uses, so what you see is what ships.
export const BASE =
  "https://krixuiimabosiorzxzju.supabase.co/storage/v1/render/image/public/photos/";

export const img = (photo, width, quality = 74) =>
  `${BASE}${photo.path}?width=${width}&resize=contain&quality=${quality}`;

export const srcset = (photo, widths) =>
  widths.map((w) => `${img(photo, w)} ${w}w`).join(", ");

let cache = null;
export async function photos() {
  if (!cache) cache = await fetch("./photos.json").then((r) => r.json());
  return cache;
}

export const byAspect = (rows, ...kinds) =>
  rows.filter((p) => kinds.includes(p.aspect));

export const byLocation = (rows, name) =>
  rows.filter((p) => p.location === name);

export const locations = (rows) => {
  const seen = new Map();
  for (const p of rows) {
    if (!seen.has(p.location)) seen.set(p.location, { name: p.location, region: p.region, count: 0, cover: p });
    seen.get(p.location).count += 1;
  }
  return [...seen.values()].sort((a, b) => b.count - a.count);
};

// Reveal-on-scroll, matching the live site's easing but leaner.
export function reveal(selector = "[data-reveal]", { threshold = 0.12 } = {}) {
  const els = document.querySelectorAll(selector);
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    els.forEach((el) => el.classList.add("in"));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add("in");
          io.unobserve(e.target);
        }
      });
    },
    { threshold, rootMargin: "0px 0px -8% 0px" },
  );
  els.forEach((el) => io.observe(el));
}

// The concept switcher pinned to every mockup so you can flick between them.
export function switcher(current) {
  const all = [
    ["salt", "01 Salt"],
    ["darkroom", "02 Darkroom"],
    ["atlas", "03 Atlas"],
    ["horizon", "04 Horizon"],
    ["prism", "05 Prism"],
  ];
  const el = document.createElement("nav");
  el.className = "mock-switch";
  el.innerHTML =
    `<a class="ms-home" href="./index.html">◀ All</a>` +
    all
      .map(
        ([slug, label]) =>
          `<a href="./${slug}.html" class="${slug === current ? "on" : ""}">${label}</a>`,
      )
      .join("");
  document.body.appendChild(el);
}
