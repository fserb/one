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
  hasScore: true,
  scoreMax: true,
  finishGood: false,
  name: null,
  desc: null,
};

export const C = Object.assign({}, [ "#F2F0E5", "#B8B5B9", "#646365", "#45444F",
"#212123", "#352B42", "#4B4158", "#5F556A", "#474969", "#4B80CA", "#669ECA",
"#68C2D3", "#A2DCC7", "#EDE19E", "#D3A068", "#E2A084", "#B45252", "#C6424F",
"#932C4B", "#402F2E", "#7E6352", "#B9A588", "#FFF18A", "#E6B951", "#C2D368",
"#8AB060", "#567B79", "#4E584A", "#7B7243", "#B2B47E", "#EDC8C4", "#C990C6" ]);
C.white = C[0];
C.lightGrey = C[1];
C.darkGrey = C[2];
C.black = C[4];
C.purple = C[5];
C.blue = C[9];
C.cyan = C[11];
C.brown = C[19];
C.lightBrown = C[20];
C.yellow = C[22];
C.gold = C[23];
C.lightGreen = C[24];
C.green = C[25];
C.darkGreen = C[26];
C.lime = C[28];
C.lightPink = C[30];
C.pink = C[31];

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
