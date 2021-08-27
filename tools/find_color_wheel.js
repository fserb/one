#!/usr/bin/env deno run

import fmin from 'https://jspm.dev/fmin';


function vec3Add(v1, v2) {
  return [v1[0] + v2[0], v1[1] + v2[1], v1[2] + v2[2]];
}

function vec3Scale(vec, s) {
  return [vec[0] * s, vec[1] * s, vec[2] * s];
}

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


// Values from: https://github.com/ProfJski/ArtColors
const RYB_RYBCornersInRGB = [
  [0.0, 0.0, 0.0],  // Black
  [1.0, 0.0, 0.0],  // Red
  [0.9, 0.9, 0.0],  // Yellow = RGB Red+Green.  Still a bit high, but helps
  // Yellow compete against Green.  Lower gives murky yellows.
  [0.0, 0.36, 1.0],  // Blue: Green boost of 0.36 helps eliminate flatness of
  // spectrum around pure Blue
  [0.0, 0.9, 0.2],  // Green: A less intense green than {0,1,0}, which tends to
  // dominate.
  [1.0, 0.6, 0.0],  // Orange = RGB full Red, 60% Green
  [0.6, 0.0, 1.0],  // Purple = 60% Red, full Blue
  [1.0, 1.0, 1.0],  // White
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

function toHSV(lin) {
  const rgb = vec3Scale(toRGB(lin), 1 / 255);
  const max = Math.max(...rgb);
  const min = Math.min(...rgb);
  const d = max - min;
  let h = 0;
  const s = max === 0 ? 0 : d / max;
  const v = max;

  if(max != min) {
    switch(max) {
    case rgb[0]: h = (rgb[1] - rgb[2]) / d + (rgb[1] < rgb[2] ? 6 : 0); break;
    case rgb[1]: h = (rgb[2] - rgb[0]) / d + 2; break;
    case rgb[2]: h = (rgb[0] - rgb[1]) / d + 4; break;
    }
    h /= 6;
  }
  return [h * 360, s * 100, v * 100];
}


function step2(deg) {
  let out = 0.0;
  let sc = 0.0;
  while (deg<0.0) { deg+=360.0; }
  while (deg>360.0) { deg-=360.0; }

  if (deg<=60.0) {
    out=1.0;
  } else if ( (deg>60.0)&&(deg<=120.0) ) {
    sc=(deg-60.0)/60.0;
    out=1.0-2.0*sc/Math.sqrt(1.0+3.0*sc*sc);
  } else if ( (deg>120.0) && (deg<=240.0) ) {
    out=0.0;
  } else if ( (deg>240.0) && (deg<=300.0) ) {
    sc=(deg-240.0)/60.0;
    out=2.0*sc/Math.sqrt(1.0+3.0*sc*sc);
  } else if ( (deg>300.0) && (deg<=360.0) ) {
    out=1.0;
  }
  return out;
}

function map2(deg) {
  const ryb = [step2(deg), step2(deg - 120), step2(deg - 240)];
  // console.log(ryb);
  return fromRYB(ryb);
}

const meta = [];

for (let angle = 0; angle < 360; angle += 1) {
  const lin = map2(angle);
  const h = toHSV(lin)[0];
  meta.push([angle, h]);
  // console.log(angle, "\t", h - angle);
}

const steps = [36, 60, 133.304347826086, 218.35294117647, 276];

function convert(h, p) {
  // forward 60, 120, 180, 240, 300, 360
  // back 36, 60, 133.304347826086, 218.35294117647, 276

  // const m = Math.floor(h / 60);

  let m = 0;
  while (m < 5 && h > steps[m]) m++;

  const a = p[m * 3];
  const b = p[m * 3 + 1];
  const c = p[m * 3 + 2];

  h -= m > 0 ? steps[m - 1] : 0;
  return a * h * h + b * h + c;
}


function f(params) {
  let error = 0;
  for (const p of meta) {
    error += (p[0] - convert(p[1], params)) ** 2;
  }
  error /= meta.length;
  return Math.sqrt(error);
}

const range = 500;

let guess = [];
for (let i = 0; i < 6 * 3; ++i) guess[i] = 2 * range * Math.random() - range;
const forward_guess = [
  -0.010632956090946805,    1.2128926862946168,
    0.35611418711755777, -0.006521826622978523,
     0.7813828384407733,     36.02797549736357,
  -0.020607685719692636,     2.465587836660755,
      58.75669745898428, -0.033224525523286016,
     3.4085067722243476,    129.60812529337136,
  -0.020472063077856345,    2.1635961550112306,
     217.30612754214098,   -0.0315572853062677,
     3.2350413044306565,    274.99872080388843
];
guess = [
   0.04513311857837293,  -0.20445167202360698,
     4.072364105530735,   0.09682738527979295,
  -0.19147360443289188,     64.63334805364067,
  0.009391601336911106, -0.015287010703255346,
    124.53193364354047,  0.008683435998464753,
   -0.2040624514457089,    185.96338453951356,
   0.01951117387355343,  -0.28747300742491044,
     245.4069206257945,  0.010107710529561314,
    -0.299485457933696,     306.9429275617285
]

const sol = fmin.nelderMead(f, guess, {maxIterations: 1000000, zeroDelta: 1e-20, minErrorDelta: 1e-25, minTolerance: 1e-20});
console.log(sol.x, sol.fx);
