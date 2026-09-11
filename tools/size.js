/*
 * size.js - what is in each game's bundle, module by module.
 *
 * `./task build` prints a page's size and nothing about where it came from.
 * This bundles a game the same way and then attributes every byte of the
 * minified output to the file it came from, so a module nobody asked for is
 * a line in a table rather than something to go looking for.
 *
 *   ./task size              # every game, then every module summed
 *   ./task size orbit blob   # those games, module by module
 *
 * The source map is how it reads: `deno bundle` has no metafile, but
 * --sourcemap linked names, for every run of output bytes, the input file it
 * was minified from. Summing those runs per source is exact, and the columns
 * add up to the file.
 *
 * The number is the bundle, not the page: a built page is this plus about
 * 3.5 KB of HTML, CSS and inlined favicon.
 *
 * It does not import build.js, which builds every game at module scope.
 *
 * What the table is for, since all three keep coming back:
 *   - a namespace import (`import * as x`, or `export * as x` off alma's
 *     index) ships the whole module, however little is named off it
 *   - a class ships whole, so one method pulls the other forty in
 *   - a side-effect import never tree-shakes, and takes its own imports with
 *     it: alma's index.js is `import "./extend.js"` on line 11
 */

const SRC = new URL("../src/", import.meta.url);

// Files under src/ that are not games. The same list build.js keeps.
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

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const DIGIT = new Map([...B64].map((c, i) => [c, i]));

// Base64 VLQ, the source map's number format: six bits at a time, the top one
// saying another group follows, and the lowest bit of the first group the
// sign.
function* vlq(field) {
  let n = 0;
  let shift = 0;
  for (const c of field) {
    const d = DIGIT.get(c);
    n |= (d & 31) << shift;
    shift += 5;
    if (d & 32) continue;
    yield n & 1 ? -(n >> 1) : n >> 1;
    n = 0;
    shift = 0;
  }
}

const encoder = new TextEncoder();
const bytes = (s) => encoder.encode(s).length;

/*
 * Minified output bytes per source file.
 *
 * A mapping is a point, not a range: it says output line/column such-and-such
 * starts here in that source. So a segment owns the output from its own column
 * to the next segment's, or to the end of the line, and the line's newline and
 * anything before its first segment are esbuild's own and belong to nobody.
 *
 * The source index is a delta carried across the whole file, and a segment of
 * one field carries no source at all.
 */
function attribute(code, map) {
  const lines = code.split("\n");
  const out = new Array(map.sources.length).fill(0);
  let unmapped = 0;
  let source = 0;
  map.mappings.split(";").forEach((mapping, row) => {
    const line = lines[row] ?? "";
    const segments = [];
    let column = 0;
    for (const field of mapping.split(",")) {
      if (!field) continue;
      const [dcol, dsrc] = [...vlq(field)];
      column += dcol;
      // One field is a column with no source behind it.
      if (dsrc !== undefined) source += dsrc;
      segments.push([column, dsrc === undefined ? -1 : source]);
    }
    unmapped += 1; // the newline
    if (segments.length === 0) {
      unmapped += bytes(line);
      return;
    }
    unmapped += bytes(line.slice(0, segments[0][0]));
    for (let i = 0; i < segments.length; i++) {
      const [from, src] = segments[i];
      const to = i + 1 < segments.length ? segments[i + 1][0] : line.length;
      const n = bytes(line.slice(from, to));
      if (src < 0) unmapped += n;
      else out[src] += n;
    }
  });
  return { out, unmapped };
}

async function gzip(js) {
  const stream = new Blob([js]).stream().pipeThrough(
    new CompressionStream("gzip"),
  );
  return (await new Response(stream).arrayBuffer()).byteLength;
}

// The entry build.js writes, bundled minified with a map beside it. Same
// entry, so the number is the one that ships.
async function measure(game) {
  const dir = await Deno.makeTempDir();
  const src = (name) => new URL(name, SRC).href;
  try {
    await Deno.writeTextFile(
      `${dir}/entry.js`,
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
        "--sourcemap",
        "linked",
        "-o",
        `${dir}/out.js`,
        `${dir}/entry.js`,
      ],
      stdout: "piped",
      stderr: "piped",
    });
    const { code, stderr } = await cmd.output();
    if (code !== 0) {
      throw new Error(
        `bundling ${game} failed:\n${new TextDecoder().decode(stderr)}`,
      );
    }
    const js = await Deno.readTextFile(`${dir}/out.js`);
    const map = JSON.parse(await Deno.readTextFile(`${dir}/out.js.map`));
    const { out, unmapped } = attribute(js, map);

    // The map's sources are relative to the temp directory. Named from src/,
    // so alma's files keep their alma/src/ and never read as lib's.
    const base = new URL("out.js", `file://${dir}/`);
    const per = new Map();
    map.sources.forEach((source, i) => {
      if (out[i] === 0) return;
      const href = new URL(source, base).href;
      const name = href.startsWith(SRC.href)
        ? href.slice(SRC.href.length)
        : "(entry)";
      per.set(name, (per.get(name) ?? 0) + out[i]);
    });
    if (unmapped > 0) per.set("(unmapped)", unmapped);

    return { total: new Blob([js]).size, gz: await gzip(js), per };
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

const kb = (b) => `${(b / 1024).toFixed(1)} KB`.padStart(9);
const down = (a, b) => b[1] - a[1];

const wanted = Deno.args.length > 0 ? Deno.args : await games();
const measured = [];
for (const game of wanted) measured.push([game, await measure(game)]);
measured.sort(([, a], [, b]) => b.total - a.total);

console.log("bundle, minified:");
for (const [game, m] of measured) {
  console.log(`  ${game.padEnd(12)}${kb(m.total)}   gz${kb(m.gz)}`);
}

// Every module in one table when the whole set was measured: what a module
// costs is its size times the games carrying it, and that is the column to
// read before touching anything.
if (Deno.args.length === 0) {
  const all = new Map();
  for (const [, m] of measured) {
    for (const [name, n] of m.per) {
      const e = all.get(name) ?? { total: 0, games: 0 };
      e.total += n;
      e.games += 1;
      all.set(name, e);
    }
  }
  console.log("\nmodule, summed over every game:");
  const rows = [...all].map(([name, e]) => [name, e.total, e.games]);
  for (const [name, total, count] of rows.sort(down)) {
    console.log(`  ${kb(total)}  in ${String(count).padStart(2)}  ${name}`);
  }
  Deno.exit(0);
}

for (const [game, m] of measured) {
  console.log(`\n${game}:`);
  for (const [name, n] of [...m.per].sort(down)) {
    console.log(`  ${kb(n)}  ${name}`);
  }
}
