/*
 * gfx.js - the other thing an entity draws with: filled and stroked paths.
 *
 * Same shape as Art, recorded once and replayed centred on the entity, but
 * vector rather than pixels. Four games draw with both, almost always on
 * different entities: gather's Piece is the only one that uses both at once.
 *
 * ```js
 * gfx.fill(0xe9e1e1).circle(0, 0, 10).fill(null)
 *    .line(2, 0x847f7f).circle(0, 0, 10);
 * ```
 *
 * fill() and line() set what every shape after them uses, and passing null
 * turns either off. mt()/lt() draw a path where the four shape calls will not.
 * text() is the exception: it carries its own colour, as ugl's did, and paints
 * the same bitmap font Art does.
 *
 * Flash's Graphics ran every shape between beginFill and endFill into one
 * path, so overlapping shapes came out as their union. Here each shape is its
 * own path, which looks the same unless the fill is translucent.
 *
 * Every entity owns one, next to its `art`. core.js imports this file, so a
 * game gets both from entity.js and imports nothing else.
 */

import { css, glyphs } from "./art.js";

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

  // As Art.cache(): skip every call until the index changes.
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

  // ugl's gfx.size(w, h): an empty box that fixes what the drawing centres in,
  // so a shape lopsided about the entity does not drag the whole entity with
  // it. Centred on the entity here, where ugl cornered it at the origin.
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

  // ugl's arc: out along r1 from b to e, back along r2, so r1 == r2 is a plain
  // arc and r1 != r2 a ring segment. Angles turn anticlockwise on screen.
  arc(x, y, r1, r2, b, e) {
    return this.shape("arc", [x, y, r1, r2, b, e]);
  }

  // Flash's moveTo and lineTo. A filled path closes itself, a stroked one does
  // not.
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

  // One line of the bitmap font, centred on (x, y) in screen units. The colour
  // is an argument rather than the standing fill(), as ugl's gfx.text had it.
  text(x, y, s, color, size = 1) {
    if (this.disabled) return this;
    this.cmds.push({
      kind: "text",
      args: [x, y],
      text: String(s),
      size,
      color,
      fill: null,
      line: null,
    });
    this.dirty = true;
    return this;
  }

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
      } else if (c.kind === "text") {
        const g = glyphs(c.text);
        at(x - g.width * c.size / 2, y - g.height * c.size / 2);
        at(x + g.width * c.size / 2, y + g.height * c.size / 2);
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

  render(ctx) {
    if (this.cmds.length === 0) return;

    const [bx, by, bw, bh] = this.bounds();
    ctx.save();
    ctx.translate(-bx - bw / 2, -by - bh / 2);

    for (const c of this.cmds) {
      if (c.kind === "text") {
        write(ctx, c);
        continue;
      }
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

function write(ctx, c) {
  const [x, y] = c.args;
  const g = glyphs(c.text);
  const s = c.size;
  const tx = x - g.width * s / 2;
  const ty = y - g.height * s / 2;

  ctx.globalAlpha = 1;
  ctx.fillStyle = css(c.color);
  for (let i = 0; i < g.dots.length; i += 2) {
    ctx.fillRect(tx + g.dots[i] * s, ty + g.dots[i + 1] * s, s, s);
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

// The extremes of the arc from `s` sweeping `d`: its two ends, plus every axis
// direction the sweep crosses.
function arcAt(at, x, y, r, s, d) {
  const point = (a) => at(x + Math.cos(a) * r, y + Math.sin(a) * r);
  point(s);
  point(s + d);

  const q = Math.PI / 2;
  const step = d > 0 ? q : -q;
  let a = (d > 0 ? Math.ceil(s / q) : Math.floor(s / q)) * q;
  for (; d > 0 ? a < s + d : a > s + d; a += step) point(a);
}
