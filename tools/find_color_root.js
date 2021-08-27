#!/usr/bin/env deno run

import fmin from 'https://jspm.dev/fmin';
import optimjs from 'https://jspm.dev/optimization-js';

function fromRGB(rgb) {
  const lin = [];
  for (let i = 0; i < 3; ++i) {
    const s = rgb[i] / 255;
    lin[i] = s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }
  return lin;
}

function toRGB(lin) {
  const rgb = [];
  for (let i = 0; i < 3; ++i) {
    const l = lin[i];
    const abs = Math.abs(l);
    const v = abs <= 0.0031308 ? l * 12.92 :
      Math.sign(l) * 1.055 * (abs ** (1 / 2.4)) - 0.055;
    rgb[i] = Math.round(Math.min(1.0, Math.max(0.0, v)) * 255);
  }
  return rgb;
}

function vec3Add(v1, v2) {
  return [v1[0] + v2[0], v1[1] + v2[1], v1[2] + v2[2]];
}

function vec3Scale(vec, s) {
  return [vec[0] * s, vec[1] * s, vec[2] * s];
}

const RYB_RYBCornersInRGB = [
  [1.0, 1.0, 1.0],  // Black
  [1.0, 0.0, 0.0],  // Red
  [0.9, 0.9, 0.0],  // Yellow = RGB Red+Green.  Still a bit high, but helps
  // Yellow compete against Green.  Lower gives murky yellows.
  [0.0, 0.36, 1.0],  // Blue: Green boost of 0.36 helps eliminate flatness of
  // spectrum around pure Blue
  [0.0, 0.9, 0.2],  // Green: A less intense green than {0,1,0}, which tends to
  // dominate.
  [1.0, 0.6, 0.0],  // Orange = RGB full Red, 60% Green
  [0.6, 0.0, 1.0],  // Purple = 60% Red, full Blue
  [0.0, 0.0, 0.0],  // White
];

function fromRYB(ryb) {
  const c00 = vec3Add(vec3Scale(RYB_RYBCornersInRGB[0], 1.0 - ryb[0]),
    vec3Scale(RYB_RYBCornersInRGB[1], ryb[0]));
  const c01 = vec3Add(vec3Scale(RYB_RYBCornersInRGB[3], 1.0 - ryb[0]),
    vec3Scale(RYB_RYBCornersInRGB[6], ryb[0]));
  const c10 = vec3Add(vec3Scale(RYB_RYBCornersInRGB[2], 1.0 - ryb[0]),
    vec3Scale(RYB_RYBCornersInRGB[5], ryb[0]));
  const c11 = vec3Add(vec3Scale(RYB_RYBCornersInRGB[4], 1.0 - ryb[0]),
    vec3Scale(RYB_RYBCornersInRGB[7], ryb[0]));

  const c0 = vec3Add(vec3Scale(c00, 1.0 - ryb[1]), vec3Scale(c10, ryb[1]));
  const c1 = vec3Add(vec3Scale(c01, 1.0 - ryb[1]), vec3Scale(c11, ryb[1]));

  return fromRGB(vec3Scale(
    vec3Add(vec3Scale(c0, 1.0 - ryb[2]), vec3Scale(c1, ryb[2])), 255));
}

function toRYB(lin, meta) {
  const rgb = vec3Scale(toRGB(lin), 1/255);

  const c00 = vec3Add(vec3Scale(meta[0], 1.0 - rgb[0]),
    vec3Scale(meta[1], rgb[0]));
  const c01 = vec3Add(vec3Scale(meta[3], 1.0 - rgb[0]),
    vec3Scale(meta[6], rgb[0]));
  const c10 = vec3Add(vec3Scale(meta[2], 1.0 - rgb[0]),
    vec3Scale(meta[5], rgb[0]));
  const c11 = vec3Add(vec3Scale(meta[4], 1.0 - rgb[0]),
    vec3Scale(meta[7], rgb[0]));

  const c0 = vec3Add(vec3Scale(c00, 1.0 - rgb[1]), vec3Scale(c10, rgb[1]));
  const c1 = vec3Add(vec3Scale(c01, 1.0 - rgb[1]), vec3Scale(c11, rgb[1]));

  const c = vec3Add(vec3Scale(c0, 1.0 - rgb[2]), vec3Scale(c1, rgb[2]));

  return c;
}

