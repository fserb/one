/*
A good color library

- tools:
  - getConstrast of 2 colors
  - deltaE ?
  - WCAG luminosity
  - WCAG contrast ratio

- step palettes

pex-color: https://github.com/pex-gl/pex-color/blob/master/index.js
qix-color: https://github.com/Qix-/color
compass: https://github.com/chriseppstein/compass-colors
ruby color: https://github.com/halostatue/color/tree/master/lib

chroma: https://gka.github.io/chroma.js
tinyColor: https://bgrins.github.io/TinyColor/
colorJS: https://colorjs.io/
color2k: https://color2k.com/
ArtColors: https://github.com/ProfJski/ArtColors

RGB mix: https://github.com/ricokahler/color2k/blob/main/src/mix.ts
spaces: https://colorjs.io/docs/spaces.html

*/

function vec3Multiply(matrix, vec) {
  return [
    matrix[0] * vec[0] + matrix[1] * vec[1] + matrix[2] * vec[2],
    matrix[3] * vec[0] + matrix[4] * vec[1] + matrix[5] * vec[2],
    matrix[6] * vec[0] + matrix[7] * vec[1] + matrix[8] * vec[2]];
}

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
    const v = l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055;
    rgb[i] = Math.round(Math.min(1.0, Math.max(0.0, v)) * 255);
  }
  return rgb;
}

// from https://bottosson.github.io/posts/oklab/
const OKLAB_to_m1 = [
  0.4122214708, 0.5363325363, 0.0514459929,
  0.2119034982, 0.6806995451, 0.1073969566,
  0.0883024619, 0.2817188376, 0.6299787005,
];

const OKLAB_to_m2 = [
  0.2104542553, +0.7936177850, -0.0040720468,
  1.9779984951, -2.4285922050, +0.4505937099,
  0.0259040371, +0.7827717662, -0.8086757660
];

const OKLAB_from_m1 = [
  1, +0.3963377774, +0.2158037573,
  1, -0.1055613458, -0.0638541728,
  1, -0.0894841775, -1.2914855480
];

const OKLAB_from_m2 = [
  +4.0767416621, -3.3077115913, +0.2309699292,
  -1.2684380046, +2.6097574011, -0.3413193965,
  -0.0041960863, -0.7034186147, +1.7076147010,
];

function toOKLAB(lin) {
  const _mto = vec3Multiply(OKLAB_to_m1, lin);
  _mto[0] = Math.cbrt(_mto[0]);
  _mto[1] = Math.cbrt(_mto[1]);
  _mto[2] = Math.cbrt(_mto[2]);
  return vec3Multiply(OKLAB_to_m2, _mto);
}

function fromOKLAB(oklab) {
  const _mfrom = vec3Multiply(OKLAB_from_m1, oklab);
  _mfrom[0] = _mfrom[0] * _mfrom[0] * _mfrom[0];
  _mfrom[1] = _mfrom[1] * _mfrom[1] * _mfrom[1];
  _mfrom[2] = _mfrom[2] * _mfrom[2] * _mfrom[2];
  return vec3Multiply(OKLAB_from_m2, _mfrom);
}

function toOKLCH(lin) {
  const oklab = toOKLAB(lin);
  const lch = [oklab[0],
    Math.hypot(oklab[1], oklab[2]),
    (Math.atan2(oklab[2], oklab[1]) * 180 / Math.PI + 360) % 360];
  if (Math.round(lch[1] * 10000) === 0) lch[2] = Number.NaN;
  return lch;
}

