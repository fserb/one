// internal

export const stages = {
  intro: null,
  game: {intro: null, update: null, render: null},
  finish: null,
};

export const op = {};

export const defaultOpts = {
  bgColor: 9,
  fgColor: 14,
  shColor: -1,
  hasScore: true,
  scoreMax: true,
  finishGood: false,
  name: null,
  desc: null,
};


// https://lospec.com/palette-list/downgraded-32
export const C = [ "#7b334c", "#a14d55", "#c77369", "#e3a084", "#f2cb9b",
"#d37b86", "#af5d8b", "#804085", "#5b3374", "#412051", "#5c486a", "#887d8d",
"#b8b4b2", "#dcdac9", "#ffffe0", "#b6f5db", "#89d9d9", "#72b6cf", "#5c8ba8",
"#4e6679", "#464969", "#44355d", "#3d003d", "#621748", "#942c4b", "#c7424f",
"#e06b51", "#f2a561", "#fcef8d", "#b1d480", "#80b878", "#658d78" ];

export let opts = defaultOpts;
export function setOpts(op) {
  opts = Object.assign(opts, op);
}

export const mouse = {
  x: 0, y: 0,
  click: false,
  press: false,
};

import _ease from "./lib/ease.js";
export const ease = _ease;

import Act from "./lib/Act.js";
export const sysact = new Act();
export function act(obj) {
  return sysact.act(obj);
}
act.is = () => sysact.isActing();
