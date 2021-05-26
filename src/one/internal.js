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

export const C = Object.assign({}, [ "#F2F0E5", "#B8B5B9", "#646365", "#45444F",
"#212123", "#352B42", "#4B4158", "#5F556A", "#474969", "#4B80CA", "#669ECA",
"#68C2D3", "#A2DCC7", "#EDE19E", "#D3A068", "#E2A084", "#B45252", "#C6424F",
"#932C4B", "#402F2E", "#7E6352", "#B9A588", "#FFF18A", "#E6B951", "#C2D368",
"#8AB060", "#567B79", "#4E584A", "#7B7243", "#B2B47E", "#EDC8C4", "#C990C6" ]);

export let opts = defaultOpts;
export function setOpts(op) {
  opts = Object.assign(opts, op);
}

export const mouse = {
  x: 0, y: 0,
  click: false,
  press: false,
  release: false,
};

import _ease from "./lib/ease.js";
export const ease = _ease;

import Act from "./lib/Act.js";
export const sysact = new Act();
export function act(obj) {
  return sysact.act(obj);
}
act.is = () => sysact.isActing();
