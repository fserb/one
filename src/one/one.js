
import "./lib/extend.js";
import plus2d from "./lib/plus2d.js";
import Act from "./lib/Act.js";
import _ease from "./lib/ease.js";

import * as intro from "./intro.js";
import * as finish from "./finish.js";
import * as input from "./input.js";

import * as _utils from "./lib/utils.js";

const defaultOpts = {
  bgColor: 9,
  fgColor: 14,
  shColor: -1,
  hasScore: true,
  scoreMax: true,
  finishGood: false,
};
export let opts = null;

// https://lospec.com/palette-list/downgraded-32
export const C = [ "#7b334c", "#a14d55", "#c77369", "#e3a084", "#f2cb9b",
"#d37b86", "#af5d8b", "#804085", "#5b3374", "#412051", "#5c486a", "#887d8d",
"#b8b4b2", "#dcdac9", "#ffffe0", "#b6f5db", "#89d9d9", "#72b6cf", "#5c8ba8",
"#4e6679", "#464969", "#44355d", "#3d003d", "#621748", "#942c4b", "#c7424f",
"#e06b51", "#f2a561", "#fcef8d", "#b1d480", "#80b878", "#658d78" ];

let stage = "intro";
export const stages = {
  intro: intro,
  game: {intro: null, update: null, render: null},
  finish: finish,
};

export let score = 0;
export function addScore(v = 1) {
  score += v;
}
export let bestScore = null;

export let desc = null;
export let name = null;

export let canvas = null;
export let ctx = null;

export let tick = 0;

export const mouse = {
  x: 0, y: 0,
  click: false,
  press: false,
};

export const ease = _ease;
const sysact = new Act();
export function act(obj) {
  return sysact.act(obj);
}
act.is = () => sysact.isActing();

export function startGame() {
  stage = "game";
  tick = -1;
  score = 0;
  stages[stage].init();
}

export function gameOver() {
  stage = "finish";
  stages[stage].init();

  if (opts.scoreMax) {
    bestScore = Math.max(bestScore ?? score, score);
  } else {
    bestScore = Math.min(bestScore ?? score, score);
  }

  localStorage.setItem("one#" + name, bestScore);
}

function _renderScore() {
  const b = 10;
  const fs = 40;
  if (bestScore !== null) {
    ctx.fillStyle = C[opts.fgColor];
    ctx.text("BEST " + bestScore, 1024 - b, b, fs,
    {align: "right", valign: "top" });
  }

  if (stage != "intro") {
    ctx.fillStyle = C[opts.fgColor];
    ctx.text("SCORE " + score, b, b, fs,
      {align: "left", valign: "top" });
  }
}

function _render() {
  ctx.reset();
  ctx.save();
  const factor = canvas.width / 1024;
  ctx.scale(factor, factor);

  ctx.fillStyle = C[opts.bgColor];
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
  accumulator += dt;
  while (accumulator >= frameRate) {
    input.update();
    stages[stage].update(tick);
    tick++
    accumulator -= frameRate;
  }

  _render();

  requestAnimationFrame(_frame);
}

export function main(obj) {
  canvas = obj ?? document.getElementById("canvas");
  ctx = canvas.getContext("2d");
  plus2d(ctx);

  const ro = new ResizeObserver(changes => {
    canvas.width = Math.ceil(canvas.clientWidth * window.devicePixelRatio);
    canvas.height = Math.ceil(canvas.clientHeight * window.devicePixelRatio);
  });
  ro.observe(canvas);

  // load score
  bestScore = localStorage.getItem("one#" + name);

  input.init();
  stages[stage].init();

  _frame(0);
}

export function options(o) {
  opts = Object.assign(defaultOpts, o);
}

export function game(init, update, render) {
  stages['game']['init'] = init;
  stages['game']['update'] = update;
  stages['game']['render'] = render;
  return main;
}

export function description(n, s) {
  name = n;
  desc = s;
}

export const utils = _utils;