function fromOKLCH(oklch) {
  const h = isNaN(oklch[2]) ? 0 : oklch[2] * Math.PI / 180;
  const oklab = [oklch[0], Math.cos(h) * oklch[1], Math.sin(h) * oklch[1]];
  return fromOKLAB(oklab);
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

function fromHSV(hsv) {
  const h = (hsv[0] / 360) * 6;
  const s = hsv[1] / 100;
  const v = hsv[2] / 100;

  const i = Math.floor(h);
  const f = h - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const mod = i % 6;
  const r = [v, q, p, p, t, v][mod];
  const g = [t, v, v, q, p, p][mod];
  const b = [p, p, t, v, v, q][mod];

  return fromRGB([r * 255, g * 255, b * 255]);
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

// optimized by tools/find_color_wheel.js
const toPSV_pieces = [
  [0.04513311857837293,  -0.20445167202360698, 4.072364105530735],
  [0.09682738527979295, -0.19147360443289188, 64.63334805364067],
  [0.009391601336911106, -0.015287010703255346, 124.53193364354047],
  [0.008683435998464753, -0.2040624514457089, 185.96338453951356],
  [0.01951117387355343, -0.28747300742491044, 245.4069206257945],
  [0.010107710529561314, -0.299485457933696, 306.9429275617285],
];
const toPSV_steps = [36, 60, 133.304347826086, 218.35294117647, 276];

function toPSV(lin) {
  const hsv = toHSV(lin);

  let m = 0;
  let h = hsv[0];
  while (m < 5 && h > toPSV_steps[m]) m++;
  const abc = toPSV_pieces[m];
  h -= m > 0 ? toPSV_steps[m - 1] : 0;

  return [abc[0] * h * h + abc[1] * h + abc[2], hsv[1], hsv[2]];
}

// based on https://github.com/ProfJski/ArtColors/blob/master/RYB.cpp
function step2(deg) {
  while (deg < 0.0) deg += 360;
  deg %= 360;

  if (deg <= 60.0) {
    return 1.0;
  }

  if (deg <= 120.0) {
    const sc = (deg - 60.0) / 60.0;
    return 1.0 - 2.0 * sc / Math.sqrt(1.0 + 3.0 * sc * sc);
  }

  if (deg <= 240.0) {
    return 0.0;
  }

  if (deg <= 300.0) {
    const sc = (deg - 240.0) / 60.0;
    return 2.0 * sc / Math.sqrt(1.0 + 3.0 * sc * sc);
  }

  return 1.0;
}

function fromPSV(psv) {
  let p = psv[0];
  while (p < 0) p += 360;
  p %= 360;
  const ryb = [step2(p), step2(p - 120), step2(p - 240)];
  const hsv = toHSV(fromRYB(ryb));
  return fromHSV([hsv[0], psv[1], psv[2]]);
}

function fromOKLCP(lcp) {
  let p = lcp[2];
  while (p < 0) p += 360;
  p %= 360;
  const ryb = [step2(p), step2(p - 120), step2(p - 240)];
  const lch = toOKLCH(fromRYB(ryb));

  return fromOKLCH([lcp[0], lcp[1], lch[2]]);
}

function toOKLCP(lin) {
  const lch = toOKLCH(lin);

  const hsv = toHSV(lin);
  let m = 0;
  let h = hsv[0];
  while (m < 5 && h > toPSV_steps[m]) m++;
  const abc = toPSV_pieces[m];
  h -= m > 0 ? toPSV_steps[m - 1] : 0;

  return [lch[0], lch[1], abc[0] * h * h + abc[1] * h + abc[2]];
}

function lerp(a, b, w) {
  const w1 = 1 - w;
  return [w1 * a[0] + w * b[0], w1 * a[1] + w * b[1], w1 * a[2] + w * b[2]];
}

let parseCtx;

function cssParse(input) {
  // The first thing we do is let canvas parse the input.
  if (!parseCtx) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    parseCtx = canvas.getContext("2d");
  }
  parseCtx.fillStyle = "#000";
  parseCtx.fillStyle = input;
  let computed = parseCtx.fillStyle;
  parseCtx.fillStyle = "#FFF";
  parseCtx.fillStyle = input;
  if (computed != parseCtx.fillStyle) {
    computed = input;
  }

  // parse #abcdef or <name>(<values>,...)
  const parsed = computed.match(
    /(?<type>\#|\w+)\(?(?<data>[0-9a-hA-H]{6}$|.*?(?=\)))/);
  if (!parsed) {
    console.error("Invalid color:", input);
    return null;
  }
  const {type, data} = parsed.groups;
  let lin;
  let alpha = 1.0;
  if (type == '#') {
    const d = data;
    lin = fromRGB([parseInt(d.substr(0, 2), 16), parseInt(d.substr(2, 2), 16),
      parseInt(d.substr(4, 2), 16)]);
  } else {
    const f = data.split(',').map(parseFloat);
    alpha = f[3] ?? 1.0;
    if (type == 'rgba') {
      lin = fromRGB(f);
    } else if (type == 'hsv') {
      lin = fromHSV(f);
    } else if (type == 'oklcp') {
      lin = fromOKLCP(f);
    } else if (type == 'oklch') {
      lin = fromOKLCH(f);
    } else {
      console.error("Invalid color", parsed.groups);
      return null;
    }
  }

  return [lin, alpha];
}

/*
We store all colors as [0, 1] linear sRGB.
*/
class Color {
  constructor(input, alpha = 1.0) {
    this.lin = input;
    this.alpha = alpha;
  }

  toString() {
    const rgb = toRGB(this.lin);
    return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${this.alpha})`;
  }

  lighten(amount = 0.25) {
    const lab = toOKLAB(this.lin);
    lab[0] *= (1 + amount);
    return new Color(fromOKLAB(lab), this.alpha);
  }

  saturate(amount = 0.25) {
    const lch = toOKLCH(this.lin);
    lch[1] *= (1 + amount);
    return new Color(fromOKLCH(lch), this.alpha);
  }

  rotate(p) {
    const lcp = toOKLCP(this.lin);
    lcp[2] = (lcp[2] + p) % 360;
    return new Color(fromOKLCP(lcp), this.alpha);
  }

  grayscale() {
    const lch = toOKLCH(this.lin);
    lch[1] = lch[2] = 0;
    return new Color(fromOKLCH(lch), this.alpha);
  }

  alpha(a) {
    return new Color(this.lin, a);
  }

  mixlab(other, weight) {
    if (other.constructor !== this.constructor) other = color(other);
    const lab = toOKLAB(this.lin);
    const olab = toOKLAB(other.lin);
    return color(fromOKLAB(lerp(lab, olab, weight)));
  }

  mixlin(other, weight) {
    if (other.constructor !== this.constructor) other = color(other);
    return color(lerp(this.lin, other.lin, weight));
  }

  mixrgb(other, weight) {
    if (other.constructor !== this.constructor) other = color(other);
    return color(fromRGB(lerp(toRGB(this.lin), toRGB(other.lin), weight)));
  }

  mixquad(other, weight) {
    if (other.constructor !== this.constructor) other = color(other);

    const ra = toRGB(this.lin);
    const rb = toRGB(other.lin);

    const out = [];
    for (let i = 0; i < 3; ++i) {
      const a = Math.max(0, Math.min(255, ra[i]));
      const b = Math.max(0, Math.min(255, rb[i]));

      out.push(Math.sqrt((1 - weight) * a * a + weight * b * b));
    }
    return color(fromRGB(out));
  }

  mixsub(other, weight) {
    if (other.constructor !== this.constructor) other = color(other);

    const a = toRGB(this.lin);
    const b = toRGB(other.lin);

    const f = [
      Math.max(0, 255 - (255 - a[0]) - (255 - b[0])),
      Math.max(0, 255 - (255 - a[1]) - (255 - b[1])),
      Math.max(0, 255 - (255 - a[2]) - (255 - b[2]))];

    const dist = Math.hypot(a[0] - b[0],
      a[1] - b[1],
      a[2] - b[2])/(Math.sqrt(3) * 255);

    const cd = 4 * weight * (1 - weight) * dist;

    return color(fromRGB(lerp(lerp(a, b, weight), f, cd)));
  }

  makeComplement() {
    return this.rotate(180);
  }

  makeTriad() {
    return [this, this.rotate(120), this.rotate(240)];
  }

  makeTetrad(d=90) {
    return [this, this.rotate(d), this.rotate(180), this.rotate(180+d)];
  }

  makeAnalogous(d = 45) {
    return [this.rotate(-d), this, this.rotate(d)];
  }

  makeSplitComplement(d = 30) {
    return [this, this.rotate(180 - d), this.rotate(180 + d)];
  }
}

export default function color(input) {
  if (Array.isArray(input)) {
    return new Color(input);
  }
  return new Color(...cssParse(input));
}
