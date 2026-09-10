/*
 * overlay.js - the chrome every game shares. Floating panels over the board,
 * and nothing else: no bar, no reserved strip, no mute button.
 *
 *   playing  a chip in the top-left corner once the score leaves zero, and
 *            msg() in a chip at the top-centre. A game that scores nothing and
 *            says nothing runs on a bare board.
 *   hint     hint("...") raises a panel at the bottom, which fades on the first
 *            input or a few seconds in. Opt-in: meta.desc no longer draws.
 *   finish   the frozen board, dimmed, and whatever gameOver() asked for. A
 *            click starts the next round.
 *
 * Every panel is one of two skins, picked from the lightness of meta.bg: a
 * light game gets the dark panel, a dark game the light one. The game's own
 * palette never enters, so rope and grab, whose fg and bg are almost the same
 * colour, still get a panel you can read.
 *
 * Nothing here consumes a click. one.js calls update() only between rounds and
 * render() after the game draws.
 */

import { ease, utils } from "../alma/src/index.js";
import { meta, mouse, op, score, SIZE } from "./state.js";

const MARGIN = 26;
const RADIUS = 12;

// Off black and off white: a panel over a black game still reads as a panel.
const DARK = { bg: "#17171b", fg: "#f5f4f0" };
const LIGHT = { bg: "#f5f4f0", fg: "#17171b" };

// A hint holds, then fades. Input cuts it short with the quicker fade. A game
// reads the sum off hint() rather than either number.
const HOLD = 3;
const FADE = 0.6;
const DISMISS = 0.2;

// How far the finish screen dims the board, and how long it takes to arrive.
const DIM = 0.8;
const RISE = 0.26;
const AGAIN = "TAP TO PLAY AGAIN";
// A click this soon after the round ends is the click that ended it.
const DEAD = 0.4;

let skin = DARK;

const tip = {
  lines: [],
  // Seconds until the panel is off the screen, zero the moment it is
  // dismissed. What hint() answers.
  left: 0,
  fade: FADE,
  alpha: 0,
};

// Text already raised this page load. A game calls hint() from init(), which
// runs every round, and the second round should not re-explain the first.
const seen = new Set();

const finish = {
  on: false,
  t: 0,
  // The last frame of the board, taken before any chrome went over it.
  shot: null,
  panel: false,
  title: null,
  score: false,
};

export function init() {
  score.best = localStorage.getItem(`one#${meta.title}`);
  if (score.best !== null) score.best = Number(score.best);
  skin = pick(meta.bg);
  seen.clear();
  clear();
}

export function startGame() {
  score.value = 0;
  clear();
}

function clear() {
  tip.left = 0;
  tip.alpha = 0;
  finish.on = false;
  finish.shot = null;
}

/*
 * opts says what the finish screen holds, and an empty one says nothing: the
 * board freezes and a click plays again.
 *
 *   msg    the title line. "" leaves the title out and keeps the rest.
 *   score  true adds the SCORE and BEST rows.
 *   win    picks WELL DONE over GAME OVER when msg is absent.
 */
export function gameOver(
  { msg = null, score: wantScore = false, win = false } = {},
) {
  const best = score.best;
  score.best = best === null
    ? score.value
    : meta.scoreMax
    ? Math.max(best, score.value)
    : Math.min(best, score.value);
  localStorage.setItem(`one#${meta.title}`, score.best);

  tip.left = 0;
  tip.alpha = 0;

  finish.on = true;
  finish.t = 0;
  finish.shot = null;
  finish.score = wantScore;
  finish.panel = msg !== null || wantScore || win;
  finish.title = !finish.panel ? null : msg ?? (win ? "WELL DONE" : "GAME OVER");
}

// one.js draws the board once more after the round ends and hands the canvas
// here, so the frozen shot holds the game and none of the chrome.
export function shoot(canvas) {
  const [shot, sctx] = utils.newCanvas(canvas.width, canvas.height);
  sctx.drawImage(canvas, 0, 0);
  finish.shot = shot;
}

/*
 * Raises the hint panel. A game calls it from init() for the opening lines, or
 * mid-round for a mechanic that just turned up. The same text twice is the
 * second call's problem, not the player's: each string shows once a page load,
 * so init() needs no round counter around it.
 */
export function show(text) {
  const lines = String(text).trim().split("\n").filter((l) => l.trim() !== "");
  if (lines.length === 0 || seen.has(text)) return;
  seen.add(text);
  tip.lines = lines;
  tip.left = HOLD + FADE;
  tip.fade = FADE;
  tip.alpha = 1;
}

// Seconds of hint left, fade included; zero once dismissed or faded.
export function hint() {
  return tip.left;
}

// Every frame, in game or not: the hint listens for the round's first input.
export function poll(dt) {
  if (finish.on) finish.t += dt;
  if (tip.left <= 0) return;

  tip.left = Math.max(0, tip.left - dt);
  if ((mouse.click || mouse.swipe) && tip.left > DISMISS) {
    tip.left = DISMISS;
    tip.fade = DISMISS;
  }
  tip.alpha = Math.min(1, tip.left / tip.fade);
}

// Only called between rounds.
export function update(_dt, start) {
  if (finish.t < DEAD) return;
  if (!mouse.click) return;
  finish.on = false;
  start();
}

export function render(ctx) {
  ctx.save();
  if (finish.on) renderFinish(ctx);
  else renderChips(ctx);
  if (tip.alpha > 0) renderHint(ctx);
  ctx.restore();
}

