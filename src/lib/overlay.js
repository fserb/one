/*
 * overlay.js - the screen every game shares. Two states, and one animated bar
 * between them:
 *
 *   game    44px of score, best score and the mute toggle. On the first round
 *           meta.desc sits over the running game and fades on the first input
 *           or a few seconds in, whichever lands first.
 *   finish  a frozen shot of the last frame, bar sliding back down over it.
 *           A click starts the next round.
 *
 * Nothing here consumes a click except the mute toggle. one.js calls update()
 * only while the overlay owns the screen, and render() after the game draws.
 */

import { ease, utils } from "../alma/src/index.js";
import { act, meta, mouse, op, score, SIZE } from "./state.js";

const BAR = 44;
const PAD = 11;
const FONT = 26;

// meta.desc holds, then fades. Input cuts it short with the quicker fade. A
// game reads the sum off hint() rather than either number.
const DESC_HOLD = 3;
const DESC_FADE = 0.6;
const DESC_DISMISS = 0.2;

const bar = {
  y: 0,
  height: BAR,
  scorey: 0,
  // The bar covers the game rather than the frozen shot.
  clear: false,
};

const desc = {
  lines: [],
  size: 0,
  y: 0,
  alpha: 0,
  // Faded or fading: input has nothing left to dismiss.
  gone: true,
  // Seconds until the hint is off the screen, zero the moment it is
  // dismissed. What hint() answers.
  left: 0,
};

const finish = {
  msg: null,
  shot: null,
};

let state = "game";

export function init() {
  score.best = localStorage.getItem(`one#${meta.title}`);
  if (score.best !== null) score.best = Number(score.best);

  state = "game";
  bar.y = 0;
  bar.height = BAR;
  bar.scorey = 0;
  bar.clear = false;

  desc.lines = meta.desc.trim().split("\n").filter((l) => l.trim() !== "");
  desc.alpha = 0;
  desc.gone = desc.lines.length === 0;
  desc.left = desc.gone ? 0 : DESC_HOLD + DESC_FADE;
  if (desc.gone) return;

  const longest = Math.max(...desc.lines.map((x) => x.length));
  desc.size = Math.min(
    800 / (desc.lines.length * 1.5),
    800 / (longest * 0.6),
  );
  desc.y = (SIZE - (desc.lines.length - 1) * desc.size * 1.5) / 2;
  desc.alpha = 1;

  act(desc).delay(DESC_HOLD)
    .attr("alpha", 0, DESC_FADE)
    .then(() => desc.gone = true);
}

export function startGame() {
  score.value = 0;
}

export function gameOver() {
  const best = score.best;
  score.best = best === null
    ? score.value
    : meta.scoreMax
    ? Math.max(best, score.value)
    : Math.min(best, score.value);
  localStorage.setItem(`one#${meta.title}`, score.best);

  // one.js reset every track, so a desc still fading would freeze on the shot.
  desc.alpha = 0;
  desc.gone = true;
  desc.left = 0;

  // The last frame minus the bar, with the bar sliding back down over it.
  const dim = op.screen.width;
  const [shot, sctx] = utils.newCanvas(dim, dim);
  sctx.drawImage(op.screen.canvas, 0, 0);
  sctx.clearRect(0, 0, dim, Math.ceil(dim * BAR / SIZE));
  finish.shot = shot;
  finish.msg = meta.finishGood ? "WELL DONE" : "GAME OVER";

  state = "finish";
  bar.clear = false;
  act(bar)
    .attr("y", SIZE - BAR, 0.35, ease.fastOutSlowIn)
    .attr("scorey", SIZE - BAR, 0.35, ease.fastOutSlowIn);
}

// Every frame, in game or not: the mute toggle is in the bar and the desc
// listens for the round's first input.
export function poll(dt) {
  desc.left = Math.max(0, desc.left - dt);

  if (!desc.gone && (mouse.click || mouse.swipe)) {
    desc.gone = true;
    desc.left = 0;
    act(desc).reset().attr("alpha", 0, DESC_DISMISS);
  }

  if (!mouse.click) return;
  // Null unless the game imported lib/sound.js: no cost, and no toggle.
  if (!op.sound?.available()) return;
  if (state !== "game" || mouse.x < SIZE / 2 || mouse.y >= BAR) return;
  op.sound.toggle();
}

// Seconds of meta.desc left, fade included; zero once dismissed or faded, after
// the round ends, and on every round after the first.
export function hint() {
  return desc.left;
}

// Only called between rounds, so the one state left to leave is "finish".
export function update(_dt, start) {
  if (act(bar).is()) return;
  if (!mouse.click) return;

  bar.clear = true;
  start();
  act(bar)
    .attr("y", 0, 0.35, ease.fastOutSlowIn)
    .attr("scorey", 2, 0.35, ease.fastOutSlowIn)
    .then(() => state = "game");
}

export function render(ctx) {
  ctx.save();

  if (state === "finish") {
    const w = ctx.canvas.width;
    if (bar.clear) {
      ctx.drawImage(finish.shot, 0, 0, w, w * bar.y / SIZE, 0, 0, SIZE, bar.y);
    } else {
      ctx.drawImage(finish.shot, 0, 0, SIZE, SIZE);
    }
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = meta.bg;
    ctx.fillRect(0, 0, SIZE, bar.y);
    ctx.globalAlpha = 1;

    ctx.fillStyle = meta.fg;
    ctx.text(finish.msg, SIZE / 2, bar.y - 800, 125);
  }

  ctx.fillStyle = meta.fg;
  ctx.fillRect(0, bar.y, SIZE, bar.height);

  if (desc.alpha > 0) {
    ctx.globalAlpha = desc.alpha;
    ctx.fillStyle = meta.fg;
    let y = desc.y;
    for (const line of desc.lines) {
      ctx.text(line, SIZE / 2, y, desc.size, { valign: "middle" });
      y += desc.size * 1.5;
    }
    ctx.globalAlpha = 1;
  }

  renderScore(ctx);
  ctx.restore();
}
function renderScore(ctx) {
  ctx.fillStyle = meta.bg;

  const best = score.best === null ? "" : ` BEST ${Math.floor(score.best)}`;
  const music = !op.sound?.available() ? "" : op.sound.isMuted() ? "♪" : "♫";
  ctx.text(`${music}${best}`, SIZE - PAD * 1.5, bar.scorey + PAD, FONT, {
    align: "right",
    valign: "top",
  });

  if (score.value > 0) {
    ctx.text(
      `SCORE ${Math.floor(score.value)}`,
      PAD * 1.5,
      bar.scorey + PAD,
      FONT,
      {
        align: "left",
        valign: "top",
      },
    );
  }

  if (op.topmsg) {
    ctx.text(op.topmsg, SIZE / 2, bar.scorey + PAD, FONT, { valign: "top" });
  }
}
