/*
 * media.js - a recorder zip becomes media/<game>/card.{mp4,png}.
 *
 * src/dev/rec.js downloads a zip of PNG frames and an fps.txt into ~/Downloads.
 * This takes the newest such zip for each game named and runs ffmpeg over the
 * frames. Commit what it writes; tools/build.js copies it to www/<game>/card.*.
 *
 * With no game named it processes every game, taking the ones whose zip is
 * newer than the card they already have. Most games' zips are long gone from
 * ~/Downloads and their cards are committed, so a missing zip is skipped there
 * and an error when the game was named.
 */

import { unzipSync } from "../src/alma/src/3rdp/fflate.js";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const DOWNLOADS = `${Deno.env.get("HOME")}/Downloads`;

function mtime(path) {
  try {
    return Deno.statSync(path).mtime?.getTime() ?? 0;
  } catch {
    return null; // no such file
  }
}

// The newest one-<game>-<stamp>.zip in ~/Downloads, by mtime, as `ls -t` sorts.
function newestZip(game) {
  let best = null;
  for (const e of Deno.readDirSync(DOWNLOADS)) {
    if (!e.isFile) continue;
    if (!e.name.startsWith(`one-${game}-`) || !e.name.endsWith(".zip")) continue;
    const path = `${DOWNLOADS}/${e.name}`;
    const t = mtime(path);
    if (best === null || t > best.t) best = { path, t };
  }
  return best;
}

function games() {
  return [...Deno.readDirSync(`${ROOT}/src`)]
    .filter((e) => e.isFile && e.name.endsWith(".js") && !e.name.startsWith("_"))
    .map((e) => e.name.slice(0, -3))
    .sort();
}

function ffmpeg(args) {
  let out;
  try {
    out = new Deno.Command("ffmpeg", { args, stdout: "null" }).outputSync();
  } catch {
    throw new Error("no ffmpeg on PATH: brew install ffmpeg");
  }
  if (out.success) return;
  const err = new TextDecoder().decode(out.stderr).trim();
  throw new Error(`ffmpeg: ${err.split("\n").pop() ?? out.code}`);
}

// The frames go to a temp dir first, since ffmpeg reads a numbered sequence off
// the filesystem and not a stream.
function card(game, zip) {
  const dir = Deno.makeTempDirSync({ prefix: `one-media-${game}-` });
  const out = `${ROOT}/media/${game}`;
  try {
    const files = unzipSync(Deno.readFileSync(zip));
    for (const [name, bytes] of Object.entries(files)) {
      Deno.writeFileSync(`${dir}/${name}`, bytes);
    }
    const fps = new TextDecoder().decode(files["fps.txt"]).trim();
    // Flags split out of one string so a group stays on one line; every path is
    // its own argument, since a path can contain a space and a flag cannot.
    const frames = [
      ...`-v error -y -framerate ${fps} -start_number 0`.split(" "),
      "-i",
      `${dir}/%04d.png`,
    ];

    Deno.mkdirSync(out, { recursive: true });

    const h264 = "-c:v libx264 -crf 20 -pix_fmt yuv420p -movflags +faststart";
    ffmpeg([...frames, ...h264.split(" "), `${out}/card.mp4`]);

    Deno.copyFileSync(`${dir}/0000.png`, `${out}/card.png`);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }

  for (const name of ["card.mp4", "card.png"]) {
    const kb = Deno.statSync(`${out}/${name}`).size / 1024;
    console.log(
      `  media/${game}/${name}`.padEnd(26) + `${kb.toFixed(1).padStart(8)} KB`,
    );
  }
}

const named = Deno.args.length > 0;
const names = named ? Deno.args : games();
for (const game of names) {
  const zip = newestZip(game);
  if (!zip) {
    if (!named) continue;
    console.error(
      `no ${DOWNLOADS}/one-${game}-*.zip. record one: ./task record ${game}`,
    );
    Deno.exit(1);
  }
  // A card newer than the zip it would be made from is this same card: with no
  // game named it is skipped, a named game rebuilds it.
  if (!named && mtime(`${ROOT}/media/${game}/card.mp4`) > zip.t) continue;
  console.log(game);
  console.log(`  ${zip.path}`);
  card(game, zip.path);
}
