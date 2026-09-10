/*
 * art.js - the ugl look: a 6x8 bitmap font and a chunky-pixel renderer.
 *
 * The vault games draw everything out of two-colour dithered pixels 3 to 8
 * screen units wide. `art` collects an entity's pixels; entity.js blits them
 * centred on its position.
 *
 * ```js
 * art.size(3).color(0xe1b81f, 0xa37d1d, 32).circle(8, 8, 8);
 * ```
 *
 * `size(px)` is how wide one pixel is; shapes are addressed in pixels, so a
 * radius of 8 at size 3 is 48 units across. gfx.js takes the font and the
 * colour cache from here.
 *
 * `color(c, c2, pat)` is the dither. `pat` is up to three digits read
 * right-to-left as periods along x, y and x+y; a pixel counts
 * `x % xpat + y % ypat + (x + y) % xypat` and takes `c` when that is even,
 * `c2` when odd. So 32 is "3 across, 2 down" and a bare 0 is a flat fill.
 */

const FONTWIDTH = 6;
const FONTHEIGHT = 8;

// Based on Minecraftia.ttf. Two 32-bit words per glyph from space to '~', the
// 48 pixels of a 6x8 cell packed most-significant bit first.
const FONTDATA = [
  0x00000000,
  0x00000000,
  0x82082080,
  0x08000000,
  0x514a0000,
  0x00000000,
  0x514f94f9,
  0x45000000,
  0x21e81c0b,
  0xc2000000,
  0x8a410841,
  0x28800000,
  0x21421ab2,
  0x46800000,
  0x41080000,
  0x00000000,
  0x31082081,
  0x03000000,
  0xc0810410,
  0x8c000000,
  0x00091890,
  0x00000000,
  0x00823e20,
  0x80000000,
  0x00000002,
  0x08200000,
  0x00003e00,
  0x00000000,
  0x00000002,
  0x08000000,
  0x08410841,
  0x08000000,
  0x7229aaca,
  0x27000000,
  0x21820820,
  0x8f800000,
  0x72208c42,
  0x2f800000,
  0x72208c0a,
  0x27000000,
  0x18a4a2f8,
  0x20800000,
  0xfa0f020a,
  0x27000000,
  0x31083c8a,
  0x27000000,
  0xfa208420,
  0x82000000,
  0x72289c8a,
  0x27000000,
  0x72289e08,
  0x46000000,
  0x02080002,
  0x08000000,
  0x02080002,
  0x08200000,
  0x10842040,
  0x81000000,
  0x000f8003,
  0xe0000000,
  0x81020421,
  0x08000000,
  0x72208420,
  0x02000000,
  0x7a1b6dbe,
  0x07800000,
  0x7228be8a,
  0x28800000,
  0xf22f228a,
  0x2f000000,
  0x72282082,
  0x27000000,
  0xf228a28a,
  0x2f000000,
  0xfa0e2082,
  0x0f800000,
  0xfa0e2082,
  0x08000000,
  0x7a0ba28a,
  0x27000000,
  0x8a2fa28a,
  0x28800000,
  0xe1041041,
  0x0e000000,
  0x0820820a,
  0x27000000,
  0x8a4e248a,
  0x28800000,
  0x82082082,
  0x0f800000,
  0x8b6aa28a,
  0x28800000,
  0x8b2aa68a,
  0x28800000,
  0x7228a28a,
  0x27000000,
  0xf22f2082,
  0x08000000,
  0x7228a28a,
  0x46800000,
  0xf22f228a,
  0x28800000,
  0x7a07020a,
  0x27000000,
  0xf8820820,
  0x82000000,
  0x8a28a28a,
  0x27000000,
  0x8a28a251,
  0x42000000,
  0x8a28a2ab,
  0x68800000,
  0x8942148a,
  0x28800000,
  0x89420820,
  0x82000000,
  0xf8210842,
  0x0f800000,
  0xe2082082,
  0x0e000000,
  0x81040810,
  0x40800000,
  0xe0820820,
  0x8e000000,
  0x21488000,
  0x00000000,
  0x00000000,
  0x0f800000,
  0x82040000,
  0x00000000,
  0x0007027a,
  0x27800000,
  0x820b328a,
  0x2f000000,
  0x00072282,
  0x27000000,
  0x0826a68a,
  0x27800000,
  0x000722fa,
  0x07800000,
  0x310f1041,
  0x04000000,
  0x0007a289,
  0xe0bc0000,
  0x820b328a,
  0x28800000,
  0x80082082,
  0x08000000,
  0x0800820a,
  0x289c0000,
  0x820928c2,
  0x89000000,
  0x82082082,
  0x04000000,
  0x000d2aaa,
  0x28800000,
  0x000f228a,
  0x28800000,
  0x0007228a,
  0x27000000,
  0x000b328b,
  0xc8200000,
  0x0006a689,
  0xe0820000,
  0x000b3282,
  0x08000000,
  0x0007a070,
  0x2f000000,
  0x410e1041,
  0x02000000,
  0x0008a28a,
  0x27800000,
  0x0008a289,
  0x42000000,
  0x0008a2aa,
  0xa7800000,
  0x00089421,
  0x48800000,
  0x0008a289,
  0xe0bc0000,
  0x000f8421,
  0x0f800000,
  0x31042041,
  0x03000000,
  0x82080082,
  0x08000000,
  0xc0820420,
  0x8c000000,
  0x66600000,
  0x00000000,
];

