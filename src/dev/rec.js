/*
 * rec.js - records a looping clip of the running game, for the gallery card.
 *
 * dev.html loads this and nothing else does, so it is in no game's bundle. It
 * only reads screen.canvas, and the bar it draws is DOM, never in the footage.
 *
 * A take is a fixed ten seconds and there is no editor. The recorder searches
 * it for the two frames that match most closely, cuts there so the clip loops
 * without a jump, and plays the result back. A bad take is re-recorded.
 *
 * "keep" downloads a zip of PNG frames at a constant rate. `./task media
 * <game>` turns that into media/<game>/card.mp4, .gif and .png, which
 * tools/build.js copies into the gallery.
 */

import { zipSync } from "../alma/src/3rdp/fflate.js";

const FPS = 30; // capture cadence, an exact half of a 60Hz display
const TAKE = 10; // seconds in a take
const OUT = 512; // exported frame, downscaled from the 1024 canvas
const TINY = 64; // every frame is also kept this small, for the search
const SIG = 16; // ... and reduced to this greyscale grid to score a cut
const MIN_LOOP = 3.5; // seconds the chosen loop has to run for
const MAX_LOOP = 7;
const WINDOW = 5; // frames either side of a cut that have to agree
const TOL = 2.5; // a seam may cost this many ordinary frame steps

const TOTAL = TAKE * FPS;
const STEP = TINY / SIG;

let screen = null;
let name = "";
let state = "idle"; // idle | rec | work | preview
let big, bigCtx, tiny, tinyCtx;
let frames = []; // a PNG blob per frame, or its promise while recording
let sigs = []; // Float32Array(SIG*SIG) per frame
let count = 0;
let t0 = 0;
const ui = {};

export function init(scr, game) {
  screen = scr;
  name = game;

  big = new OffscreenCanvas(OUT, OUT);
  bigCtx = big.getContext("2d");
  bigCtx.imageSmoothingQuality = "high";
  // The search reads pixels back every frame, so keep this on the CPU.
  tiny = new OffscreenCanvas(TINY, TINY);
  tinyCtx = tiny.getContext("2d", { willReadFrequently: true });
  tinyCtx.imageSmoothingQuality = "high";

  buildBar();
  addEventListener("keydown", onKey);
  // run() already called screen.start(), so this lands after the game's.
  requestAnimationFrame(loop);
}

function loop() {
  requestAnimationFrame(loop);
  if (state !== "rec") return;

  const t = (performance.now() - t0) / 1000;
  // Frame i belongs at i/FPS. Falling behind repeats the canvas into the
  // missed slots, so a stutter records as a stutter.
  const want = Math.min(Math.floor(t * FPS) + 1, TOTAL);
  while (count < want) grab(count++);

  ui.btn.textContent = `■ ${Math.max(0, TAKE - t).toFixed(1)}`;
  if (count >= TOTAL) finish();
}

function grab(i) {
  bigCtx.drawImage(screen.canvas, 0, 0, OUT, OUT);
  tinyCtx.drawImage(big, 0, 0, TINY, TINY);
  sigs[i] = signature(tinyCtx.getImageData(0, 0, TINY, TINY).data);
  // Encoding now, off the main thread, keeps a take at ~15MB instead of the
  // ~300MB it would cost as ImageData.
  frames[i] = big.convertToBlob({ type: "image/png" });
}

// TINY x TINY RGBA down to a SIG x SIG grid of greyscale means.
function signature(px) {
  const out = new Float32Array(SIG * SIG);
  for (let y = 0; y < TINY; y++) {
    for (let x = 0; x < TINY; x++) {
      const i = (y * TINY + x) * 4;
      const l = px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
      out[((y / STEP) | 0) * SIG + ((x / STEP) | 0)] += l;
    }
  }
  for (let i = 0; i < out.length; i++) out[i] /= STEP * STEP;
  return out;
}

function dist(p, q) {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const d = p[i] - q[i];
    s += d * d;
  }
  return s;
}

