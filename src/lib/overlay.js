/*
 * overlay.js - the panels every game shares. Floating panels over the board,
 * and nothing else: no bar, no reserved strip, no mute button.
 *
 *   playing  msg() in a chip at the top-centre, and nothing else. A game that
 *            says nothing runs on a bare board, which is most of them.
 *   hint     hint("...") raises a panel at the bottom, which fades on the first
 *            input or a few seconds in. Opt-in: meta.desc no longer draws.
 *   finish   the frozen board, dimmed, and whatever gameOver() asked for. A
 *            click starts the next round.
 *
 * Every panel is drawn in one pair of colours, meta.overlay, which a game may
 * set and usually does not: the default fill is whichever of two off-neutrals
 * reads over the board, and the default text is whichever reads over that
 * fill. meta.fg never enters unasked, so rope and grab, whose fg and bg are
 * almost the same colour, still get a panel you can read.
 *
 * There is no running score. The score is kept, and it is on the finish screen,
 * but a number in the corner for the whole round is a HUD, and this is a board
 * with panels over it. A game that wants a number in play draws it itself, the
 * way asteroid draws its own on the way out.
 *
 * Nothing here consumes a click. one.js calls update() only between rounds and
 * render() after the game draws.
 */

import { color, ease, utils } from "../alma/src/index.js";
import { mouse } from "./input.js";
import { meta, op, score, SIZE } from "./one.js";

const MARGIN = 26;
const RADIUS = 12;

// Off black and off white: a panel over a black game still reads as a panel.
// These two are only the defaults; a game naming meta.overlay is not held to
// them.
const DARK = "#17171b";
const LIGHT = "#f5f4f0";

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

// The two colours this round's panels are drawn in, from theme(meta).
let panel = { bg: DARK, fg: LIGHT };

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
  // The last frame of the board, taken before any panel went over it.
  shot: null,
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
  finish.showPanel = msg !== null || wantScore || win;
  finish.title = !finish.showPanel ? null : msg ?? (win ? "WELL DONE" : "GAME OVER");
}

// one.js draws the board once more after the round ends and hands the canvas
// here, so the frozen shot holds the game and none of the panels.
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
  else renderMsg(ctx);
  if (tip.alpha > 0) renderHint(ctx);
  ctx.restore();
}

function renderMsg(ctx) {
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

/*
 * One floating rectangle, filled in the theme and left as the current fillStyle
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
  ctx.fillStyle = panel.bg;
  ctx.beginPath();
  ctx.roundRect(bx, by, w, h, RADIUS);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = panel.fg;
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
 * The two colours every panel is drawn in, for a game's meta. `meta.overlay`
 * names either half and both are optional:
 *
 *   overlay: { bg: "#3A2A1E", fg: "#F5E8D8" }   both named
 *   overlay: { bg: "#3A2A1E" }                  fg derived to read over it
 *   (absent)                                    both derived from meta.bg
 *
 * The chain composes because each default is picked against the colour it will
 * actually sit on: the fill against the board, the text against the fill. So a
 * game that dislikes only the fill names only the fill.
 *
 * meta.fg is never a default. rope's fg is #402F2E on a #000000 board and
 * grab's is nearly its own board too, so a panel drawn in fg is unreadable on
 * both; a game that does want its own colour there asks for it by name.
 *
 * tools/build.js calls this as well. The gallery card writes its title in the
 * fill colour rather than the text colour: the title sits straight on the
 * clip with no panel behind it, and the fill is the half picked to read over
 * the board.
 */
export function theme(m) {
  const bg = m.overlay?.bg ?? pick(m.bg);
  return { bg, fg: m.overlay?.fg ?? pick(bg) };
}

/*
 * Whichever of DARK and LIGHT reads better over `over`, by WCAG contrast ratio.
 * Not "is `over` itself light or dark": the crossover between the two sits at
 * luminance 0.19, not at the 0.5 midpoint, because a mid-tone field is much
 * closer to white than it looks. Splitting at the midpoint puts berzerk's red
 * on LIGHT at 3.3:1 where DARK gives 5.0:1. Over the 23 boards it comes out 12
 * DARK and 11 LIGHT.
 *
 * alma's contrast() linearises sRGB before weighting the channels, which is
 * the step that matters: the weights on the raw bytes call #3DBF86 a 0.62 when
 * it is a 0.40, most of the way to the wrong panel.
 */
function pick(over) {
  const c = color(over);
  return c.contrast(DARK) >= c.contrast(LIGHT) ? DARK : LIGHT;
}