const GLYPHS = new Map();

// The pixels of `text` at one unit per pixel, laid out as ugl does:
// proportional, each glyph two pixels past the rightmost lit column so far.
// Everything scales linearly, so callers multiply.
export function glyphs(text) {
  const hit = GLYPHS.get(text);
  if (hit) return hit;

  const dots = [];
  let curx = 0;
  let maxx = 0;

  for (const ch of text) {
    let c = ch.codePointAt(0);
    if (c <= 32 || c > 126) {
      c = 32;
      maxx += FONTWIDTH;
    }
    for (let p = 0; p < FONTWIDTH * FONTHEIGHT; ++p) {
      const word = FONTDATA[(c - 32) * 2 + (p >= 32 ? 1 : 0)];
      if ((word & (1 << (31 - (p % 32)))) === 0) continue;
      const x = curx + (p % FONTWIDTH);
      if (x > maxx) maxx = x;
      dots.push(x, Math.floor(p / FONTWIDTH));
    }
    curx = maxx + 2;
  }

  const out = { width: curx, height: FONTHEIGHT, dots };
  GLYPHS.set(text, out);
  return out;
}

const CSS = new Map();

export function css(c) {
  let s = CSS.get(c);
  if (s === undefined) {
    s = `#${(c & 0xffffff).toString(16).padStart(6, "0")}`;
    CSS.set(c, s);
  }
  return s;
}

/*
 * The midpoint circle walk, one point per step over the first octant, which
 * circle() mirrors into four spans and lcircle() into eight dots. Held here
 * because the two have to agree: an outline drawn by one walk and a fill by
 * another sit a pixel apart at half the radii.
 *
 * alma's bresenhamCircle() is the other midpoint variant, off `3 - 2r` rather
 * than `1 - x`, and picks different pixels at 29 of the first 60 radii. At
 * size 3 to 8 that is a visible change to every sprite, so this stays.
 */
function octant(r, step) {
  let x = Math.round(r);
  let y = 0;
  let err = 1 - x;
  while (x >= y) {
    step(x, y);
    y++;
    if (err < 0) {
      err += 2 * y + 1;
    } else {
      x--;
      err += 2 * (y - x + 1);
    }
  }
}

/*
 * A bag of chunky pixels in pixel coordinates. Every shape reduces to dot(),
 * which resolves the dither and appends to a run; render() blits the lot
 * centred on the origin. ugl centred the sprite's bounding box only when it
 * started at the origin, which is how the games draw. This always centres.
 */