// How much of the take changed, as a fraction of its frames. A take with no
// input is ten seconds of an idle board, and findLoop cuts a perfect loop out
// of it, because a still frame matches a still frame exactly. Nothing
// downstream can tell that from a real clip, so it is caught here.
export function motion(sig) {
  if (sig.length < 2) return 0;
  let moved = 0;
  for (let i = 1; i < sig.length; i++) {
    if (dist(sig[i - 1], sig[i]) > 0) moved++;
  }
  return moved / (sig.length - 1);
}

// The clip plays [in, out) and jumps back, so the cut disappears when frame
// `out` looks like frame `in`. Scoring WINDOW frames from each stops one
// coincidental match from winning.
//
// The seam is compared against the take's own median frame-to-frame step, not
// minimised: minimising always returns the shortest clip, since anything that
// drifts through the take (a score counting up, a board filling) separates two
// frames in proportion to how far apart they are. Among the cuts that hold,
// the longest wins.
//
// Exported and pure, so it runs on signatures that never saw a canvas.
export function findLoop(sig, lo, hi) {
  // A round that ends early leaves the frozen game-over frame repeating to the
  // end. It breaks the search twice over: it costs nothing to cut across at any
  // length, so it wins, and its zero-cost steps drag the median down until the
  // budget admits nothing else. Drop it first.
  let n = sig.length;
  while (n > 1 && dist(sig[n - 2], sig[n - 1]) === 0) n--;

  const steps = [];
  for (let i = 1; i < n; i++) steps.push(dist(sig[i - 1], sig[i]));
  steps.sort((a, b) => a - b);
  // Median, not mean: one screen-clearing frame should not raise the bar.
  const budget = (steps[steps.length >> 1] ?? 0) * WINDOW * TOL;

  let best = null; // longest cut inside the budget
  let least = null; // the least bad one, for when nothing is inside it
  for (let a = 0; a + lo + WINDOW <= n; a++) {
    for (let len = lo; len <= hi && a + len + WINDOW <= n; len++) {
      let d = 0;
      for (let k = 0; k < WINDOW; k++) d += dist(sig[a + k], sig[a + len + k]);
      if (least === null || d < least.d) least = { d, in: a, out: a + len };
      if (d > budget) continue;
      const gain = best === null ? 1 : len - (best.out - best.in);
      if (gain > 0 || (gain === 0 && d < best.d)) {
        best = { d, in: a, out: a + len };
      }
    }
  }
  // Nothing long enough to loop: hand back the gameplay without the freeze.
  return best ?? least ?? { d: 0, in: 0, out: n };
}

function record() {
  if (state !== "idle") return;
  state = "rec";
  frames = [];
  sigs = [];
  count = 0;
  t0 = performance.now();
  ui.note.textContent = "";
  ui.bar.dataset.on = "1";
}

async function finish() {
  state = "work";
  ui.btn.textContent = "…";
  ui.note.textContent = "encoding";
  frames = await Promise.all(frames);

  ui.note.textContent = "finding the loop";
  // Yield once, so the text paints before the search blocks.
  await new Promise((r) => setTimeout(r, 0));
  const cut = findLoop(
    sigs,
    Math.round(MIN_LOOP * FPS),
    Math.round(MAX_LOOP * FPS),
  );

  // The cut, not the take: a round ending at 3s leaves seven frozen seconds
  // the take as a whole still counts as movement.
  await showPreview(cut, motion(sigs.slice(cut.in, cut.out)));
}

