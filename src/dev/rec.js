/*
 * rec.js - records a clip of the running game, for the gallery card.
 *
 * dev.html loads this and nothing else does, so it is in no game's bundle. The
 * buttons it draws are DOM, never in the footage, and dev.html's style block is
 * what styles them.
 *
 * A recording is a fixed ten seconds after a countdown, and all ten are the
 * card. The one thing dropped is the frozen finish screen a round that ended
 * early leaves at the end. "keep" downloads a zip of PNG frames that
 * `./task media <game>` turns into media/<game>/card.mp4 and .png.
 */

import { zipSync } from "../alma/src/3rdp/fflate.js";
import { msg } from "../lib/one.js";
import * as play from "./play.js";

const FPS = 30; // capture cadence, an exact half of a 60Hz display
const TAKE = 10; // seconds in a take
const LEAD = 2; // seconds it counts down before one starts
const OUT = 512; // exported frame, downscaled from the 1024 canvas
const TINY = 64; // every frame is also kept this small, to compare with
const SIG = 16; // ... and reduced to this greyscale grid, to compare frames

const TOTAL = TAKE * FPS;
const STEP = TINY / SIG;

let screen = null;
let name = "";
let state = "idle"; // idle | lead | rec | work | preview
let big, bigCtx, tiny, tinyCtx;
let frames = []; // a PNG blob per frame, or its promise while recording
let sigs = []; // Float32Array(SIG*SIG) per frame
let count = 0;
let t0 = 0;
let waiting = null; // auto()'s resolver, while a hands-off take runs
const ui = {};

export function init(scr, game) {
  screen = scr;
  name = game;

  big = new OffscreenCanvas(OUT, OUT);
  bigCtx = big.getContext("2d");
  bigCtx.imageSmoothingQuality = "high";
  // Every frame is read back off this one, so keep it on the CPU.
  tiny = new OffscreenCanvas(TINY, TINY);
  tinyCtx = tiny.getContext("2d", { willReadFrequently: true });
  tinyCtx.imageSmoothingQuality = "high";

  buildBar();
  addEventListener("keydown", onKey);
  // run() already called screen.start(), so this runs after the game's.
  requestAnimationFrame(loop);
}

function loop() {
  requestAnimationFrame(loop);
  if (state === "lead") {
    const left = LEAD - (performance.now() - t0) / 1000;
    if (left > 0) {
      ui.btn.textContent = `● ${Math.ceil(left)}`;
      return;
    }
    state = "rec";
    // From the end of the countdown and not from this frame, so a late frame
    // here does not shorten the recording.
    t0 += LEAD * 1000;
  }
  if (state !== "rec") return;

  const t = (performance.now() - t0) / 1000;
  // Frame i belongs at i/FPS, and falling behind repeats the canvas into the
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
  // Encoding now, off the main thread, keeps a recording at ~15MB against the
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

// How much of the take changed, as a fraction of its frames. A game that waits
// for a player records a still board, and this is what tells the two apart.
export function motion(sig) {
  if (sig.length < 2) return 0;
  let moved = 0;
  for (let i = 1; i < sig.length; i++) {
    if (dist(sig[i - 1], sig[i]) > 0) moved++;
  }
  return moved / (sig.length - 1);
}

// Frames up to where the board stopped: a round that ends early leaves the
// finish screen repeating to the end of the take, and the card stops before it.
export function played(sig) {
  let n = sig.length;
  while (n > 1 && dist(sig[n - 2], sig[n - 1]) === 0) n--;
  return n;
}

function record() {
  if (state !== "idle") return;
  state = "lead";
  frames = [];
  sigs = [];
  count = 0;
  t0 = performance.now();
  ui.note.textContent = "";
  ui.bar.dataset.on = "1";
}

function idle() {
  state = "idle";
  ui.btn.textContent = "● rec";
  ui.bar.dataset.on = "";
}

async function finish() {
  state = "work";
  ui.btn.textContent = "…";
  ui.note.textContent = "encoding";
  frames = await Promise.all(frames);

  const end = played(sigs);
  const moved = motion(sigs.slice(0, end));
  if (waiting) {
    const hand = waiting;
    waiting = null;
    hand({ end, moved });
    return;
  }
  await showPreview(end, moved);
}

async function showPreview(end, moved) {
  const bmp = await Promise.all(
    frames.slice(0, end).map((b) => createImageBitmap(b)),
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
    : `${secs}s · ${bmp.length} frames` + (pct < 90 ? ` · ${pct}% moving` : "");
  // A recording with no motion is never worth keeping; anything above that is a
  // judgement call, so the number is shown and the button stays enabled.
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
    box.hidden = true;
    for (const b of bmp) b.close();
    idle();
  };
  ui.end = end;
}

// The take as the bytes of a zip of PNG frames.
async function zipTake(end) {
  const files = {};
  for (let i = 0; i < end; i++) {
    const buf = new Uint8Array(await frames[i].arrayBuffer());
    // PNG is already deflated, so store it.
    files[`${String(i).padStart(4, "0")}.png`] = [buf, { level: 0 }];
  }
  files["fps.txt"] = [new TextEncoder().encode(`${FPS}\n`), { level: 0 }];
  return zipSync(files);
}

function zipName() {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
  return `one-${name}-${stamp}.zip`;
}

async function keep() {
  ui.note.textContent = "zipping";
  const bytes = await zipTake(ui.end);
  const file = zipName();
  const url = URL.createObjectURL(
    new Blob([bytes], { type: "application/zip" }),
  );
  const a2 = document.createElement("a");
  a2.href = url;
  a2.download = file;
  a2.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);

  ui.done();
  ui.note.textContent = `${file} · ./task media ${name}`;
}

// One recording with play.js at the keyboard, for tools/record.js, returned as
// base64 over CDP. A take with no motion is returned as zip: null, so record.js
// reports it rather than writing a still card.
export async function auto() {
  if (state !== "idle") throw new Error(`recorder is ${state}`);
  // A rule is up for its first 3.6 seconds and nothing here will dismiss it.
  // msg() is the seconds it has left, and 0 for the games that show none,
  // which are most of them.
  while (msg() > 0) await new Promise((r) => requestAnimationFrame(r));
  const take = new Promise((r) => (waiting = r));
  play.start(screen.canvas);
  record();
  const { end, moved } = await take;
  play.stop();
  const bytes = moved === 0 ? null : await zipTake(end);
  idle();
  return {
    file: zipName(),
    zip: bytes && await base64(bytes),
    frames: end,
    full: TOTAL,
    fps: FPS,
    moved,
  };
}

// Runtime.evaluate returns JSON, so the zip is sent as base64. FileReader
// rather than btoa: a String.fromCharCode of a few MB overflows the stack.
function base64(bytes) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result.slice(fr.result.indexOf(",") + 1));
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(new Blob([bytes]));
  });
}

// dev.html's Escape leaves the page for the index, except while a take or a
// preview is up: those are what the key means here.
export function busy() {
  return state !== "idle";
}

function onKey(e) {
  if (e.key === "r" && state === "idle") record();
  // Only during the countdown: once a recording starts it runs to the end.
  if (e.key === "Escape" && state === "lead") idle();
  if (e.key === "Escape" && state === "preview") ui.done();
}

function el(tag, props, parent) {
  const n = Object.assign(document.createElement(tag), props);
  // Focus would give a button the space and enter keys the game binds.
  if (tag === "button") n.onpointerdown = (e) => e.preventDefault();
  parent?.append(n);
  return n;
}

function buildBar() {
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