export class Art {
  constructor() {
    this.runs = [];
    this.texts = [];
    this.px = 1;
    this.color1 = 0xffffff;
    this.color2 = 0xffffff;
    this.xpat = 0;
    this.ypat = 0;
    this.xypat = 0;
    this.boxw = 0;
    this.boxh = 0;
    this.disabled = false;
    this.cached = -1;
    this.dirty = true;
  }

  // px is one pixel wide. w and h fix the box the art centres in, which obj()
  // also reads as its row length.
  size(px = 1, w = 0, h = 0) {
    if (this.disabled) return this;
    this.px = px;
    if (w > 0 || h > 0) {
      this.boxw = w;
      this.boxh = h;
      this.clear();
    }
    return this;
  }

  color(c, c2 = -1, pat = 0) {
    if (this.disabled) return this;
    this.color1 = c;
    this.color2 = c2 === -1 ? c : c2;
    const a = pat % 10;
    const b = Math.floor(pat / 10) % 10;
    const c3 = Math.floor(pat / 100) % 10;
    if (b === 0 && c3 === 0) {
      this.xpat = a;
      this.ypat = this.xypat = 0;
    } else if (c3 === 0) {
      this.xpat = b;
      this.ypat = a;
      this.xypat = 0;
    } else {
      this.xpat = c3;
      this.ypat = b;
      this.xypat = a;
    }
    return this;
  }

  clear() {
    this.runs.length = 0;
    this.texts.length = 0;
    this.disabled = false;
    this.cached = -1;
    this.dirty = true;
    return this;
  }

  // Skip every drawing call until the index changes: the games redraw inside
  // update().
  cache(idx) {
    if (idx === this.cached) {
      this.disabled = true;
    } else {
      this.cached = idx;
      this.clear();
    }
    return this;
  }

  dot(x, y) {
    if (this.disabled) return this;

    // The dither reads the whole pixel the dot falls in, the run keeps the
    // coordinate given: ugl drew at x*px with no rounding, so
    // `rect(0, 1.5, 4, 1)` is a one-pixel bar centred on a four-pixel box.
    let v = 0;
    if (this.xpat > 0) v += Math.trunc(x) % this.xpat;
    if (this.ypat > 0) v += Math.trunc(y) % this.ypat;
    if (this.xypat > 0) v += Math.trunc(x + y) % this.xypat;
    const c = v % 2 === 0 ? this.color1 : this.color2;

    // Shapes emit left to right, so most dots extend the last run.
    const last = this.runs[this.runs.length - 1];
    if (last && last[1] === y && last[3] === c && last[0] + last[2] === x) {
      last[2] += 1;
    } else {
      this.runs.push([x, y, 1, c]);
    }
    this.dirty = true;
    return this;
  }

  hline(x0, x1, y) {
    if (this.disabled) return this;
    if (x1 < x0) [x0, x1] = [x1, x0];
    for (let x = x0; x <= x1; ++x) this.dot(x, y);
    return this;
  }

  vline(x, y0, y1) {
    if (this.disabled) return this;
    if (y1 < y0) [y0, y1] = [y1, y0];
    for (let y = y0; y <= y1; ++y) this.dot(x, y);
    return this;
  }

  rect(x, y, w, h) {
    if (this.disabled) return this;
    for (let j = 0; j < Math.round(h); ++j) {
      for (let i = 0; i < Math.round(w); ++i) this.dot(x + i, y + j);
    }
    return this;
  }

  lrect(x, y, w, h) {
    if (this.disabled) return this;
    this.vline(x, y, y + h);
    this.vline(x + w, y, y + h);
    this.hline(x, x + w, y);
    this.hline(x, x + w, y + h);
    return this;
  }

  circle(x0, y0, r) {
    if (this.disabled) return this;
    octant(r, (x, y) => {
      this.hline(x0 - x, x0 + x, y0 + y);
      this.hline(x0 - y, x0 + y, y0 + x);
      this.hline(x0 - x, x0 + x, y0 - y);
      this.hline(x0 - y, x0 + y, y0 - x);
    });
    return this;
  }

