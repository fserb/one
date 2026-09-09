/*
 * art.js - the ugl look: a 6x8 bitmap font, a chunky-pixel renderer, and the
 * vector renderer beside it.
 *
 * The vault micro-games draw everything out of two-colour dithered pixels at a
 * scale of 3 to 8 screen units each. `art` collects the pixels an entity is
 * made of, entity.js blits them centred on the entity's position.
 *
 * ```js
 * art.size(3).color(0xe1b81f, 0xa37d1d, 32).circle(8, 8, 8);
 * ```
 *
 * `size(px)` is how wide one pixel is. Shapes are then addressed in pixels, not
 * screen units, so a radius of 8 at size 3 is 48 units across.
 *
 * `Gfx`, at the bottom, is the other thing an entity draws with: filled and
 * stroked paths rather than pixels. The games use both, often on one entity.
 *
 * `color(c, c2, pat)` is the dither. `pat` is up to three digits read
 * right-to-left as periods along x, y and x+y; a pixel counts
 * `x % xpat + y % ypat + (x + y) % xypat` and takes `c` when that is even and
 * `c2` when it is odd. So 32 is "3 across, 2 down", the pattern most of the
 * games use, and a bare 0 is a flat fill of `c`.
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

// The pixels of `text` at one unit per pixel, laid out the way ugl lays them
// out: proportional, each glyph starting two pixels past the rightmost lit
// column so far. Everything scales linearly, so callers multiply.
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

function css(c) {
  let s = CSS.get(c);
  if (s === undefined) {
    s = `#${(c & 0xffffff).toString(16).padStart(6, "0")}`;
    CSS.set(c, s);
  }
  return s;
}

/*
 * A bag of chunky pixels, in pixel coordinates. Every shape reduces to dot(),
 * which resolves the dither and appends to a run. render() blits the lot
 * centred on the origin, so an entity's art sits on its position.
 *
 * ugl centred the Flash sprite's bounding box only when that box started at
 * the origin, which is how the games draw. This centres the box always.
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

  // px is the width of one pixel. w and h fix the box the art is centred in,
  // which obj() also reads as its row length.
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

  // Skip every drawing call until the index changes. The games redraw their
  // art inside update(), so this is how a static entity stops paying for it.
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
    x = Math.trunc(x);
    y = Math.trunc(y);

    let v = 0;
    if (this.xpat > 0) v += x % this.xpat;
    if (this.ypat > 0) v += y % this.ypat;
    if (this.xypat > 0) v += (x + y) % this.xypat;
    const c = v % 2 === 0 ? this.color1 : this.color2;

    // Shapes emit left-to-right along a row, so most dots extend the last run.
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
    let x = Math.round(r);
    let y = 0;
    let err = 1 - x;
    while (x >= y) {
      this.hline(x0 - x, x0 + x, y0 + y);
      this.hline(x0 - y, x0 + y, y0 + x);
      this.hline(x0 - x, x0 + x, y0 - y);
      this.hline(x0 - y, x0 + y, y0 - x);
      y++;
      if (err < 0) {
        err += 2 * y + 1;
      } else {
        x--;
        err += 2 * (y - x + 1);
      }
    }
    return this;
  }

  lcircle(x0, y0, r) {
    if (this.disabled) return this;
    let x = Math.round(r);
    let y = 0;
    let err = 1 - x;
    while (x >= y) {
      this.dot(x0 + x, y0 + y);
      this.dot(x0 + y, y0 + x);
      this.dot(x0 - x, y0 + y);
      this.dot(x0 - y, y0 + x);
      this.dot(x0 - x, y0 - y);
      this.dot(x0 - y, y0 - x);
      this.dot(x0 + x, y0 - y);
      this.dot(x0 + y, y0 - x);
      y++;
      if (err < 0) {
        err += 2 * y + 1;
      } else {
        x--;
        err += 2 * (y - x + 1);
      }
    }
    return this;
  }

  // A sprite from a string, one character per pixel, `.` transparent and any
  // digit an index into `colors`. Rows are boxw wide, set by size().
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

  // Text is measured in screen units, not art pixels, so `size` here is
  // independent of size(px). Centred on (x, y) in art coordinates.
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

  // Screen-unit bounding box of everything drawn, as [x, y, w, h].
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

  // Draws centred on the current origin.
  render(ctx) {
    if (this.runs.length === 0 && this.texts.length === 0) return;

    const [bx, by, bw, bh] = this.bounds();
    const ox = -bx - bw / 2;
    const oy = -by - bh / 2;
    const px = this.px;

    for (const [x, y, w, c] of this.runs) {
      ctx.fillStyle = css(c);
      ctx.fillRect(ox + x * px, oy + y * px, w * px, px);
    }

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

/*
 * The other thing an entity draws with: filled and stroked paths. Same shape
 * as Art - record the shapes once, entity.js replays them centred on the
 * entity's position - but vector rather than pixels.
 *
 * ```js
 * gfx.fill(0xe9e1e1).circle(0, 0, 10).fill(null)
 *    .line(2, 0x847f7f).circle(0, 0, 10);
 * ```
 *
 * fill() and line() set what every shape after them uses, and passing null
 * turns either off. mt()/lt() draw a path where the four shape calls will not.
 *
 * Flash's Graphics, which the ported games were written against, ran every
 * shape between beginFill and endFill into a single path,
 * so two overlapping shapes in one fill came out as their union. Here each
 * shape is its own path, which looks the same unless the fill is translucent.
 */