async function showPreview(cut, moved) {
  const bmp = await Promise.all(
    frames.slice(cut.in, cut.out).map((b) => createImageBitmap(b)),
  );
  state = "preview";

  const box = document.getElementById("rec-preview");
  const pv = box.querySelector("canvas");
  pv.width = OUT;
  pv.height = OUT;
  const pctx = pv.getContext("2d");

  const secs = (bmp.length / FPS).toFixed(1);
  const pct = Math.round(moved * 100);
  box.querySelector("p").textContent = moved === 0
    ? "nothing moved: ten seconds of an idle game"
    : `${secs}s · ${bmp.length} frames · from ${(cut.in / FPS).toFixed(1)}s` +
      (pct < 90 ? ` · ${pct}% moving` : "");
  // A frozen take is never worth keeping. Anything above it is a judgement
  // call, so the number is shown and the button stays live.
  ui.keep.disabled = moved === 0;
  box.hidden = false;
  ui.note.textContent = "";

  const started = performance.now();
  function tick() {
    if (state !== "preview") return;
    const i = Math.floor((performance.now() - started) / 1000 * FPS) %
      bmp.length;
    pctx.drawImage(bmp[i], 0, 0, OUT, OUT);
    requestAnimationFrame(tick);
  }
  tick();

  ui.done = () => {
    state = "idle";
    box.hidden = true;
    for (const b of bmp) b.close();
    ui.btn.textContent = "● rec";
    ui.bar.dataset.on = "";
  };
  ui.cut = cut;
}

async function keep() {
  const { in: a, out: b } = ui.cut;
  ui.note.textContent = "zipping";
  const files = {};
  for (let i = a; i < b; i++) {
    const buf = new Uint8Array(await frames[i].arrayBuffer());
    // PNG is already deflated, so store it.
    files[`${String(i - a).padStart(4, "0")}.png`] = [buf, { level: 0 }];
  }
  files["fps.txt"] = [new TextEncoder().encode(`${FPS}\n`), { level: 0 }];

  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
  const file = `one-${name}-${stamp}.zip`;
  const url = URL.createObjectURL(
    new Blob([zipSync(files)], { type: "application/zip" }),
  );
  const a2 = document.createElement("a");
  a2.href = url;
  a2.download = file;
  a2.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);

  ui.done();
  ui.note.textContent = `${file} · ./task media ${name}`;
}

function onKey(e) {
  if (e.key === "r" && state === "idle") record();
  if (e.key === "Escape" && state === "preview") ui.done();
}

function el(tag, props, parent) {
  const n = Object.assign(document.createElement(tag), props);
  // Focus would hand a button the space and enter the game binds.
  if (tag === "button") n.onpointerdown = (e) => e.preventDefault();
  parent?.append(n);
  return n;
}

function buildBar() {
  el("style", { textContent: CSS }, document.head);

  ui.bar = el("div", { id: "rec-bar" }, document.body);
  ui.btn = el("button", { textContent: "● rec", onclick: onBar }, ui.bar);
  ui.note = el("span", {}, ui.bar);

  const box = el("div", { id: "rec-preview", hidden: true }, document.body);
  el("canvas", {}, box);
  el("p", {}, box);
  const row = el("div", {}, box);
  ui.keep = el("button", { textContent: "keep", onclick: keep }, row);
  el("button", { textContent: "again", onclick: () => ui.done() }, row);
}

function onBar() {
  if (state === "idle") record();
}

const CSS = `
#rec-bar {
  position: fixed; left: 8px; bottom: 8px; z-index: 9;
  display: flex; gap: 10px; align-items: center;
  font: 12px ui-monospace, monospace; color: #0009;
}
#rec-bar[data-on] { color: #c22; }
#rec-bar button, #rec-preview button {
  font: inherit; padding: 4px 10px; cursor: pointer;
  border: 1px solid #0003; border-radius: 4px; background: #fff8; color: inherit;
}
#rec-preview {
  position: fixed; inset: 0; z-index: 10;
  display: flex; flex-direction: column; gap: 12px;
  align-items: center; justify-content: center;
  background: #000c; font: 13px ui-monospace, monospace; color: #fff;
}
#rec-preview[hidden] { display: none; }
/* Square and inside the window: a flex column shrinks the canvas on the main
   axis alone and stretches the frames. */
#rec-preview canvas { flex: none; width: 72vmin; height: 72vmin; }
#rec-preview p { margin: 0; opacity: .7; }
#rec-preview div { display: flex; gap: 8px; }
#rec-preview button { background: #fff; color: #000; padding: 6px 18px; }
#rec-preview button:disabled { opacity: .35; cursor: not-allowed; }
`;
