/*
 * build.js - turns src/<game>.js into www/<game>/index.html.
 *
 * Every page is self-contained: the bundle, the CSS and the favicon are all
 * inlined, so a built game is one file you can open from disk, mail, or drop on
 * any static host. `deno bundle` (esbuild underneath) does the tree-shaking, so
 * a game only pays for the parts of alma it imports.
 *
 * The HTML lives in tools/tpl/ as plain files with {{name}} holes this script
 * fills in. They are excluded from `deno fmt`: it formats HTML now, and it
 * rewrites {{bg}} inside a stylesheet into a nested block.
 *
 * The gallery reads each game's `meta` by importing the module under Deno.
 * That works because a game module has no side effects and alma does not touch
 * the DOM at import time. Keep it that way.
 *
 *   deno run -A tools/build.js            # every game, plus the gallery
 *   deno run -A tools/build.js wow trap   # just these
 */

const SRC = new URL("../src/", import.meta.url);
const WWW = new URL("../www/", import.meta.url);
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

// {{name}} becomes vars.name. One pass over the template, so a value that
// happens to contain {{...}} itself is left alone.
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

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function favicon(m) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">` +
    `<rect width="32" height="32" fill="${m.bg}"/>` +
    `<circle cx="16" cy="16" r="9" fill="${m.fg}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function page(game, m, js) {
  return fill(TEMPLATE.game, {
    title: esc(m.title),
    desc: esc(m.desc.trim().replace(/\s*\n\s*/g, " ")),
    url: `${BASE}/${game}/`,
    bg: m.bg,
    icon: favicon(m),
    script: js,
  });
}

function gallery(entries) {
  const cards = entries.map(([game, m]) =>
    fill(TEMPLATE.card, { game, title: esc(m.title), bg: m.bg, fg: m.fg })
  ).join("\n");

  return fill(TEMPLATE.gallery, {
    url: `${BASE}/`,
    icon: favicon(SITE),
    cards,
  });
}

async function build(game) {
  const m = await meta(game);
  const js = await bundle(game);
  const html = page(game, m, js);
  await Deno.mkdir(new URL(`${game}/`, WWW), { recursive: true });
  await Deno.writeTextFile(new URL(`${game}/index.html`, WWW), html);
  const kb = (new Blob([html]).size / 1024).toFixed(1);
  console.log(`  ${game.padEnd(12)} ${kb.padStart(7)} KB`);
  return [game, m];
}

const wanted = Deno.args.length > 0 ? Deno.args : await games();
const entries = [];
for (const game of wanted) entries.push(await build(game));

// The gallery lists every game, not only the ones just rebuilt.
const all = [];
for (const game of await games()) {
  const found = entries.find(([g]) => g === game);
  all.push(found ?? [game, await meta(game)]);
}
// Newest first; undated games fall to the end, alphabetically.
all.sort(([ga, a], [gb, b]) =>
  (b.date ?? "").localeCompare(a.date ?? "") || ga.localeCompare(gb)
);

await Deno.mkdir(WWW, { recursive: true });
await Deno.writeTextFile(new URL("index.html", WWW), gallery(all));
console.log(`  ${"index".padEnd(12)} ${all.length} games`);
