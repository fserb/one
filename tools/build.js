/*
 * build.js - turns src/<game>.js into www/<game>/index.html.
 *
 * Every page is self-contained: the bundle, the CSS and the favicon are all
 * inlined, so a built game is one file you can open from disk, mail, or drop on
 * any static host. `deno bundle` (esbuild underneath) does the tree-shaking, so
 * a game only pays for the parts of alma it imports.
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

const src = (name) => new URL(name, SRC).href;

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
  return { title: game, desc: "", bg: "#f2f0e5", fg: "#212123", ...mod.meta };
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
  const desc = esc(m.desc.trim().replace(/\s*\n\s*/g, " "));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(m.title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=no, viewport-fit=cover">
<meta name="description" content="${desc}">
<link rel="canonical" href="${BASE}/${game}/">
<meta property="og:title" content="${esc(m.title)}">
<meta property="og:type" content="website">
<meta property="og:description" content="${desc}">
<meta property="og:url" content="${BASE}/${game}/">
<meta name="theme-color" content="${m.bg}">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="${esc(m.title)}">
<link rel="icon" href="${favicon(m)}">
<style>
html, body { margin: 0; height: 100%; overflow: hidden; }
body {
  background: ${m.bg};
  display: flex;
  align-items: center;
  justify-content: center;
  touch-action: none;
}
canvas {
  display: block;
  cursor: pointer;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent;
}
</style>
</head>
<body>
<canvas id="canvas"></canvas>
<script type="module">${js}</script>
</body>
</html>
`;
}

function gallery(entries) {
  const cards = entries.map(([game, m]) =>
    `  <li>
    <a href="./${game}/" data-game="${game}" style="--bg:${m.bg};--fg:${m.fg}">
      <span>${esc(m.title)}</span>
    </a>
  </li>`
  ).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>one tiny game</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="a collection of tiny web games">
<link rel="canonical" href="${BASE}/">
<meta property="og:title" content="one tiny game">
<meta property="og:type" content="website">
<meta property="og:description" content="a collection of tiny web games">
<meta property="og:url" content="${BASE}/">
<meta name="theme-color" content="#f2f0e5">
<link rel="icon" href="${favicon({ bg: "#f2f0e5", fg: "#212123" })}">
<style>
:root { --card: 400px; }
html { background: #f2f0e5; }
body {
  margin: 0;
  padding: 20px;
  font-family: Verdana, sans-serif;
  color: #212123;
}
h1 { font-size: 250%; line-height: 1; margin: 0 0 .2em; }
p.by { font-size: 75%; margin: 0; }
a { color: inherit; }
ul {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(var(--card), 1fr));
  gap: 40px;
  list-style: none;
  margin: 40px 0 0;
  padding: 0;
}
li { aspect-ratio: 1; }
li > * { width: 100%; height: 100%; border: 0; display: block; }
li > a {
  background: var(--bg);
  color: var(--fg);
  display: flex;
  align-items: flex-end;
  padding: .5em;
  box-sizing: border-box;
  font-size: 2.4em;
  font-weight: bold;
  text-decoration: none;
}
@media (max-width: 480px) { :root { --card: 100%; } body { padding: 20px 0; } }
</style>
</head>
<body>
<header>
  <h1>one tiny game</h1>
  <p class="by">by <a href="https://fserb.com">fserb</a></p>
</header>
<ul id="games">
${cards}
</ul>
<script type="module">
// One game runs at a time: opening a second puts the first card back.
const list = document.getElementById("games");
let playing = null;

list.addEventListener("click", ev => {
  const a = ev.target.closest("a[data-game]");
  if (!a || ev.metaKey || ev.ctrlKey || ev.shiftKey) return;
  ev.preventDefault();

  playing?.replaceWith(playing.card);

  const frame = document.createElement("iframe");
  frame.src = a.getAttribute("href");
  frame.card = a;
  frame.allow = "autoplay; fullscreen; gamepad";
  a.replaceWith(frame);
  playing = frame;
});
</script>
</body>
</html>
`;
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
