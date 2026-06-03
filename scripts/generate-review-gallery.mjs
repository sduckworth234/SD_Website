import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative } from "node:path";
import { spawnSync } from "node:child_process";

const inputPath = process.argv[2] ?? "imports/drone-web-ready-candidates.txt";
const outputDir = process.argv[3] ?? "imports/review-drone";
const thumbDir = join(outputDir, "thumbs");
const htmlPath = join(outputDir, "index.html");

await mkdir(thumbDir, { recursive: true });

const files = (await readFile(inputPath, "utf8"))
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);

const items = [];

for (const [index, file] of files.entries()) {
  const hash = createHash("sha1").update(file).digest("hex").slice(0, 12);
  const thumbName = `${String(index + 1).padStart(3, "0")}-${hash}.jpg`;
  const thumbPath = join(thumbDir, thumbName);

  const result = spawnSync("sips", ["-s", "format", "jpeg", "-Z", "520", file, "--out", thumbPath], {
    encoding: "utf8",
  });

  if (result.status !== 0) {
    console.error(`Skipping ${file}`);
    console.error(result.stderr || result.stdout);
    continue;
  }

  items.push({
    id: hash,
    index: index + 1,
    file,
    folder: dirname(file),
    title: basename(file, extname(file)),
    thumb: relative(outputDir, thumbPath),
  });
}

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>SD Import Review</title>
    <style>
      :root {
        color: #201d19;
        background: #f3eee5;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      * { box-sizing: border-box; }
      body { margin: 0; }
      header {
        position: sticky;
        top: 0;
        z-index: 2;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 20px;
        border-bottom: 1px solid rgba(32,29,25,.16);
        background: rgba(243,238,229,.92);
        padding: 18px 24px;
        backdrop-filter: blur(16px);
      }
      h1 { margin: 0; font-family: Georgia, "Times New Roman", serif; font-size: clamp(2rem, 5vw, 4rem); font-weight: 400; }
      button {
        border: 1px solid #201d19;
        background: #201d19;
        color: #f8f6f0;
        cursor: pointer;
        padding: 12px 14px;
        text-transform: uppercase;
      }
      .meta { color: #756b5c; font-size: .82rem; text-transform: uppercase; }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        gap: 1px;
        background: rgba(32,29,25,.16);
      }
      article {
        position: relative;
        min-height: 280px;
        background: #e3d2bc;
      }
      img {
        display: block;
        width: 100%;
        height: 230px;
        object-fit: cover;
      }
      label {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 10px;
        align-items: start;
        padding: 12px;
        background: #f3eee5;
      }
      input { margin-top: 3px; }
      strong { display: block; line-height: 1.2; }
      small { display: block; color: #756b5c; line-height: 1.35; overflow-wrap: anywhere; }
      article.selected { outline: 4px solid #496d70; outline-offset: -4px; }
      textarea {
        position: fixed;
        left: -9999px;
        top: -9999px;
      }
    </style>
  </head>
  <body>
    <header>
      <div>
        <p class="meta"><span id="selected-count">0</span> selected / ${items.length} candidates</p>
        <h1>Drone import review</h1>
      </div>
      <button id="copy">Copy approved manifest</button>
    </header>
    <section class="grid">
      ${items
        .map(
          (item) => `<article data-id="${item.id}">
        <img src="${item.thumb}" alt="${escapeHtml(item.title)}" loading="lazy" />
        <label>
          <input type="checkbox" data-file="${escapeHtml(item.file)}" />
          <span>
            <strong>${item.index}. ${escapeHtml(item.title)}</strong>
            <small>${escapeHtml(item.folder.replace("/Volumes/SamD2/", ""))}</small>
          </span>
        </label>
      </article>`,
        )
        .join("\n")}
    </section>
    <textarea id="manifest"></textarea>
    <script>
      const selectedCount = document.querySelector("#selected-count");
      const manifest = document.querySelector("#manifest");
      function selectedFiles() {
        return [...document.querySelectorAll("input[type='checkbox']:checked")].map((input) => input.dataset.file);
      }
      function sync() {
        document.querySelectorAll("article").forEach((article) => {
          const checked = article.querySelector("input").checked;
          article.classList.toggle("selected", checked);
        });
        selectedCount.textContent = selectedFiles().length;
      }
      document.addEventListener("change", sync);
      document.querySelector("#copy").addEventListener("click", async () => {
        const files = selectedFiles();
        manifest.value = JSON.stringify({
          approvedAt: new Date().toISOString(),
          approvedCount: files.length,
          files
        }, null, 2);
        manifest.select();
        await navigator.clipboard.writeText(manifest.value);
        document.querySelector("#copy").textContent = "Copied";
        setTimeout(() => document.querySelector("#copy").textContent = "Copy approved manifest", 1200);
      });
    </script>
  </body>
</html>`;

await writeFile(htmlPath, html);
console.log(`Generated ${items.length} thumbnails`);
console.log(htmlPath);

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
