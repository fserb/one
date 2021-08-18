// ease
// ----
//
// This is a collection of commom ease functions.
// They all have the same `Float -> Float` signature.
// For a reference, check: http://easings.net/.

// import Bezier from "bezier-easing";

import {clamp} from "./extra.js";

export const linear = t => t;
export const reverse = t => 1 - t;
export const hold = _ => 1;
export const pow = (f, p) => t => Math.pow(f(t), p);
export const mix = (a, b, r) => t => (1 - r) * a(t) + r * b(t);
export const cross = (a, b) => (t => (1 - t) * a(t) + t * b(t));
export const reversed = f => t => 1 - f(1 - t);
export const mirrored = f =>
  t => t <= 0.5 ? f(2 * t) / 2 : (2 - f(2 * (1 - t))) / 2;
export function abs(f) {
  return t => {
    const v = f(t);
    if (v < 0) return -v;
    if (v > 1) return 1 - v;
    return v;
  }
};
export const bezier = (p1, p2) => t => 3 * t * (1 - t) * (1 - t) * p1 +
  3 * t * t * (1 - t) * p2 + t * t * t;

export function interp(data) {
  return t => {
    if (t <= 0) return 0.0;
    if (t >= 1) return 1.0;
    const p = t * (data.length - 1);
    const i = Math.floor(p);
    const d = p - i;
    return data[i] + d * (data[i + 1] - data[i]);
  }
};

function makeStep(inc2, step5) {
  return steps => t => {
    if (t == 0) return 0;
    return clamp((Math.floor(t * steps) + inc2) / (steps + step5), 0, 1);
  };
}

export const stepNone = makeStep(0, -1);
export const stepBoth = makeStep(1, 1);
export const stepStart = makeStep(1, 0);
export const stepEnd = makeStep(0, 0);

// CSS Ease functions.
// export const Bezier = Bezier;
// export const CSSeaseIn = Bezier(0.42, 0, 1, 1);
// export const CSSeaseOut = Bezier(0, 0, 0.58, 1);
// export const CSSeaseInOut = Bezier(0.42, 0, 0.58, 1);

// Exp approximations of CSS Ease functions.
export const easeIn = t => t ** 1.66908;
export const easeOut = reversed(t => t ** 1.66908);
export const easeInOut = mirrored(t => t ** 1.92023);

export const quadIn = t => t ** 2;
export const quadOut = reversed(quadIn);
export const quadInOut = mirrored(quadIn);

export const cubicIn = t => t ** 3;
export const cubicOut = reversed(cubicIn);
export const cubicInOut = mirrored(cubicIn);

export const quartIn = t => t ** 4;
export const quartOut = reversed(quartIn);
export const quartInOut = mirrored(quartIn);

export const quintIn = t => t ** 5;
export const quintOut = reversed(quintIn);
export const quintInOut = mirrored(quintIn);

export const polyIn = n => t => t ** n;
export const polyOut = n => reversed(polyIn(n));
export const polyInOut = n => mirrored(polyIn(n));

export const sinIn = t => 1 - Math.cos(t * Math.PI / 2);
export const sinOut = reversed(sinIn);
export const sinInOut = mirrored(sinIn);

export const expIn = t => 2 ** (10 * (t - 1));
export const expOut = reversed(expIn);
export const expInOut = mirrored(expIn);

export const circIn = t => 1 - Math.sqrt(1 - t ** 2);
export const circOut = reversed(circIn);
export const circInOut = mirrored(circIn);

// default s = 1.70158;
export const backIn = s => t => t * t * (s * (t - 1) + t);
export const backOut = s => reversed(backIn(s));
export const backInOut = s => mirrored(backIn(s));

const c4 = (2 * Math.PI) / 3;
export const elasticIn = t => t <= 0 ? 0 : t >= 1 ? 1 :
  -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * c4);
// export const elasticIn =
//   t => Math.sin(13 * t * Math.PI / 2) * 2 ** (10 * (t - 1));
export const elasticOut = reversed(elasticIn);
export const elasticInOut = mirrored(elasticIn);

export const bounceOut = t => {
  if (t < 1 / 2.75) return 7.5625 * (t ** 2);
  if (t < 2 / 2.75) return 7.5625 * ((t - 1.5 / 2.75) ** 2) + 0.75;
  if (t < 2.5 / 2.75) return 7.5625 * ((t - 2.25 / 2.75) ** 2) + 0.9375;
  return 7.5625 * ((t - 2.625 / 2.75) ** 2) + 0.984375;
};
export const bounceIn = reversed(bounceOut);
export const bounceInOut = mirrored(bounceIn);

// cubic-bezier(0.4, 0., 0.2, 1.0)
// compress(discretize(cubicBezierCSS(0.4, 0, 0.2, 1)))
function fastOutSlowInData() {
  const data = `545344434443344244242432333223231231212122022022121232333354546\
6576677778777878778786877867777776767767667667666757576576575674765665755755755\
74755665656557466565565655656556564746565556565556555656465`;
  const arr = [];
  let last = 0;
  let vel = 0;
  for (const a of data) {
    const dv = parseInt(a, 36) - 5;
    vel += dv;
    last -= vel;
    const x = last / 10000;
    arr.push(x);
  }
  return arr;
}
export const fastOutSlowIn = interp(fastOutSlowInData());

// HOW TO BUILD DISCRETIZE BEZIERS

function cubicBezier(p0, p1, p2, p3) {
  return t => {
    const ti = 1 - t;
    return (ti * ti * ti * p0 +
      3 * ti * ti * t * p1 +
      3 * ti * t * t * p2 +
      t * t * t * p3);
  };
}

function cubicBezier2D(p0, p1, p2, p3) {
  const cbx = cubicBezier(p0[0], p1[0], p2[0], p3[0]);
  const cby = cubicBezier(p0[1], p1[1], p2[1], p3[1]);
  return t => [cbx(t), cby(t)];
}

function cubicBezierCSS(a, b, c, d) {
  return cubicBezier2D([0, 0], [a, b], [c, d], [1, 1]);
}

function discretize(func, samples = 200, precision = 10000) {
  const data = new Array(samples);
  const T = samples * precision / 10;
  for (let i = 0; i <= T; ++i) {
    const [x, y] = f(i / T);
    const idx = Math.floor(x * (samples - 1));
    if (!data[idx]) data[idx] = 1;
    data[idx] = Math.round(precision * Math.min(data[idx], y)) / precision;
  }
  data[samples] = data[samples - 1];
  return data;
}

// HOW TO BUILD DATA

function compress(data, precision = 10000) {
  let last = 0;
  let vel = 0;
  let add = "";
  for (const v of data) {
    const n = Math.round((v - last) * precision);
    const dv = vel - n + 5;
    add += dv.toString(36);
    vel = n;
    last = v;
  }
  return add;
}
