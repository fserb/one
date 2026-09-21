/*
 * overlay.js - what a game writes over the board: msg()'s one line of text, and
 * the finish screen over the board the round ended on. Nothing is filled behind
 * either, so both draw in theme()'s colour, and nothing draws the score while
 * the round runs.
 */

import { anchor, css, hex } from "./gfx.js";
import { input } from "./input.js";
import { meta, score } from "./one.js";

const MARGIN = 26;

// Off black and off white, so text over a black game is still separable from
// it.
const DARK = "#17171b";
const LIGHT = "#f5f4f0";

// A line given a `hold` stays that long, then fades; input ends it early with
// the quicker fade. A line with no hold is not dismissible: it is a label the
// game is keeping up, not a rule the player has finished reading.
const FADE = 0.6;
const DISMISS = 0.2;

// The two places a line goes, and what it looks like there. Each field is a
// default the opts override, so `{ at: "bottom", size: 34 }` is that slot in a
// size of its own.
const AT = {
  top: { x: 512, y: MARGIN, align: "center top", size: 28 },
  // Four margins up, which clears the furniture a game puts along the bottom
  // edge, like set's clock bar at 920.
  bottom: { x: 512, y: 1024 - MARGIN * 4, align: "center bottom", size: 34 },
};

// How far the finish screen dims the board, and how long it takes to appear.
const DIM = 0.8;
const RISE = 0.26;
// Written out rather than taken from alma's ease.js: over 0.26s it and
// fastOutSlowIn are not separable, and importing ease.js for this alone cost
// 1.1 KB in each of seven bundles.
const ease = (t) => 1 - (1 - t) ** 3;
const AGAIN = "TAP TO PLAY AGAIN";
// A click this soon after the round ends is the click that ended it.
const DEAD = 0.4;

let ink = LIGHT;

// The one line over the board. `left` is Infinity while it has no hold, so
// nothing counts down and left() reports it as going nowhere.
const line = {
  text: null,
  lines: [],
  at: AT.top,
  opts: {},
  color: LIGHT,
  left: 0,
  fade: FADE,
  alpha: 0,
};

// Text already shown this page load: a second round does not re-explain.
const seen = new Set();

const finish = {
  on: false,
  t: 0,
  showPanel: false,
  title: null,
  score: false,
};

export function init() {
  score.best = localStorage.getItem(`one#${meta.title}`);
  if (score.best !== null) score.best = Number(score.best);
  ink = theme(meta);
  seen.clear();
  clear();
}

export function startGame() {
  score.value = 0;
  clear();
}

// Every overlay state, so a round opens with none of the last one's showing.
function clear() {
  line.text = null;
  line.alpha = 0;
  finish.on = false;
}

// `msg` is the title line, and "" leaves it out; `score` adds the SCORE and
// BEST rows; `win` uses WELL DONE instead of GAME OVER. An empty opts shows
// nothing: the board freezes and a click plays again.
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

  line.text = null;
  line.alpha = 0;

  finish.on = true;
  finish.t = 0;
  finish.score = wantScore;
  finish.showPanel = msg !== null || wantScore || win;
  finish.title = !finish.showPanel ? null : msg ?? (win ? "WELL DONE" : "GAME OVER");
}

// See one.js's msg() for the opts. Setting the text that is already up is a
// no-op, so a game can call this from update() every frame without restarting
// the fade; `null` or "" takes the line away.
export function show(text, opts = {}) {
  if (text === null || text === "") {
    line.text = null;
    return;
  }
  if (text === line.text) return;
  if (opts.once) {
    if (seen.has(text)) return;
    seen.add(text);
  }

  line.text = text;
  line.lines = String(text).trim().split("\n").filter((l) => l.trim() !== "");
  line.at = AT[opts.at] ?? AT.top;
  line.opts = opts;
  const c = opts.color;
  line.color = c === undefined ? ink : typeof c === "number" ? css(c) : c;
  line.left = opts.hold === undefined ? Infinity : opts.hold + FADE;
  line.fade = FADE;
  line.alpha = 1;
}

// Seconds until the line goes, and 0 when nothing is showing or the line that
// is has no hold and so is going nowhere.
export function left() {
  if (line.text === null || line.left === Infinity) return 0;
  return line.left;
}

// Every frame, in game or not: the first input ends a line that was going to
// fade anyway.
export function poll(dt) {
  if (finish.on) finish.t += dt;
  if (line.text === null || line.left === Infinity) return;

  line.left = Math.max(0, line.left - dt);
  const j = input.just;
  if ((j.act || j.up || j.right || j.down || j.left) && line.left > DISMISS) {
    line.left = DISMISS;
    line.fade = DISMISS;
  }
  line.alpha = Math.min(1, line.left / line.fade);
  if (line.left === 0) line.text = null;
}

// Only called between rounds.
export function update(_dt, start) {
  if (finish.t < DEAD) return;
  if (!input.just.act) return;
  finish.on = false;
  start();
}

export function render(ctx) {
  ctx.save();
  // The finish screen is the only thing over the board once the round is over.
  if (finish.on) renderFinish(ctx);
  else if (line.text !== null) renderLine(ctx);
  ctx.restore();
}

function renderLine(ctx) {
  const o = line.opts;
  const size = o.size ?? line.at.size;
  const lead = size * 1.55;
  const [align, valign] = anchor(o.align ?? line.at.align, "center", "top");
  const h = (line.lines.length - 1) * lead;

  // The block is anchored, not each line, so a two-line rule grows upward off a
  // bottom anchor rather than off the board.
  let y = (o.y ?? line.at.y) + size / 2;
  if (valign === "bottom") y -= h + size;
  else if (valign === "middle") y -= h / 2;

  ctx.globalAlpha = line.alpha;
  ctx.fillStyle = line.color;
  for (const l of line.lines) {
    ctx.text(l, o.x ?? line.at.x, y, size, { align, valign: "middle" });
    y += lead;
  }
  ctx.globalAlpha = 1;
}

// On the frame the round ends t is 0, so the dim and the text are both at
// nothing and this leaves the board as the game just drew it.
function renderFinish(ctx) {
  const e = ease(Math.min(1, finish.t / RISE));

  ctx.globalAlpha = DIM * e;
  ctx.fillStyle = meta.bg;
  ctx.fillRect(0, 0, 1024, 1024);
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
  const bx = 512 - w / 2;
  const by = 512 - h / 2;
  ctx.fillStyle = ink;

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

// mtext() sets the same font text() draws with, so the finish screen is
// measured in the face that ends up in it.
function width(ctx, txt, size) {
  return ctx.mtext(txt, size).width;
}

// The colour everything over the board is drawn in, and the gallery card's
// title, so tools/build.js calls this too. meta.fg is never a default: rope's
// is #402F2E on a #000000 board.
export function theme(m) {
  return m.overlay ?? pick(m.bg);
}

// WCAG relative luminance of a #rrggbb colour. Linearising is the step that
// matters: weighting the raw bytes calls #3DBF86 a 0.62 when it is a 0.40.
// Six-digit hex only; alma's color().contrast() reads any CSS colour and costs
// 12 KB a bundle.
function lum(c) {
  const n = hex(c);
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

// Whichever of DARK and LIGHT has the higher WCAG contrast ratio over `over`.
// The crossover is at luminance 0.19, not at the 0.5 midpoint: splitting at the
// midpoint puts berzerk's red on LIGHT at 3.3:1 where DARK gives 5.0:1.
function pick(over) {
  const y = lum(over);
  return ratio(y, L_DARK) >= ratio(y, L_LIGHT) ? DARK : LIGHT;
}
