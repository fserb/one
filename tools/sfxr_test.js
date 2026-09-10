/*
 * sfxr_test.js - checks what a seed is supposed to fix in src/lib/fsfx/sfxr.js.
 *
 * A sound is rendered once, at load, and then never again, so nothing at run
 * time can notice that a seed did not reproduce it or that a sample came out
 * NaN. Both went unseen until this file: the noise buffer drew from an unseeded
 * Math.random(), so every explosion was a different explosion, and a repeat cut
 * the period short without moving the phase, so the noise index ran past its
 * 32-entry buffer and read undefined.
 *
 *   deno run --allow-read tools/sfxr_test.js     # or ./task test
 */

import {
  blip,
  coin,
  explosion,
  hit,
  jump,
  laser,
  params,
  powerup,
  render,
  SAMPLE_RATE,
  sfxr,
  Track,
} from "../src/lib/fsfx/fsfx.js";

let fail = 0;
function check(name, ok, detail = "") {
  if (!ok) fail++;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${name}${detail && !ok ? `: ${detail}` : ""}`,
  );
}

function same(a, b) {
  if (a.length !== b.length) return `${a.length} vs ${b.length} samples`;
  for (let i = 0; i < a.length; ++i) {
    if (a[i] !== b[i]) return `sample ${i}, ${a[i]} vs ${b[i]}`;
  }
  return "";
}

// Every sound the games ask for, so a change to a generator or to the render
// loop has to own up to which of them it moved.
const GAME = [
  [jump, 4],
  [coin, 12],
  [powerup, 3],
  [explosion, 2],
  [laser, 1008],
  [laser, 1006],
  [explosion, 1002],
  [explosion, 1010],
  [explosion, 1005],
  [explosion, 1032],
  [jump, 12],
  [explosion, 25],
  [explosion, 30],
  [explosion, 1238],
  [powerup, 1246],
  [hit, 1259],
  [powerup, 1274],
  [powerup, 8428],
  [explosion, 1345],
  [laser, 1350],
  [explosion, 1344],
  [laser, 1403],
  [blip, 511],
  [powerup, 3607],
  [explosion, 3613],
  [laser, 1249],
  [hit, 1249],
  [hit, 95446],
  [explosion, 39969],
  [explosion, 81796],
  [powerup, 31331],
  [coin, 82],
  [explosion, 4073],
  [explosion, 4005],
  [coin, 112],
  [hit, 764],
  [blip, 0],
  [coin, 12],
  [hit, 3],
  [explosion, 16],
  [jump, 2801],
  [coin, 2833],
  [blip, 2851],
  [coin, 4021],
  [explosion, 4057],
  [powerup, 4093],
];

{
  let bad = "";
  for (const [gen, seed] of GAME) {
    const d = same(render(gen(seed)), render(gen(seed)));
    if (d) bad ||= `${gen.name}(${seed}) ${d}`;
  }
  check("a seed renders the same sound twice", !bad, bad);
}

{
  let bad = "";
  for (const [gen, seed] of GAME) {
    const w = render(gen(seed));
    for (let i = 0; i < w.length; ++i) {
      if (Number.isNaN(w[i])) {
        bad ||= `${gen.name}(${seed}) sample ${i}`;
        break;
      }
    }
  }
  check("no sound carries a NaN sample", !bad, bad);
}

{
  // The two the noise index used to overrun, on the sixth and third repeat.
  const a = render(explosion(1344));
  const b = render(explosion(4073));
  check(
    "a repeat past the period stays in the noise buffer",
    a.every((v) => v >= -1 && v <= 1) && b.every((v) => v >= -1 && v <= 1),
  );
}

{
  const direct = render({ ...explosion(1238), vol: 0.2 });
  const track = new Track(direct.length / SAMPLE_RATE, SAMPLE_RATE, 1);
  track(sfxr, { ...explosion(1238), vol: 0.2 });
  check("the fsfx stage renders what render() does", !same(direct, track.build()));
}

{
  const track = new Track(0.5, SAMPLE_RATE, 1);
  track(sfxr, { ...blip(1), amp: 0.5 });
  const plain = render(blip(1));
  const block = track.build();
  let bad = "";
  for (let i = 0; i < plain.length && i < block.length; ++i) {
    if (Math.abs(block[i] - 0.5 * plain[i]) > 1e-7) {
      bad ||= `sample ${i}, ${block[i]} vs ${0.5 * plain[i]}`;
    }
  }
  check("the stage's amp scales the voice", !bad, bad);
}

{
  let threw = false;
  try {
    const track = new Track(0.5, 48000, 1);
    track(sfxr, blip(1));
  } catch (e) {
    threw = /44100/.test(e.message);
  }
  check("a track at another rate is refused", threw);
}

{
  let threw = false;
  try {
    render({ ...blip(1), startFreq: 0.5 });
  } catch {
    threw = true;
  }
  check("a misspelt option throws rather than going unheard", threw);
}

{
  // ugl's Sound.vol(v), which the render loop then squares.
  check(
    "vol is ugl's Sound.vol",
    params({ ...blip(1), vol: 0.13 }).masterVolume === 0.26,
  );
}

console.log(fail === 0 ? "\nall passed" : `\n${fail} failed`);
Deno.exit(fail === 0 ? 0 : 1);
