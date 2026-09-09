/*
 * overlay.js - the bits of screen that are the same in every game.
 *
 * Two states, and one animated bar that carries the transition between them:
 *
 *   game    the bar is 44px of score, best score and the mute toggle. On the
 *           first round meta.desc sits on top of the running game and fades,
 *           on the first input or a few seconds in, whichever lands first.
 *           hint() is how long that hint has left, which is what a game whose
 *           opening move would kill a player who is still reading waits out.
 *   finish  a frozen screenshot of the last frame, with the bar sliding back
 *           down over it. A click starts the next round.
 *
 * There is no title card: run() starts the round on frame one, and the first
 * input goes to the game. Nothing here ever consumes a click except the mute
 * toggle inside the bar.
 *
 * The game itself never sees any of this. one.js calls update() only while the
 * overlay owns the screen, and render() after the game has drawn.
 */

import { ease, utils } from "../alma/src/index.js";
import { act, meta, mouse, op, score, SIZE } from "./state.js";

const BAR = 44;
const PAD = 11;
const FONT = 26;

// meta.desc holds this long, then fades on its own. Input cuts it short with
// the quicker fade, so the hint leaves as soon as the player does not need it.
// A game reads the sum off hint() rather than either number.
const DESC_HOLD = 3;
const DESC_FADE = 0.6;
const DESC_DISMISS = 0.2;

const bar = {
  y: 0,
  height: BAR,
  scorey: 0,
  // The bar covers the game rather than showing the frozen shot through it.
  clear: false,
};

const desc = {
  lines: [],
  size: 0,
  y: 0,
  alpha: 0,
  // Faded out, or on its way there: input has nothing left to dismiss.
  gone: true,
  // Seconds until the hint is off the screen, counted down every frame and
  // dropped to zero the moment the player dismisses it. What hint() answers.
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

  // one.js reset every track on the way in, so a desc still fading would sit
  // frozen on top of the screenshot.
  desc.alpha = 0;
  desc.gone = true;
  desc.left = 0;

  // Freeze the last frame, minus the bar, and slide the bar back down over it.
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

// Runs every frame, in game or not: the mute toggle lives in the bar, and the
// desc listens for the first input of the round.
export function poll(dt) {
  desc.left = Math.max(0, desc.left - dt);

  if (!desc.gone && (mouse.click || mouse.swipe)) {
    desc.gone = true;
    desc.left = 0;
    act(desc).reset().attr("alpha", 0, DESC_DISMISS);
  }

  if (!mouse.click) return;
  // op.sound is null unless the game imported lib/sound.js, so a silent game
  // costs nothing here and shows no toggle.
  if (!op.sound?.available()) return;
  if (state !== "game" || mouse.x < SIZE / 2 || mouse.y >= BAR) return;
  op.sound.toggle();
}

// Seconds of meta.desc still on the screen, fade included, and zero once the
// player has dismissed it, once it has faded, once the round is over and on
// every round after the first. A game whose opening would kill a player who is
// still reading holds off for this long, which also means the hold ends the
// moment the player starts playing.
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
