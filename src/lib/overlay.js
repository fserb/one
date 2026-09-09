/*
 * overlay.js - the bits of screen that are the same in every game.
 *
 * Three states, and one animated bar that carries the transition between them:
 *
 *   intro   the bar is a full-height card holding meta.desc. A click shrinks
 *           it to the top of the screen, and the game starts behind it.
 *   game    the bar is 44px of score, best score and the mute toggle.
 *   finish  a frozen screenshot of the last frame, with the bar sliding back
 *           down over it. A click starts the next round.
 *
 * The game itself never sees any of this. one.js calls update() only while the
 * overlay owns the screen, and render() after the game has drawn.
 */

import { ease, utils } from "../alma/src/index.js";
import { act, meta, mouse, op, score, SIZE } from "./state.js";
import * as sound from "./sound.js";

const BAR = 44;
const PAD = 11;
const FONT = 26;

const bar = {
  y: SIZE,
  height: 0,
  scorey: 0,
  // The bar covers the game rather than showing the intro text through it.
  clear: false,
};

const intro = {
  lines: [],
  size: 0,
  y: 0,
};

const finish = {
  msg: null,
  shot: null,
};

let state = "intro";

export function init(forceStart = false) {
  score.best = localStorage.getItem(`one#${meta.title}`);
  if (score.best !== null) score.best = Number(score.best);

  intro.lines = meta.desc.trim().split("\n");
  const longest = Math.max(...intro.lines.map((x) => x.length));
  intro.size = Math.min(
    800 / (intro.lines.length * 1.5),
    800 / (longest * 0.6),
  );
  intro.y = (SIZE - (intro.lines.length - 1) * intro.size * 1.5) / 2;

  const height = (1.5 + intro.lines.length) * intro.size * 1.5;
  const top = (SIZE - height) / 2;

  if (forceStart) {
    state = "game";
    bar.y = 0;
    bar.height = BAR;
    return;
  }

  state = "intro";
  bar.y = SIZE;
  // One frame of delay so the card grows out of the bottom edge, not from
  // wherever the first frame's dt happens to land.
  act(bar)
    .delay(1 / 60)
    .attr("y", top, 0.25, ease.fastOutSlowIn)
    .attr("height", SIZE - top, 0.25, ease.fastOutSlowIn).then()
    .attr("height", height, 0.35, ease.fastOutSlowIn).then();
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

// Runs every frame, in game or not: the mute toggle lives in the bar.
export function poll() {
  if (!mouse.click) return;
  if (!sound.available()) return;
  if (state !== "game" || mouse.x < SIZE / 2 || mouse.y >= BAR) return;
  sound.toggle();
}

export function update(_dt, start) {
  if (act(state).is()) return;
  if (!mouse.click) return;

  if (state === "intro") {
    // Shrink from wherever the card got to, so an early click is not ignored.
    const t = 0.35 * (SIZE - BAR - bar.y) / (SIZE - BAR);
    act(bar)
      .attr("y", SIZE - BAR, t, ease.quadIn)
      .attr("height", BAR, t, ease.quadIn)
      .then(() => bar.clear = true)
      .then(start)
      .attr("y", 0, 0.35, ease.fastOutSlowIn)
      .then(() => state = "game");
    return;
  }

  if (state === "finish") {
    bar.clear = true;
    start();
    act(bar)
      .attr("y", 0, 0.35, ease.fastOutSlowIn)
      .attr("scorey", 2, 0.35, ease.fastOutSlowIn)
      .then(() => state = "game");
  }
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

  if (state === "intro") {
    ctx.fillStyle = meta.bg;
    if (bar.clear) {
      ctx.fillRect(0, 0, SIZE, bar.y);
    } else {
      let y = intro.y;
      for (const line of intro.lines) {
        ctx.text(line, SIZE / 2, y, intro.size, { valign: "middle" });
        y += intro.size * 1.5;
      }
    }
  }

  renderScore(ctx);
  ctx.restore();
}

function renderScore(ctx) {
  ctx.fillStyle = meta.bg;

  const best = score.best === null ? "" : ` BEST ${Math.floor(score.best)}`;
  const music = !sound.available() ? "" : sound.isMuted() ? "♪" : "♫";
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
