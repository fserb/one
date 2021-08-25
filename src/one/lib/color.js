/*
A good color library

- theme:
  - complementary
  - triad
  - tetrad
  - monochromatic
  - split complementary
  - analogous

- tools:
  - getConstrast of 2 colors
  - deltaE ?
  - WCAG luminosity
  - WCAG contrast ratio

pex-color: https://github.com/pex-gl/pex-color/blob/master/index.js
qix-color: https://github.com/Qix-/color
compass: https://github.com/chriseppstein/compass-colors
ruby color: https://github.com/halostatue/color/tree/master/lib

chroma: https://gka.github.io/chroma.js
tinyColor: https://bgrins.github.io/TinyColor/
colorJS: https://colorjs.io/
color2k: https://color2k.com/

RGB mix: https://github.com/ricokahler/color2k/blob/main/src/mix.ts
spaces: https://colorjs.io/docs/spaces.html
*/


/*

color("#FFF").

*/

let parseCtx;

/*
We store all colors as [0, 1] linear sRGB.
*/
class Color {
  constructor(input, alpha) {
    if (alpha !== undefined) {
      this.v = [input[0], input[1], input[2], alpha];
    } else {
      this.v = cssParse(input);
    }
  }

  toString() {
    const r = linearTosRGB(this.v[0]);
    const g = linearTosRGB(this.v[1]);
    const b = linearTosRGB(this.v[2]);
    return `rgba(${r}, ${g}, ${b}, ${this.v[3]})`;
  }

  inRGB(func) {
    const rgb = [linearTosRGB(this.v[0]), linearTosRGB(this.v[1]),
      linearTosRGB(this.v[2])];
    const a = func(rgb, this.v[3]) ?? this.v[3];
    rgb[0] = sRGBToLinear(rgb[0] / 255);
    rgb[1] = sRGBToLinear(rgb[1] / 255);
    rgb[2] = sRGBToLinear(rgb[2] / 255);
    return new Color(rgb, a);
  }

  inOKLAB(func) {
    const _mto = matrix3Multiply(OKLAB_to_m1, this.v);
    _mto[0] = Math.cbrt(_mto[0]);
    _mto[1] = Math.cbrt(_mto[1]);
    _mto[2] = Math.cbrt(_mto[2]);
    const lab = matrix3Multiply(OKLAB_to_m2, _mto);
    const a = func(lab, this.v[3]) ?? this.v[3];
    const _mfrom = matrix3Multiply(OKLAB_from_m1, lab);
    _mfrom[0] = _mfrom[0] * _mfrom[0] * _mfrom[0];
    _mfrom[1] = _mfrom[1] * _mfrom[1] * _mfrom[1];
    _mfrom[2] = _mfrom[2] * _mfrom[2] * _mfrom[2];
    const rgb = matrix3Multiply(OKLAB_from_m2, _mfrom);
    return new Color(rgb, a);
  }

  inOKLCH(func) {
    return this.inOKLAB((lab, alpha)=> {
      const lch = [lab[0],
        Math.hypot(lab[1], lab[2]),
        (Math.atan2(lab[2], lab[1]) * 180 / Math.PI + 360) % 360];
      if (Math.round(lch[1] * 10000) === 0) {
        lch[2] = Number.NaN;
      }
      const a = func(lch, alpha);
      const h = isNaN(lch[2]) ? 0 : lch[2] * Math.PI / 180;
      lab[0] = lch[0];
      lab[1] = Math.cos(h) * lch[1];
      lab[2] = Math.sin(h) * lch[1];
      return a;
    });
  }

  lighten(amount = 0.25) {
    return this.inOKLAB(lch => {
      lch[0] *= (1 + amount);
    });
  }

  saturate(amount = 0.25) {
    return this.inOKLCH(lch => {
      lch[1] *= (1 + amount);
    });
  }

  hue(h) {
    return this.inOKLCH(lch => {
      lch[2] = h;
    });
  }

  grayscale() {
    return this.inOKLCH(lch => {
      lch[1] = lch[2] = 0;
    });
  }

  alpha(a) {
    return new Color(this.v, a);
  }

  mixlab(other, weight) {
    if (other.constructor !== this.constructor) other = new Color(other);
    return this.inOKLAB((lab, a) => {
      let outAlpha = 0;
      other.inOKLAB((olab, oa) => {
        const alphaDelta = oa - a;
        const x = weight * 2 - 1;
        const y = x * alphaDelta === -1 ? x : x + alphaDelta;
        const z = 1 + x * alphaDelta;
        const w1 = (y / z + 1) / 2.0;
        const w0 = 1 - w1;
        lab[0] = lab[0] * w0 + olab[0] * w1;
        lab[1] = lab[1] * w0 + olab[1] * w1;
        lab[2] = lab[2] * w0 + olab[2] * w1;
        outAlpha = oa * weight + a * (1 - weight);
      });
      return outAlpha;
    });
  }




  // makeComplementary() {
  //   const out = this.inOKLCH(lch => {
  //       lch[2] = (lch[2] + 180) % 360;
  //     });

  //   if (!hsv) return out;

  //   return out.inHSV(outhsv => {
  //     this.inHSV(inhsv => {
  //       outhsv[1] = inhsv[1];
  //       outhsv[2] = inhsv[2];
  //     });
  //   });
  // }
}

export default function color(input) {
  return new Color(input);
}

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

function matrix3Multiply(matrix, vec) {
  return [
    matrix[0] * vec[0] + matrix[1] * vec[1] + matrix[2] * vec[2],
    matrix[3] * vec[0] + matrix[4] * vec[1] + matrix[5] * vec[2],
    matrix[6] * vec[0] + matrix[7] * vec[1] + matrix[8] * vec[2]];
}

function sRGBToLinear(s) {
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function linearTosRGB(l) {
  const abs = Math.abs(l);
  const v = abs <= 0.0031308 ? l * 12.92 :
    Math.sign(l) * 1.055 * (abs ** (1 / 2.4)) - 0.055;
  return Math.round(Math.min(1.0, Math.max(0.0, v)) * 255);
}

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
  let rgba;
  if (type == '#') {
    const d = data;
    rgba = [parseInt(d.substr(0, 2), 16), parseInt(d.substr(2, 2), 16),
      parseInt(d.substr(4, 2), 16), 1];
  } else if (type == 'rgba') {
    rgba = data.split(',').map(parseFloat);
  } else {
    console.error("Invalid color", parsed.groups);
    return null;
  }

  return [sRGBToLinear(rgba[0] / 255), sRGBToLinear(rgba[1] / 255),
    sRGBToLinear(rgba[2] / 255), rgba[3]];
}