function renderChips(ctx) {
  const value = Math.floor(score.value);
  if (value > 0) chip(ctx, `${value}`, MARGIN, MARGIN, 44, 0, 0);
  if (op.topmsg) chip(ctx, op.topmsg, SIZE / 2, MARGIN, 28, 0.5, 0);
}

function renderHint(ctx) {
  const size = 34;
  const lead = size * 1.55;
  const px = 44;
  const py = 34;
  const w = Math.max(...tip.lines.map((l) => width(ctx, l, size))) + px * 2;
  const h = (tip.lines.length - 1) * lead + size + py * 2;

  ctx.globalAlpha = tip.alpha;
  const [bx, by] = box(ctx, SIZE / 2, SIZE - MARGIN * 3, w, h, 0.5, 1);
  let y = by + py + size / 2;
  for (const line of tip.lines) {
    ctx.text(line, bx + w / 2, y, size, { valign: "middle" });
    y += lead;
  }
  ctx.globalAlpha = 1;
}

/*
 * The frozen board, the dim, and the panel rising into it. On the frame the
 * round ends t is 0 and the shot has not been taken yet, so this draws nothing
 * and leaves the board one.js just drew alone on the canvas.
 */
function renderFinish(ctx) {
  const e = ease.fastOutSlowIn(Math.min(1, finish.t / RISE));

  if (finish.shot) ctx.drawImage(finish.shot, 0, 0, SIZE, SIZE);
  ctx.globalAlpha = DIM * e;
  ctx.fillStyle = meta.bg;
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.globalAlpha = 1;
  if (!finish.panel || e === 0) return;

  const TITLE = 58;
  const ROW = 34;
  const px = 56;
  const py = 40;

  const rows = [];
  if (finish.score) {
    rows.push(["SCORE", `${Math.floor(score.value)}`]);
    if (score.best !== null) rows.push(["BEST", `${Math.floor(score.best)}`]);
  }

  let w = width(ctx, AGAIN, 22);
  if (finish.title) w = Math.max(w, width(ctx, finish.title, TITLE));
  for (const [k, v] of rows) w = Math.max(w, width(ctx, `${k}${v}`, ROW) + 120);
  w += px * 2;

  let h = py * 2 + 34;
  if (finish.title) h += TITLE + 26;
  if (rows.length) h += rows.length * ROW * 1.5;

  ctx.globalAlpha = e;
  ctx.translate(0, (1 - e) * 24);
  const [bx, by] = box(ctx, SIZE / 2, SIZE / 2, w, h, 0.5, 0.5);

  let y = by + py;
  if (finish.title) {
    ctx.text(finish.title, bx + w / 2, y + TITLE / 2, TITLE, {
      valign: "middle",
    });
    y += TITLE + 26;
  }
  for (const [k, v] of rows) {
    y += ROW * 0.75;
    ctx.globalAlpha = e * 0.6;
    ctx.text(k, bx + px, y, ROW, { align: "left", valign: "middle" });
    ctx.globalAlpha = e;
    ctx.text(v, bx + w - px, y, ROW, { align: "right", valign: "middle" });
    y += ROW * 0.75;
  }

  ctx.globalAlpha = e * 0.5;
  ctx.text(AGAIN, bx + w / 2, by + h - py * 0.7, 22, {
    valign: "middle",
  });
  ctx.globalAlpha = 1;
}

/*
 * One floating rectangle, filled in the skin and left as the current fillStyle
 * for the text that follows. x,y is the anchor and ax,ay say which point of the
 * box that is: 0 left/top, 0.5 centre, 1 right/bottom.
 */
function box(ctx, x, y, w, h, ax, ay) {
  const bx = x - w * ax;
  const by = y - h * ay;
  ctx.save();
  ctx.shadowColor = "#0000004d";
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = skin.bg;
  ctx.beginPath();
  ctx.roundRect(bx, by, w, h, RADIUS);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = skin.fg;
  return [bx, by];
}

function chip(ctx, txt, x, y, size, ax, ay) {
  const px = size * 0.7;
  const py = size * 0.42;
  const w = width(ctx, txt, size) + px * 2;
  const h = size + py * 2;
  const [bx, by] = box(ctx, x, y, w, h, ax, ay);
  ctx.text(txt, bx + w / 2, by + h / 2, size, { valign: "middle" });
}

function width(ctx, txt, size) {
  ctx.font = `bold ${size}px Verdana`;
  return ctx.measureText(txt).width;
}

/*
 * The skin the board contrasts with more, by contrast ratio against meta.bg.
 * Not "is the background light or dark": the crossover between these two skins
 * sits at luminance 0.19, not at the 0.5 midpoint, because a mid-tone field is
 * much closer to white than it looks. Splitting at the midpoint puts berzerk's
 * red on the light panel at 3.3:1 where the dark one gives 5.0:1.
 */
function pick(hex) {
  const l = luma(hex);
  return ratio(l, luma(DARK.bg)) >= ratio(l, luma(LIGHT.bg)) ? DARK : LIGHT;
}

function ratio(a, b) {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// WCAG relative luminance. sRGB has to come out of its gamma curve before the
// channel weights mean anything: the weights on the raw bytes call #3DBF86 a
// 0.62 when it is a 0.40, which is most of the way to the wrong panel.
function luma(hex) {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) +
    0.0722 * lin(n & 255);
}

function lin(v) {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
