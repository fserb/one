/*
 * loop_test.js - checks the loop search in src/dev/rec.js.
 *
 * The recorder cuts a ten second take down to a clip that loops, and that cut
 * is the one part of it whose correctness is not obvious from watching. These
 * run on made-up signatures, so no canvas and no browser.
 *
 *   deno run --allow-read tools/loop_test.js     # or ./task test
 */

import { findLoop } from "../src/dev/rec.js";

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

// A frozen take loops anywhere, so take the longest clip on offer.
{
  const c = findLoop(flat(300), LO, HI);
  check(
    "static -> longest",
    len(c) === HI && c.in === 0,
    `len ${len(c)} in ${c.in}`,
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

console.log(fail === 0 ? "\nall passed" : `\n${fail} failed`);
