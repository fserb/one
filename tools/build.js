/*
 * build.js - turns src/<game>.js into www/<game>/index.html.
 *
 * Every page is self-contained: bundle, CSS and favicon inlined, so a built
 * game is one file. `deno bundle` (esbuild) tree-shakes, so a game only pays
 * for the parts of alma it imports.
 *
 * The HTML is tools/tpl/, plain files with {{name}} holes. They are out of
 * `deno fmt`, which rewrites {{bg}} inside a stylesheet into a nested block.
 *
 * The gallery reads each game's `meta` by importing the module under Deno.
 * That works only while game modules have no side effects. Keep it that way.
 *
 * `meta.draft: true` keeps a game out of www/ entirely, and deletes any page a
 * previous build left. Play it with dev.html.
 *
 * media/<game>/card.mp4/.gif/.png are optional, from `./task media <game>`.
 * They become the moving gallery card and the page's og:image; a game without
 * them gets the flat colour card.
 *
 *   deno run -A tools/build.js            # every game, plus the gallery
 *   deno run -A tools/build.js wow trap   # just these
 */

const SRC = new URL("../src/", import.meta.url);
const WWW = new URL("../www/", import.meta.url);
const MEDIA = new URL("../media/", import.meta.url);
const BASE = "https://one.fserb.com";

// The gallery's own colours, and what a game gets when meta leaves them out.
const SITE = { bg: "#f2f0e5", fg: "#212123" };

const src = (name) => new URL(name, SRC).href;

const tpl = (name) =>
  Deno.readTextFile(new URL(`tpl/${name}.html`, import.meta.url));

const TEMPLATE = {
  game: await tpl("game"),
  gallery: await tpl("gallery"),
  // Joined with newlines into the gallery's list, so no trailing one.
  card: (await tpl("card")).trimEnd(),
};

// {{name}} becomes vars.name. One pass, so a value containing {{...}} itself
// is left alone.
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

  const cmd = new Deno.Command("deno", {
    args: [
      "bundle",
      "--platform=browser",
      "--format=esm",
      "--minify",
      "-o",
      `${dir}/out.js`,
      entry,
    ],
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stderr } = await cmd.output();
  if (code !== 0) {
    await Deno.remove(dir, { recursive: true });
    throw new Error(
      `bundling ${game} failed:\n${new TextDecoder().decode(stderr)}`,
    );
  }

  const js = await Deno.readTextFile(`${dir}/out.js`);
  await Deno.remove(dir, { recursive: true });
  // A "</script" anywhere in a string literal would end the tag early.
  return js.replaceAll("</script", "<\\/script");
}

async function exists(url) {
  try {
    await Deno.stat(url);
    return true;
  } catch {
    return false;
  }
}

// What `./task media <game>` left, keyed by extension. The names match
// www/<game>/, so nothing is renamed.
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

// The mark in the game's two colours: a disc with a round-capped bar cut out
// of the bottom, reading as an "n". Measured off ~/web/games/one/icon.png and
// normalised from its 512 box to 32: disc r=180.9, bar half-width 49, cap
// centre y=259, all about x=255.5.
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
    ? `<meta property="og:image" content="${BASE}/${game}/card.png">\n` +
      `<meta name="twitter:card" content="summary_large_image">`
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
      bg: m.bg,
      fg: m.fg,
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
  // Every listed game, so `build <one game>` still leaves the gallery pointing
  // at clips that exist.
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