const DATA = [];
const STEP = 0.1;
for (let r = 0; r <= 1; r += STEP) {
  for (let g = 0; g <= 1; g += STEP) {
    for (let b = 0; b <= 1; b += STEP) {
      DATA.push([r, g, b]);
    }
  }
}
console.log(DATA.length);

function f(v) {
  const meta = [];
  for (let i = 0; i < 8; ++i) {
    meta.push(v.slice(i * 3, i * 3 + 3));
  }

  let error = 0;
  for (const d of DATA) {
    const out = fromRYB(toRYB(d, meta));
    for (let j = 0; j < 3; ++j) {
      error += (d[j] - out[j]) ** 2;
    }
  }

  return error;
}

let guess = [];
for (let i = 0; i < 24; ++i) guess[i] = Math.random();
// guess = [
//       1.2093504505252608,   0.0393164611941004,
//      -0.7150317648618727,   0.8021701521859361,
//       0.7128802473856486,  0.41545930112465557,
//      -0.5718818553774796,   0.7362541076152072,
//       1.2628383707058513,  0.44724426185225163,
//      -0.8707037622295086,   0.4701628180342905,
//     -0.11797942152566848,   0.5295529969172781,
//       0.4169433107890803,   0.6046159242358091,
//      -0.4080162645387172,  -0.3000219865509548,
//       0.4721343636827422,  0.12770796565863052,
//     -0.00494786568070657, -0.16499759055569907,
//       0.1430736415437841,  0.13191075703653055
//   ];
const unit = (1 / 255) * DATA.length;

const er = f(guess);
console.log("CURRENT", er, "V", Math.sqrt(er) / unit);

const dims = [];
for (let i = 0; i < 24; ++i) dims[i] = optimjs.Real(-3, 3);
const sol4 = optimjs.rs_minimize(f, dims, 20000, 50, 0.01);
console.log(sol4.best_x, Math.sqrt(sol4.best_y)/unit);

const sol3 = optimjs.minimize_Powell(f, guess);
console.log(sol3.argument, Math.sqrt(sol3.fncvalue) / unit);

const sol2 = fmin.nelderMead(f, guess, {maxIterations: 100000, zeroDelta: 1e-10, minErrorDelta: 1e-15, minTolerance: 1e-10});
console.log(sol2.x, Math.sqrt(sol2.fx)/unit);

// for (let i = 0; i < 100; ++i) {
//   const solver = new Ceres();
//   await solver.promise;
//   solver.add_function(f);
//   // for (let i = 0; i < 24; ++i) {
//   //   solver.add_lowerbound(i, -0.2);
//   //   solver.add_upperbound(i, 1.2);
//   // }
//   const s = solver.solve(guess, 10000, 1e-15, 1e-30, 1e-30, 1200);
//   console.log(s.message);
//   const err = f(s.x);
//   console.log(i, s.x, err, "V", 1/Math.sqrt(err));
//   guess = s.x;
//   solver.remove();
// }



/*

[
    1.1524589792929372,     1.4088507347069357,
    1.4186999116260175,     1.4395931117718692,
   0.14036430086220716,    0.09581438915961592,
  -0.12724798197649587,     1.0328026833551716,
    0.9609683721548424,     0.7101813200107729,
   0.09553069402300951,     1.1744751344736968,
   -0.6736096710074144,    0.23079660160641746,
    0.7673782502574188,     -0.102068171328007,
     1.047554404495589,   -0.13049078764409186,
    0.5599896275123647,    -0.7377582741198873,
    0.2402134821221439,    0.05367382094948623,
  0.031919618218673125, -0.0024440153339575664
]


[
                    1,                        1,
                    1,                        1,
                    0,                        0,
  -12.384405643874235,       0.9220993952229614,
  -0.6950346895476713,       0.4515387068586952,
   -8.608385681263943,      -1.2579535720035273,
   -0.703520685442572,       0.1963982269612518,
   0.7402187333278936,       0.9999894271941824,
   1.6666675026866913, -0.000001261091168880457,
   0.6168270095205716,      -1.1030179890230911,
  0.16012639416970884,                        0,
                    0,                        0
]

*/