export class Gfx {
  constructor() {
    this.cmds = [];
    this._fill = null;
    this._line = null;
    this.disabled = false;
    this.cached = -1;
    this.dirty = true;
    this.box = [0, 0, 0, 0];
  }

  clear() {
    this.cmds.length = 0;
    this._fill = this._line = null;
    this.disabled = false;
    this.cached = -1;
    this.dirty = true;
    return this;
  }

  // As Art.cache(): skip every call until the index changes, so an entity that
  // redraws inside update() stops paying for a picture that has not moved.
  cache(idx) {
    if (idx === this.cached) {
      this.disabled = true;
    } else {
      this.clear();
      this.cached = idx;
    }
    return this;
  }

  fill(c = null, alpha = 1) {
    if (this.disabled) return this;
    this._fill = c === null ? null : { c, alpha };
    return this;
  }

  line(width = null, c = 0, alpha = 1) {
    if (this.disabled) return this;
    this._line = width === null ? null : { width, c, alpha };
    return this;
  }

  shape(kind, args) {
    if (this.disabled) return this;
    this.cmds.push({ kind, args, fill: this._fill, line: this._line });
    this.dirty = true;
    return this;
  }

  // `round` is the corner diameter, as Flash's drawRoundRect took it.
  rect(x, y, w, h, round = 0) {
    return this.shape("rect", [x, y, w, h, round]);
  }

  // ugl's gfx.size(w, h): a box that fixes what the drawing is centred in and
  // paints nothing. A shape lopsided about the entity, a turret's barrel,
  // otherwise drags the bounding box to one side and the whole entity with it.
  // Centred on the entity here, where ugl cornered it at the origin.
  size(w, h = w, x = 0, y = 0) {
    if (this.disabled) return this;
    this.cmds.push({
      kind: "rect",
      args: [x - w / 2, y - h / 2, w, h, 0],
      fill: null,
      line: null,
    });
    this.dirty = true;
    return this;
  }

  circle(x, y, r) {
    return this.shape("circle", [x, y, r]);
  }

  // ugl's arc: out along r1 from b to e, back along r2, so r1 == r2 draws a
  // plain arc and r1 != r2 a ring segment. Angles turn anticlockwise on
  // screen, which is the convention ugl picked and the games are drawn in.
  arc(x, y, r1, r2, b, e) {
    return this.shape("arc", [x, y, r1, r2, b, e]);
  }

  // A path, as Flash's moveTo and lineTo: mt starts one and lt carries it on.
  // A filled path closes itself; a stroked one stays open.
  mt(x, y) {
    return this.shape("poly", [x, y]);
  }

