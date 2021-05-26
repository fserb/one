// overlay

import {opts, act, mouse, ease, op} from "./internal.js";

import {newCanvas} from "./lib/utils.js";
import * as sound from "./sound.js";

const bar = {
  y: 512,
  height: 0,
  scorey: 0,
}

const intro = {
  lines: null,
  size: 0,
  y: 0,
};

const finish = {
  msg: null,
  shot: null,
  clear: false,
};

let state = "";

export function init() {
  // load score
  op.bestScore = localStorage.getItem("one#" + opts.name);

  // set up intro message
  intro.lines =  opts.desc.strip().split('\n');
  intro.size = Math.min(800 / (intro.lines.length * 1.5),
    800 / (Math.max(...intro.lines.map(x => x.length)) * 0.6));

  const height = (1.5 + intro.lines.length) * intro.size * 1.5;
  bar.y = 1024;
  const bary = (1024 - height) / 2;

  intro.y = (1024 - (intro.lines.length - 1) * intro.size * 1.5) / 2;

  act(bar)
    .delay(1/60)
    .attr("y", bary, 0.25, ease.fastOutSlowIn)
    .attr("height", 1024 - bary, 0.25, ease.fastOutSlowIn).then()
    .attr("height", height, 0.35, ease.fastOutSlowIn).then();

  state = "intro";
}

export function startGame() {
  op.score = 0;
  state = "game";
}

export function gameOver() {
  if (opts.scoreMax) {
    op.bestScore = Math.max(op.bestScore ?? op.score, op.score);
  } else {
    op.bestScore = Math.min(op.bestScore ?? op.score, op.score);
  }
  localStorage.setItem("one#" + opts.name, op.bestScore);

  // finish init
  const dim = op.canvas.width;
  const [shot, sctx] = newCanvas(dim, dim);
  finish.shot = shot;
  sctx.drawImage(op.canvas, 0, 0);
  sctx.fillStyle = opts.bgColor;
  sctx.clearRect(0, 0, dim, Math.ceil(dim * 44 / 1024));

  finish.clear = false;
  finish.msg = opts.finishGood ? "WELL DONE" : "GAME OVER";

  state = "finish";
  act(bar)
    .attr("y", 1024 - 44, 0.35, ease.fastOutSlowIn)
    .attr("scorey", 1024 - 44, 0.35, ease.fastOutSlowIn);
}

export function update(dt, start) {
  if (act(state).is()) return;
  if (!mouse.click) return;

  if (state == "intro") {
    act(bar).attr("y", 0, 0.15, ease.fastInSlowOut)
      .attr("height", bar.height + bar.y, 0.15, ease.fastInSlowOut)
      .then()
      .attr("height", 44, 0.25, ease.fastInSlowOut)
      .then(start);
  }
  if (state == "finish") {
    finish.clear = true;
    act(bar)
    .attr("y", 0, 0.35, ease.fastOutSlowIn)
    .attr("scorey", 0, 0.35, ease.fastOutSlowIn)
    .delay(0.1)
    .then(start);
  }
}

export function render(ctx) {
  ctx.save();

  if (state == "finish") {
    ctx.drawImage(finish.shot, 0, 0, 1024, 1024);
    ctx.globalAlpha = 0.80;
    ctx.fillStyle = opts.bgColor;
    ctx.fillRect(0, 0, 1024, bar.y);
    ctx.globalAlpha = 1.0;

    ctx.fillStyle = opts.fgColor;
    ctx.text(finish.msg, 512, bar.y - 800, 125);

    if (finish.clear) {
      ctx.fillStyle = opts.bgColor;
      ctx.fillRect(0, bar.y + bar.height, 1024, 1024 - bar.y + bar.height);
    }
  }

  ctx.fillStyle = opts.fgColor;
  ctx.fillRect(0, bar.y, 1024, bar.height);

  if (state == "intro") {
    ctx.fillStyle = opts.bgColor;
    let y = intro.y;
    for (const l of intro.lines) {
      ctx.text(l, 512, y, intro.size, {valign: "middle"});
      y += intro.size * 1.5;
    }
  }

  renderScore(ctx);
  ctx.restore();
}

function renderScore(ctx) {
  const b = 11;
  const fs = 26;

  let best = "";
  let soundstatus = "";
  if (op.bestScore !== null) {
    best = ` BEST ${Math.floor(op.bestScore)}`;
  }

  if (!sound.mute) {
    soundstatus = "♫";
  }

  ctx.fillStyle = opts.bgColor;
  ctx.text(`${soundstatus}${best}`, 1024 - b * 1.5, bar.scorey + b, fs,
    {align: "right", valign: "top" });

  if (op.score > 0) {
    ctx.fillStyle = opts.bgColor;
    ctx.text("SCORE " + Math.floor(op.score), b * 1.5, bar.scorey + b, fs,
      {align: "left", valign: "top" });
  }

  if (op.topmsg) {
    ctx.text(op.topmsg, 512, bar.scorey + b, fs, {valign: "top" });
  }
}