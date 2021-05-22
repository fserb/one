import "./lib/extend.js";
import plus2d from "./lib/plus2d.js";

import {stages, defaultOpts, C, opts, mouse, ease, setOpts, op,
  sysact, act} from "./internal.js";

import * as utils from "./lib/utils.js";

import camera from "./camera.js";
import * as vec from "./vec.js";
import * as sound from "./sound.js";

import * as input from "./input.js";
import * as intro from "./intro.js";
import * as finish from "./finish.js";
stages['intro'] = intro;
stages['finish'] = finish;


let stage = "intro";

export let score = 0;
export function addScore(v = 1) {
  score += v;
}
export function setScore(v) {
  score = v;
}
export let bestScore = null;

export let canvas = null;
export let ctx = null;

export let tick = 0;

let topmsg = "";

export { C, mouse, act, ease, utils, vec, camera, sound };

export function msg(m) {
  topmsg = m;
}

export function startGame() {
  stage = "game";
  tick = -1;
  score = 0;
  stages[stage].init();
}
op.startGame = startGame;

export function gameOver() {
  stage = "finish";
  stages[stage].init();

  if (opts.scoreMax) {
    bestScore = Math.max(bestScore ?? score, score);
  } else {
    bestScore = Math.min(bestScore ?? score, score);
  }

  localStorage.setItem("one#" + opts.name, bestScore);
}

function _renderScore() {
  if (stage == "intro") return;

  const b = 11;
  const fs = 26;

  ctx.fillStyle = opts.fgColor;
  ctx.fillRect(0, 0, 1024, 44);

  let best = "";
  let soundstatus = "";
  if (bestScore !== null) {
    best = ` BEST ${bestScore}`;
  }
  if (!sound.mute) {
    soundstatus = "♫";
  }

  ctx.fillStyle = opts.bgColor;
  ctx.text(`${soundstatus}${best}`, 1024 - b * 1.5, b, fs,
    {align: "right", valign: "top" });

  if (score > 0) {
    ctx.fillStyle = opts.bgColor;
    ctx.text("SCORE " + score, b * 1.5, b, fs,
      {align: "left", valign: "top" });
  }

  if (topmsg) {
    ctx.text(topmsg, 512, b, fs, {valign: "top" });
  }
}

function _render() {
  ctx.reset();
  ctx.save();
  const factor = canvas.width / 1024;
  ctx.scale(factor, factor);

  ctx.fillStyle = opts.bgColor;
  ctx.fillRect(0, 0, 1024, 1024);

  stages[stage].render(ctx);

  if (opts.hasScore) {
    _renderScore();
  }

  ctx.restore();
}

let currentTime = 0;
let accumulator = 0.0;
const frameRate = 1 / 60.0;
function _frame(now) {
  const dt = (now - currentTime) / 1000;
  currentTime = now;

  sysact._actFrame(dt);
  camera._update(dt);
  accumulator += dt;
  while (accumulator >= frameRate) {
    input.update();
    sound.update();
    stages[stage].update(tick);
    tick++
    accumulator -= frameRate;
  }

  _render();

  requestAnimationFrame(_frame);
}

export function main(obj) {
  document.body.style.backgroundColor = "#222";
  canvas = op.canvas = obj ?? document.getElementById("canvas");
  ctx = canvas.getContext("2d");
  plus2d(ctx);

  const ro = new ResizeObserver(changes => {
    canvas.width = Math.ceil(canvas.clientWidth * window.devicePixelRatio);
    canvas.height = Math.ceil(canvas.clientHeight * window.devicePixelRatio);
  });
  ro.observe(canvas);

  // load score
  bestScore = localStorage.getItem("one#" + opts.name);

  sound.init();
  input.init();
  stages[stage].init();

  _frame(0);
}

export function options(o) {
  setOpts(o);
}

export function game(init, update, render) {
  stages['game']['init'] = init;
  stages['game']['update'] = update;
  stages['game']['render'] = render;
  return main;
}

export function description(n, s) {
  opts.name = n;
  opts.desc = s;
}