  lt(x, y) {
    if (this.disabled) return this;
    const c = this.cmds.at(-1);
    if (c === undefined || c.kind !== "poly") return this.shape("poly", [x, y]);
    c.args.push(x, y);
    this.dirty = true;
    return this;
  }

  // Screen-unit bounding box of everything drawn, as [x, y, w, h].
  bounds() {
    if (!this.dirty) return this.box;

    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const c of this.cmds) {
      let a0 = Infinity, b0 = Infinity, a1 = -Infinity, b1 = -Infinity;
      const at = (x, y) => {
        if (x < a0) a0 = x;
        if (y < b0) b0 = y;
        if (x > a1) a1 = x;
        if (y > b1) b1 = y;
      };

      const [x, y] = c.args;
      if (c.kind === "rect") {
        at(x, y);
        at(x + c.args[2], y + c.args[3]);
      } else if (c.kind === "circle") {
        const r = c.args[2];
        at(x - r, y - r);
        at(x + r, y + r);
      } else if (c.kind === "poly") {
        for (let i = 0; i < c.args.length; i += 2) at(c.args[i], c.args[i + 1]);
      } else {
        const [, , r1, r2, b, e] = c.args;
        arcAt(at, x, y, r1, -b, b - e);
        arcAt(at, x, y, r2, -e, e - b);
      }

      // A stroke sits half its width outside the path it follows.
      const p = c.line === null ? 0 : c.line.width / 2;
      if (a0 - p < x0) x0 = a0 - p;
      if (b0 - p < y0) y0 = b0 - p;
      if (a1 + p > x1) x1 = a1 + p;
      if (b1 + p > y1) y1 = b1 + p;
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

  // Draws centred on the current origin.
  render(ctx) {
    if (this.cmds.length === 0) return;

    const [bx, by, bw, bh] = this.bounds();
    ctx.save();
    ctx.translate(-bx - bw / 2, -by - bh / 2);

    for (const c of this.cmds) {
      ctx.beginPath();
      trace(ctx, c);
      if (c.fill !== null) {
        ctx.globalAlpha = c.fill.alpha;
        ctx.fillStyle = css(c.fill.c);
        ctx.fill();
      }
      if (c.line !== null) {
        ctx.globalAlpha = c.line.alpha;
        ctx.lineWidth = c.line.width;
        ctx.strokeStyle = css(c.line.c);
        ctx.stroke();
      }
    }

    ctx.globalAlpha = 1;
    ctx.restore();
  }
}

function trace(ctx, c) {
  const [x, y] = c.args;

  if (c.kind === "rect") {
    const [, , w, h, round] = c.args;
    if (round === 0) ctx.rect(x, y, w, h);
    else ctx.roundRect(x, y, w, h, round / 2);
    return;
  }

  if (c.kind === "circle") {
    ctx.arc(x, y, c.args[2], 0, 2 * Math.PI);
    return;
  }

  if (c.kind === "poly") {
    ctx.moveTo(x, y);
    for (let i = 2; i < c.args.length; i += 2) {
      ctx.lineTo(c.args[i], c.args[i + 1]);
    }
    return;
  }

  const [, , r1, r2, b, e] = c.args;
  // ctx.arc joins the two sweeps with a line, so the band closes itself.
  ctx.arc(x, y, r1, -b, -e, e > b);
  ctx.arc(x, y, r2, -e, -b, e < b);
  ctx.closePath();
}

// The extremes of the arc that starts at angle `s` and sweeps by `d`: its two
// ends, plus every axis direction the sweep passes through on the way.
function arcAt(at, x, y, r, s, d) {
  const point = (a) => at(x + Math.cos(a) * r, y + Math.sin(a) * r);
  point(s);
  point(s + d);

  const q = Math.PI / 2;
  const step = d > 0 ? q : -q;
  let a = (d > 0 ? Math.ceil(s / q) : Math.floor(s / q)) * q;
  for (; d > 0 ? a < s + d : a > s + d; a += step) point(a);
}
