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
// expoort const fastOutSlowIn = ease.interp([
//   0, 0.0001, 0.0002, 0.0005, 0.0009, 0.0014,
//   0.002, 0.0028, 0.0037, 0.0047, 0.0058, 0.0071, 0.0086, 0.0102, 0.0119,
//   0.0139, 0.016, 0.0182, 0.0207, 0.0233, 0.0262, 0.0292, 0.0324, 0.0359,
//   0.0396, 0.0435, 0.0476, 0.052, 0.0567, 0.0616, 0.0668, 0.0722, 0.078,
//   0.0841, 0.0904, 0.0971, 0.1041, 0.1115, 0.1192, 0.1273, 0.1357, 0.1444,
//   0.1536, 0.1631, 0.1729, 0.1832, 0.1938, 0.2047, 0.216, 0.2276, 0.2396,
//   0.2519, 0.2644, 0.2772, 0.2902, 0.3034, 0.3168, 0.3304, 0.344, 0.3577,
//   0.3714, 0.3852, 0.3989, 0.4125, 0.4261, 0.4395, 0.4528, 0.466, 0.479,
//   0.4918, 0.5044, 0.5168, 0.5289, 0.5408, 0.5525, 0.564, 0.5752, 0.5862,
//   0.5969, 0.6074, 0.6177, 0.6277, 0.6375, 0.647, 0.6564, 0.6655, 0.6744,
//   0.6831, 0.6915, 0.6998, 0.7079, 0.7158, 0.7235, 0.731, 0.7383, 0.7454,
//   0.7524, 0.7592, 0.7659, 0.7724, 0.7787, 0.7849, 0.7909, 0.7968, 0.8026,
//   0.8082, 0.8137, 0.8191, 0.8243, 0.8294, 0.8344, 0.8393, 0.844, 0.8487,
//   0.8532, 0.8577, 0.862, 0.8662, 0.8704, 0.8744, 0.8783, 0.8822, 0.8859,
//   0.8896, 0.8932, 0.8966, 0.9001, 0.9034, 0.9066, 0.9098, 0.9129, 0.9159,
//   0.9189, 0.9217, 0.9245, 0.9273, 0.9299, 0.9325, 0.9351, 0.9375, 0.9399,
//   0.9423, 0.9445, 0.9468, 0.9489, 0.951, 0.9531, 0.9551, 0.957, 0.9589,
//   0.9607, 0.9625, 0.9642, 0.9659, 0.9676, 0.9691, 0.9707, 0.9722, 0.9736,
//   0.975, 0.9763, 0.9776, 0.9789, 0.9801, 0.9813, 0.9824, 0.9835, 0.9846,
//   0.9856, 0.9866, 0.9875, 0.9884, 0.9893, 0.9901, 0.9909, 0.9916, 0.9924,
//   0.993, 0.9937, 0.9943, 0.9949, 0.9954, 0.9959, 0.9964, 0.9969, 0.9973,
//   0.9977, 0.998, 0.9983, 0.9986, 0.9989, 0.9991, 0.9993, 0.9995, 0.9997,
//   0.9998, 0.9999, 0.9999, 1, 1, 1]);

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
