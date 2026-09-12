/*
 * overlay.js - the panels every game shares: msg()'s small label at the top
 * centre, hint()'s panel at the bottom, and the finish screen over the frozen
 * board. Nothing draws the score while the round runs.
 *
 * Nothing here clears a click flag. one.js calls update() only between rounds
 * and render() after the game draws.
 */

import { fastOutSlowIn } from "../alma/src/ease.js";
import { newCanvas } from "../alma/src/utils/utils.js";
import { mouse } from "./input.js";
import { meta, op, score, SIZE } from "./one.js";

const MARGIN = 26;
const RADIUS = 12;

// Off black and off white, so a panel over a black game is still separable
// from it.
const DARK = "#17171b";
const LIGHT = "#f5f4f0";

// A hint stays up, then fades; input ends it early with the quicker fade.
const HOLD = 3;
const FADE = 0.6;
const DISMISS = 0.2;

// How far the finish screen dims the board, and how long it takes to appear.
const DIM = 0.8;
const RISE = 0.26;
const AGAIN = "TAP TO PLAY AGAIN";
// A click this soon after the round ends is the click that ended it.
const DEAD = 0.4;

let panel = { bg: DARK, fg: LIGHT };

const tip = {
  lines: [],
  // Seconds until the panel is gone, 0 the moment it is dismissed.
  left: 0,
  fade: FADE,
  alpha: 0,
};

// Text already shown this page load: init() runs every round, and the second
// round should not re-explain the first.
const seen = new Set();

const finish = {
  on: false,
  t: 0,
  shot: null, // the board, captured before any panel was drawn over it
  showPanel: false,
  title: null,
  score: false,
};

export function init() {
  score.best = localStorage.getItem(`one#${meta.title}`);
  if (score.best !== null) score.best = Number(score.best);
  panel = theme(meta);
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
 * opts says what the finish screen shows, and an empty one shows nothing: the
 * board freezes and a click plays again.
 *
 *   msg    the title line. "" leaves the title out and keeps the rest.
 *   score  true adds the SCORE and BEST rows.
 *   win    uses WELL DONE instead of GAME OVER when msg is absent.
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
  finish.showPanel = msg !== null || wantScore || win;
  finish.title = !finish.showPanel ? null : msg ?? (win ? "WELL DONE" : "GAME OVER");
}

// one.js draws the board once more after the round ends and passes the canvas
// here, so the frozen shot has the game and none of the panels.
export function shoot(canvas) {
  const [shot, sctx] = newCanvas(canvas.width, canvas.height);
  sctx.drawImage(canvas, 0, 0);
  finish.shot = shot;
}

// Each string shows once a page load, so init() needs no round counter.
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

// Every frame, in game or not: the round's first input dismisses the hint.
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
  else renderMsg(ctx);
  if (tip.alpha > 0) renderHint(ctx);
  ctx.restore();
}

function renderMsg(ctx) {
  if (op.topmsg) label(ctx, op.topmsg, SIZE / 2, MARGIN, 28, 0.5, 0);
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

// On the frame the round ends t is 0 and the shot has not been taken, so this
// draws nothing and leaves the canvas as one.js just drew it.
function renderFinish(ctx) {
  const e = fastOutSlowIn(Math.min(1, finish.t / RISE));

  if (finish.shot) ctx.drawImage(finish.shot, 0, 0, SIZE, SIZE);
  ctx.globalAlpha = DIM * e;
  ctx.fillStyle = meta.bg;
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.globalAlpha = 1;
  if (!finish.showPanel || e === 0) return;

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

// x,y is the anchor and ax,ay which point of the box that is: 0 left/top, 0.5
// centre, 1 right/bottom. Leaves panel.fg as the fillStyle for the text.
function box(ctx, x, y, w, h, ax, ay) {
  const bx = x - w * ax;
  const by = y - h * ay;
  ctx.save();
  ctx.shadowColor = "#0000004d";
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = panel.bg;
  ctx.beginPath();
  ctx.roundRect(bx, by, w, h, RADIUS);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = panel.fg;
  return [bx, by];
}

function label(ctx, txt, x, y, size, ax, ay) {
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
 * The two colours every panel is drawn in. Each default is chosen against what
 * it will be drawn over, the fill against the board and the text against the
 * fill, so a game that needs a different fill sets only `meta.overlay.bg`.
 *
 * meta.fg is never a default: rope's is #402F2E on a #000000 board and grab's
 * is nearly its own board too. tools/build.js calls this for the gallery card,
 * whose title is the fill colour, that being the half chosen to be readable
 * over the board.
 */
export function theme(m) {
  const bg = m.overlay?.bg ?? pick(m.bg);
  return { bg, fg: m.overlay?.fg ?? pick(bg) };
}

/*
 * WCAG relative luminance of a #rrggbb colour. Linearising is the step that
 * matters: weighting the raw bytes calls #3DBF86 a 0.62 when it is a 0.40,
 * which is most of the distance to the wrong pair.
 *
 * Six-digit hex only, which is what every meta.bg and meta.overlay is. alma's
 * color().contrast() reads any CSS colour and costs 12 KB a bundle, the Color
 * class including OKLAB, deltaE2000, gamut mapping and a CSS parser.
 */
function lum(hex) {
  const n = parseInt(hex.slice(1), 16);
  let y = 0;
  for (const [shift, weight] of [[16, 0.2126], [8, 0.7152], [0, 0.0722]]) {
    const c = ((n >> shift) & 255) / 255;
    y += weight * (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  }
  return y;
}

const L_DARK = lum(DARK);
const L_LIGHT = lum(LIGHT);
const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/*
 * Whichever of DARK and LIGHT has the higher WCAG contrast ratio over `over`.
 * Not "is `over` light or dark": the crossover is at luminance 0.19, not at the
 * 0.5 midpoint, because a mid-tone colour is much closer to white than it
 * looks. Splitting at the midpoint puts berzerk's red on LIGHT at 3.3:1 where
 * DARK gives 5.0:1.
 */
function pick(over) {
  const y = lum(over);
  return ratio(y, L_DARK) >= ratio(y, L_LIGHT) ? DARK : LIGHT;
}
