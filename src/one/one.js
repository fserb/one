import "./lib/extend.js";
import plus2d from "./lib/plus2d.js";

import {C, opts, mouse, ease, setOpts, op, sysact, act} from "./internal.js";

export * as utils from "./lib/utils.js";
export * as vec from "./lib/vec.js";

import * as input from "./input.js";
import * as sound from "./sound.js";
import camera from "./camera.js";

export {C, mouse, act, ease, camera, sound};

import * as overlay from "./overlay.js";

export function addScore(v = 1) {
  op.score += v;
}
export function setScore(v) {
  op.score = v;
}

export let canvas = null;
export let ctx = null;

export function msg(m) {
  op.message = m;
}

export function startGame() {
  overlay.startGame();
  op.inGame = true;
  lastFixedTime = op.currentTime;
  accumulator = 0.0;
  op.game.init();
}

export function gameOver() {
  sysact.reset();
  op.inGame = false;
  overlay.gameOver();
}

function _render() {
  ctx.reset();
  ctx.save();

  const factor = canvas.width / 1024;
  ctx.scale(factor, factor);

  ctx.fillStyle = opts.bgColor;
  ctx.fillRect(0, 0, 1024, 1024);

  if (op.inGame) {
    ctx.save();
    op.game.render(ctx);
    ctx.restore();
  }

  overlay.render(ctx);

  ctx.restore();
}

let accumulator = 0.0;
let lastFixedTime = 0;
export function fixedUpdate(frameRate, func) {
  const dt = (op.currentTime - lastFixedTime) / 1000;
  accumulator += dt;
  lastFixedTime = op.currentTime;
  while (accumulator >= frameRate) {
    func();
    accumulator -= frameRate;
  }
}

function _frame(now) {
  const dt = (now - op.currentTime) / 1000;
  op.currentTime = now;

  sysact._actFrame(dt);
  camera._update(dt);
  input.update();
  sound.update();

  if (op.inGame) {
    op.game.update(dt);
  } else {
    overlay.update(dt, startGame);
  }

  _render();

  requestAnimationFrame(_frame);
}

export function main(obj) {
  document.body.style.backgroundColor = "#222";
  canvas = op.canvas = obj ?? document.getElementById("canvas");
  ctx = canvas.getContext("2d");
  plus2d(ctx);

  const ro = new ResizeObserver(_changes => {
    canvas.width = Math.ceil(canvas.clientWidth * window.devicePixelRatio);
    canvas.height = Math.ceil(canvas.clientHeight * window.devicePixelRatio);
  });
  ro.observe(canvas);

  op.inGame = false;

  input.init();
  overlay.init();

  _frame(0);
}

export function options(o) {
  setOpts(o);
}

export function game(init, update, render) {
  op.game.init = init;
  op.game.update = update;
  op.game.render = render;
  return main;
}

export function description(n, s) {
  opts.name = n;
  opts.desc = s;
}
