/*
 * loop_test.js - checks the loop search in src/dev/rec.js.
 *
 * The recorder cuts a ten second take down to a clip that loops, and that cut
 * is the one part of it whose correctness is not obvious from watching. These
 * run on made-up signatures, so no canvas and no browser.
 *
 *   deno run --allow-read tools/loop_test.js     # or ./task test
 */

import { findLoop, motion } from "../src/dev/rec.js";

const N = 256; // signature cells, as in rec.js (16x16)
const LO = 105, HI = 210; // 3.5s .. 7s at 30fps
const WINDOW = 5, TOL = 2.5; // as in rec.js

// A take: `period` frames of cyclic motion across the picture, plus a
// monotonic ramp over `cells` of them totalling `ramp` luminance, standing in
// for a score readout that only ever counts up.
function take(n, period, ramp = 0, cells = 2) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const v = new Float32Array(N);
    const phase = Math.sin(2 * Math.PI * i / period);
    for (let c = 0; c < N; c++) {
      v[c] = 128 + 100 * phase * Math.cos(c) +
        (c < cells ? ramp * i / n : 0);
    }
    out.push(v);
  }
  return out;
}

function flat(n) {
  return Array.from({ length: n }, () => new Float32Array(N).fill(128));
}

// The contract findLoop states: crossing the seam costs no more than TOL
// ordinary frame steps. Recomputed here rather than trusted.
function budget(sig) {
  const steps = [];
  for (let i = 1; i < sig.length; i++) {
    let d = 0;
    for (let c = 0; c < N; c++) {
      const x = sig[i][c] - sig[i - 1][c];
      d += x * x;
    }
    steps.push(d);
  }
  steps.sort((a, b) => a - b);
  return steps[steps.length >> 1] * WINDOW * TOL;
}

let fail = 0;
function check(name, ok, detail = "") {
  if (!ok) fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ": " + detail : ""}`);
}
const len = (c) => c.out - c.in;

// Cyclic motion: a real loop exists, so it must not collapse to the minimum,
// and the seam it picks must honour the contract.
for (const p of [60, 90]) {
  const sig = take(300, p);
  const c = findLoop(sig, LO, HI);
  check(`period ${p} finds a real loop`, len(c) > LO, `len ${len(c)}`);
  check(
    `period ${p} seam within budget`,
    c.d <= budget(sig),
    `d ${c.d.toFixed(1)} budget ${budget(sig).toFixed(1)}`,
  );
}

// The same, with a score counter climbing 80 luminance over the take in two
// cells. This is the case absolute minimisation collapsed to the shortest.
for (const p of [60, 90]) {
  const sig = take(300, p, 80);
  const c = findLoop(sig, LO, HI);
  check(`period ${p} + counter survives`, len(c) > LO, `len ${len(c)}`);
}

// The whole picture ramps and nothing repeats: no seam can hold, so return
// the least bad cut rather than pretend one loops.
{
  const c = findLoop(take(300, 1e9, 400, N), LO, HI);
  check("no loop exists -> shortest", len(c) === LO, `len ${len(c)}`);
}

// A frozen take has no gameplay in it at any length, so what matters is not
// which cut comes back but that the cut has no motion and `keep` refuses it.
{
  const c = findLoop(flat(300), LO, HI);
  const m = motion(flat(300).slice(c.in, c.out));
  check("static -> nothing to keep", m === 0, `motion ${m}`);
}

// A round that ends early: one.js freezes the picture on game over and the
// recorder keeps capturing it, so the take is live frames then identical ones.
// The frozen span costs nothing to cut across and is the longest thing going,
// so the search used to land inside it and hand back a still.
{
  const live = (i) => {
    const v = new Float32Array(N);
    for (let c = 0; c < N; c++) {
      v[c] = 128 + 100 * Math.sin(i / 6) * Math.cos(c);
    }
    return v;
  };
  const endsEarly = (n, frozen) => {
    const out = [];
    for (let i = 0; i < n; i++) out.push(live(i));
    const last = out[out.length - 1];
    for (let i = 0; i < frozen; i++) out.push(Float32Array.from(last));
    return out;
  };

  for (const [n, frozen] of [[90, 210], [180, 120], [240, 60]]) {
    const sig = endsEarly(n, frozen);
    const c = findLoop(sig, LO, HI);
    const m = motion(sig.slice(c.in, c.out));
    check(
      `ends at ${n} of ${n + frozen}: cut is all gameplay`,
      m === 1 && c.out <= n,
      `in ${c.in} out ${c.out} motion ${m.toFixed(3)}`,
    );
  }

  // The take as a whole moves, so measuring it instead of the cut is what let
  // a frozen cut through.
  const sig = endsEarly(90, 210);
  check(
    "measuring the take, not the cut, would miss it",
    motion(sig) > 0,
    motion(sig).toFixed(3),
  );
}

// Too few frames to hold a loop: hand back the whole take.
{
  const c = findLoop(take(50, 90), LO, HI);
  check(
    "short take -> whole take",
    c.in === 0 && c.out === 50,
    JSON.stringify({ in: c.in, out: c.out }),
  );
}

// The frame the seam is scored against has to exist, whatever the input.
{
  let ok = true;
  for (const p of [37, 77, 90, 113, 1e9]) {
    for (const r of [0, 80, 400]) {
      const c = findLoop(take(300, p, r), LO, HI);
      if (c.in < 0 || c.out + WINDOW > 300 || len(c) < LO) ok = false;
    }
  }
  check("every cut stays inside the take", ok);
}

// A take the game never received input for is a still, whatever findLoop
// makes of it. This is the check that would have stopped a frozen wow clip
// reaching a commit.
check("frozen take -> no motion", motion(flat(300)) === 0, `${motion(flat(300))}`);
check(
  // Not exactly 1: a smooth sine has bit-identical neighbours at its peaks.
  // Real footage only repeats a frame when the game is genuinely frozen.
  "moving take -> nearly all motion",
  motion(take(300, 90)) > 0.95,
  motion(take(300, 90)).toFixed(3),
);
check("one frame -> no motion", motion(flat(1)) === 0);
{
  // Moving for a third of its length, idle for the rest.
  const sig = [...take(100, 90), ...flat(200)];
  const m = motion(sig);
  check("part moving -> in between", m > 0.3 && m < 0.4, m.toFixed(3));
}

console.log(fail === 0 ? "\nall passed" : `\n${fail} failed`);
