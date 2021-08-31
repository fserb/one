export const op = {
  currentTime: 0,
  inGame: false,

  canvas: null,
  ctx: null,

  game: {init: null, update: null, render: null},
  score: null,
  bestScore: null,
  message: null,
};

export const defaultOpts = {
  bgColor: 9,
  fgColor: 14,
  hasScore: true,
  scoreMax: true,
  finishGood: false,
  name: null,
  desc: null,
};

export let opts = defaultOpts;
export function setOpts(op) {
  opts = Object.assign(opts, op);
}

export const mouse = {
  x: 0, y: 0,
  click: false,
  press: false,
  release: false,
  swipe: 0,

  UP: 1,
  RIGHT: 2,
  DOWN: 3,
  LEFT: 4,
};

import * as ease from "./lib/ease.js";
export {ease};

import Act from "./lib/Act.js";
export const act = new Act();