  lcircle(x0, y0, r) {
    if (this.disabled) return this;
    octant(r, (x, y) => {
      this.dot(x0 + x, y0 + y);
      this.dot(x0 + y, y0 + x);
      this.dot(x0 - x, y0 + y);
      this.dot(x0 - y, y0 + x);
      this.dot(x0 - x, y0 - y);
      this.dot(x0 - y, y0 - x);
      this.dot(x0 + x, y0 - y);
      this.dot(x0 + y, y0 - x);
    });
    return this;
  }

  // A sprite from a string, one character per pixel: `.` transparent, a digit
  // an index into `colors`. Rows are boxw wide, set by size().
  obj(colors, data) {
    if (this.disabled) return this;
    this.color2 =
      this.xpat =
      this.ypat =
      this.xypat =
        0;
    let x = 0;
    let y = 0;
    for (const ch of data) {
      if (ch === "\n" || ch === " ") continue;
      if (ch !== ".") {
        this.color1 = colors[Number.parseInt(ch, 10)];
        this.dot(x, y);
      }
      x++;
      if (x >= this.boxw) {
        x = 0;
        y++;
      }
    }
    return this;
  }

  // Measured in screen units, so `size` is independent of size(px). Centred
  // on (x, y) in art coordinates.
  text(x, y, s, size = 1) {
    if (this.disabled) return this;
    this.texts.push({
      x: (x + 0.5) * this.px,
      y: (y + 0.5) * this.px,
      text: s,
      size,
      color: this.color1,
    });
    this.dirty = true;
    return this;
  }

  bounds() {
    if (!this.dirty) return this.box;

    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const grow = (a, b, c, d) => {
      if (a < x0) x0 = a;
      if (b < y0) y0 = b;
      if (c > x1) x1 = c;
      if (d > y1) y1 = d;
    };

    if (this.boxw > 0 || this.boxh > 0) {
      grow(0, 0, this.boxw * this.px, this.boxh * this.px);
    }
    for (const [x, y, w] of this.runs) {
      grow(x * this.px, y * this.px, (x + w) * this.px, (y + 1) * this.px);
    }
    for (const t of this.texts) {
      const g = glyphs(t.text);
      const w = g.width * t.size;
      const h = g.height * t.size;
      grow(t.x - w / 2, t.y - h / 2, t.x + w / 2, t.y + h / 2);
    }

    if (x0 === Infinity) {
      x0 =
        y0 =
        x1 =
        y1 =
          0;
    }
    this.box = [x0, y0, x1 - x0, y1 - y0];
    this.dirty = false;
    return this.box;
  }

  render(ctx) {
    if (this.runs.length === 0 && this.texts.length === 0) return;

    const [bx, by, bw, bh] = this.bounds();
    const ox = -bx - bw / 2;
    const oy = -by - bh / 2;
    const px = this.px;

    // One path per run of the same colour, filled once. Filled separately,
    // two rectangles sharing an edge each antialias against it, and 40%
    // coverage over 60% of the same colour is 76%, not 100%: a seam a quarter
    // of a shade darker down every shared edge. A single path has no shared
    // edges. Consecutive runs only, so draw order is kept.
    let last = -1;
    for (const [x, y, w, c] of this.runs) {
      if (c !== last) {
        if (last !== -1) ctx.fill();
        last = c;
        ctx.fillStyle = css(c);
        ctx.beginPath();
      }
      ctx.rect(ox + x * px, oy + y * px, w * px, px);
    }
    if (last !== -1) ctx.fill();

    for (const t of this.texts) {
      const g = glyphs(t.text);
      ctx.fillStyle = css(t.color);
      const tx = ox + t.x - (g.width * t.size) / 2;
      const ty = oy + t.y - (g.height * t.size) / 2;
      for (let i = 0; i < g.dots.length; i += 2) {
        ctx.fillRect(
          tx + g.dots[i] * t.size,
          ty + g.dots[i + 1] * t.size,
          t.size,
          t.size,
        );
      }
    }
  }
}
