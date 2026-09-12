/*
 * build.js - turns src/<game>.js into www/<game>/index.html, bundle, CSS and
 * favicon inlined, so a built game is one file.
 *
 * The HTML is tools/tpl/, plain files with {{name}} holes, out of `deno fmt`
 * because a hole is not valid in most of the places one sits. Their <style> and
 * <script> are minified on the way in, so their comments do not ship.
 *
 * Each game's `meta` comes from importing the module under Deno, which works
 * only while game modules have no side effects. Keep it that way.
 *
 *   deno run -A tools/build.js            # every game, plus the gallery
 *   deno run -A tools/build.js wow trap   # just these
 */

import { theme } from "../src/lib/overlay.js";

const SRC = new URL("../src/", import.meta.url);
const WWW = new URL("../www/", import.meta.url);
const MEDIA = new URL("../media/", import.meta.url);
const BASE = "https://one.fserb.com";

// The gallery's own colours, and what a game gets when meta leaves them out.
const SITE = { bg: "#f2f0e5", fg: "#212123" };

const src = (name) => new URL(name, SRC).href;

const tpl = (name) =>
  Deno.readTextFile(new URL(`tpl/${name}.html`, import.meta.url));

// It reads a file and writes one, so both callers hand it a temp directory.
async function esbuild(entry, out) {
  const cmd = new Deno.Command("deno", {
    args: [
      "bundle",
      "--platform=browser",
      "--format=esm",
      "--minify",
      "-o",
      out,
      entry,
    ],
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stderr } = await cmd.output();
  if (code !== 0) throw new Error(new TextDecoder().decode(stderr));
}

// The extension is what tells esbuild whether it is reading CSS or JavaScript.
async function press(code, ext) {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${dir}/in.${ext}`, code);
    await esbuild(`${dir}/in.${ext}`, `${dir}/out.${ext}`);
    return (await Deno.readTextFile(`${dir}/out.${ext}`)).trim();
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

const BLOCK = /(<(style|script)\b[^>]*>)([\s\S]*?)(<\/\2>)/g;

// A block that is nothing but a hole is left alone: {{script}} is not
// JavaScript until the bundle fills it, and that comes out of esbuild already.
async function squeeze(html) {
  const out = [];
  let at = 0;
  for (const m of html.matchAll(BLOCK)) {
    const [whole, open, tag, body, close] = m;
    if (/^\{\{\w+\}\}$/.test(body.trim())) continue;
    const ext = tag === "style" ? "css" : "js";
    out.push(html.slice(at, m.index), open, await press(body, ext), close);
    at = m.index + whole.length;
  }
  out.push(html.slice(at));
  return out.join("");
}

const TEMPLATE = {
  game: await squeeze(await tpl("game")),
  gallery: await squeeze(await tpl("gallery")),
  card: (await tpl("card")).trimEnd(), // joined with newlines, so no trailing
};

// One pass, so a value containing {{...}} itself is left alone.
function fill(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, name) => {
    if (!(name in vars)) throw new Error(`template has no ${name}`);
    return vars[name];
  });
}

// Files under src/ that are not games.
const NOT_GAMES = new Set(["alma", "lib"]);

async function games() {
  const out = [];
  for await (const e of Deno.readDir(SRC)) {
    if (!e.isFile || !e.name.endsWith(".js")) continue;
    const name = e.name.slice(0, -3);
    if (NOT_GAMES.has(name) || name.startsWith("_")) continue;
    out.push(name);
  }
  return out.sort();
}

async function meta(game) {
  const mod = await import(src(`${game}.js`));
  if (!mod.meta) throw new Error(`src/${game}.js has no "meta" export`);
  return { title: game, desc: "", ...SITE, ...mod.meta };
}

async function bundle(game) {
  const dir = await Deno.makeTempDir();
  const entry = `${dir}/entry.js`;
  await Deno.writeTextFile(
    entry,
    `import * as game from "${src(`${game}.js`)}";\n` +
      `import { run } from "${src("lib/one.js")}";\n` +
      `run(game);\n`,
  );

  try {
    await esbuild(entry, `${dir}/out.js`);
    const js = await Deno.readTextFile(`${dir}/out.js`);
    // A "</script" anywhere in a string literal would end the tag early.
    return js.replaceAll("</script", "<\\/script");
  } catch (e) {
    throw new Error(`bundling ${game} failed:\n${e.message}`);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

async function exists(url) {
  try {
    await Deno.stat(url);
    return true;
  } catch {
    return false;
  }
}

// What `./task media <game>` left, keyed by extension.
async function shot(game) {
  const out = {};
  for (const ext of ["mp4", "gif", "png"]) {
    const from = new URL(`${game}/card.${ext}`, MEDIA);
    if (await exists(from)) out[ext] = from;
  }
  return out;
}

// Copied, not inlined: a base64 video in the gallery HTML would be read whole
// before anything drew.
async function copyShot(game, s) {
  if (Object.keys(s).length === 0) return;
  await Deno.mkdir(new URL(`${game}/`, WWW), { recursive: true });
  for (const [ext, from] of Object.entries(s)) {
    await Deno.copyFile(from, new URL(`${game}/card.${ext}`, WWW));
  }
}

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

// A disc with a round-capped bar cut out of the bottom, reading as an "n".
// Measured off icon.png and normalised from its 512 box to 32.
function favicon(m) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">` +
    `<rect width="32" height="32" fill="${m.bg}"/>` +
    `<circle cx="16" cy="16" r="11.3" fill="${m.fg}"/>` +
    `<path d="M16 16.2V32" stroke="${m.bg}" stroke-width="6.1" ` +
    `stroke-linecap="round"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function page(game, m, js, s) {
  // The templates have no conditionals, so an absent image is an empty hole.
  const image = s.png
    ? `<meta property="og:image" content="${BASE}/${game}/card.png">`
    : "";
  return fill(TEMPLATE.game, {
    title: esc(m.title),
    desc: esc(m.desc.trim().replace(/\s*\n\s*/g, " ")),
    url: `${BASE}/${game}/`,
    bg: m.bg,
    icon: favicon(m),
    image,
    script: js,
  });
}

function gallery(entries) {
  const cards = entries.map(([game, m, s]) =>
    fill(TEMPLATE.card, {
      game,
      title: esc(m.title),
      year: esc((m.date ?? "").slice(0, 4)),
      bg: m.bg,
      // The panel fill and not the panel text: the title sits straight on the
      // clip with no panel behind it.
      ink: theme(m).bg,
      media: s.mp4
        ? `<video src="./${game}/card.mp4"${
          s.png ? ` poster="./${game}/card.png"` : ""
        } loop muted playsinline preload="none"></video>`
        : "",
    })
  ).join("\n");

  return fill(TEMPLATE.gallery, {
    url: `${BASE}/`,
    icon: favicon(SITE),
    cards,
  });
}

async function build(game) {
  const m = await meta(game);
  // A draft builds for its size and nothing else: the page is never written,
  // and a game that became a draft after shipping loses the old one.
  const js = await bundle(game);
  const html = page(game, m, js, await shot(game));
  if (m.draft) {
    await Deno.remove(new URL(`${game}/`, WWW), { recursive: true }).catch(
      () => {},
    );
  } else {
    await Deno.mkdir(new URL(`${game}/`, WWW), { recursive: true });
    await Deno.writeTextFile(new URL(`${game}/index.html`, WWW), html);
  }
  const raw = new Blob([html]).size;
  console.log(
    `  ${game.padEnd(12)} ${kb(raw).padStart(10)}${m.draft ? "  draft" : ""}`,
  );
  return [game, m];
}

const wanted = Deno.args.length > 0 ? Deno.args : await games();
const entries = [];
for (const game of wanted) entries.push(await build(game));

// Every game, not only the ones just rebuilt. Drafts do not count.
const all = [];
for (const game of await games()) {
  const found = entries.find(([g]) => g === game);
  const entry = found ?? [game, await meta(game)];
  if (entry[1].draft) continue;
  const s = await shot(game);
  await copyShot(game, s);
  all.push([...entry, s]);
}
// Newest first; undated games fall to the end, alphabetically.
all.sort(([ga, a], [gb, b]) =>
  (b.date ?? "").localeCompare(a.date ?? "") || ga.localeCompare(gb)
);

await Deno.mkdir(WWW, { recursive: true });
await Deno.writeTextFile(new URL("index.html", WWW), gallery(all));
console.log(`  ${"index".padEnd(12)} ${all.length} games`);
