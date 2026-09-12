/*
 * gfx.js - the other thing an entity draws with: filled and stroked paths.
 *
 * ```js
 * gfx.fill(0xe9e1e1).circle(0, 0, 10).fill(null)
 *    .line(2, 0x847f7f).circle(0, 0, 10);
 * ```
 *
 * fill() and line() set what every shape after them uses, and null turns
 * either off. mt()/lt() draw a path where the four shape calls will not.
 * text() carries its own colour and paints art.js's bitmap font.
 *
 * Each shape is a list of commands, recorded when the call is made and replayed
 * into a Path2D the first time it is drawn. A command list holds no DOM, so the
 * build can still import a game under Deno.
 *
 *   ["M", x, y]  ["L", x, y]  ["A", cx, cy, r, a0, a1, ccw]  ["Z"]
 *
 * An arc stays an arc: Path2D takes one as it comes and pathBox() measures one
 * in closed form, so both are exact. alma's Path converts to beziers on the way
 * in and flattens them back to a polyline to measure, which costs 9.7 KB
 * minified in 19 bundles and costs the edge as well: Chrome antialiases a
 * bezier with three partial coverage values and an arc with 23, so a disc of
 * four cubics covers 0.6% less than the disc ctx.arc draws.
 *
 * A curve would be ["C", ...]: three lines in replay(), and a closed form in
 * pathBox(). Nothing has drawn one yet.
 */

import { css, glyphs } from "./art.js";

const TAU = 2 * Math.PI;

// Where an arc's x or y turns around, as unit vectors, so a quarter arc's box
// is right to the last bit rather than to Math.cos's idea of cos(PI / 2).
const CARDINAL = [[1, 0], [0, 1], [-1, 0], [0, -1]];

export class Gfx {
  constructor() {
    this.cmds = [];
    this._fill = null;
    this._line = null;
    this.disabled = false;
    this.cached = -1;
    this.dirty = true;
    this.box = [0, 0, 0, 0];
    // The command lt() extends, or null when the last call was not a poly.
    this.poly = null;
  }

  clear() {
    this.cmds.length = 0;
    this.poly = null;
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

  // One shape under the standing fill() and line(), which ends any open poly.
  push(path) {
    this.cmds.push({ path, fill: this._fill, line: this._line });
    this.poly = null;
    this.dirty = true;
    return this;
  }

  // `round` is the corner diameter, one radius for both axes and clamped to the
  // shorter side. Four quarter-arcs rather than a curve into the box, which is
  // what arcTo and a squircle corner both draw.
  rect(x, y, w, h, round = 0) {
    if (this.disabled) return this;
    if (round === 0) return this.push(rectPath(x, y, w, h));
    const r = Math.min(round / 2, w / 2, h / 2);
    const q = Math.PI / 2;
    return this.push([
      ["A", x + w - r, y + r, r, -q, 0, false],
      ["A", x + w - r, y + h - r, r, 0, q, false],
      ["A", x + r, y + h - r, r, q, 2 * q, false],
      ["A", x + r, y + r, r, 2 * q, 3 * q, false],
      ["Z"],
    ]);
  }

  // An empty box that fixes what the drawing centres in, so a shape lopsided
  // about the entity does not drag the whole entity with it.
  size(w, h = w, x = 0, y = 0) {
    if (this.disabled) return this;
    const path = rectPath(x - w / 2, y - h / 2, w, h);
    this.cmds.push({ path, fill: null, line: null });
    this.poly = null;
    this.dirty = true;
    return this;
  }

  circle(x, y, r) {
    if (this.disabled) return this;
    return this.push([["A", x, y, r, 0, TAU, false], ["Z"]]);
  }

  // Out along r1 from b to e, back along r2, so r1 == r2 is a plain arc and
  // r1 != r2 a ring segment. A sweep past a full turn is one turn: Path2D cuts
  // it back and so does arcBox(), so the angles go through as they came in.
  arc(x, y, r1, r2, b, e) {
    if (this.disabled) return this;
    return this.push([
      ["A", x, y, r1, -b, -e, e > b],
      ["A", x, y, r2, -e, -b, e < b],
      ["Z"],
    ]);
  }

  // A filled path closes itself and a stroked one does not, which is Path2D's
  // own behaviour.
  mt(x, y) {
    if (this.disabled) return this;
    this.poly = { path: [["M", x, y]], fill: this._fill, line: this._line };
    this.cmds.push(this.poly);
    this.dirty = true;
    return this;
  }

  lt(x, y) {
    if (this.disabled) return this;
    if (this.poly === null) return this.mt(x, y);
    this.poly.path.push(["L", x, y]);
    // The Path2D held from the last frame is a shape short now.
    this.poly.p2d = undefined;
    this.dirty = true;
    return this;
  }

  // One line of the bitmap font, centred on (x, y) in screen units, in its own
  // colour rather than the standing fill().
  text(x, y, s, color, size = 1) {
    if (this.disabled) return this;
    this.cmds.push({
      args: [x, y],
      text: String(s),
      size,
      color,
      fill: null,
      line: null,
    });
    this.poly = null;
    this.dirty = true;
    return this;
  }

  bounds() {
    if (!this.dirty) return this.box;

    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const c of this.cmds) {
      const b = c.text === undefined ? pathBox(c.path) : textBox(c);
      // A stroke sits half its width outside the path it follows.
      const p = c.line === null ? 0 : c.line.width / 2;
      x0 = Math.min(x0, b.x - p);
      y0 = Math.min(y0, b.y - p);
      x1 = Math.max(x1, b.x + b.width + p);
      y1 = Math.max(y1, b.y + b.height + p);
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
      if (c.text !== undefined) {
        write(ctx, c);
        continue;
      }
      // Kept on the command, so a drawing left alone replays the same Path2D.
      c.p2d ??= replay(c.path);
      if (c.fill !== null) {
        ctx.globalAlpha = c.fill.alpha;
        ctx.fillStyle = css(c.fill.c);
        ctx.fill(c.p2d);
      }
      if (c.line !== null) {
        ctx.globalAlpha = c.line.alpha;
        ctx.lineWidth = c.line.width;
        ctx.strokeStyle = css(c.line.c);
        ctx.stroke(c.p2d);
      }
    }

    ctx.globalAlpha = 1;
    ctx.restore();
  }
}

function rectPath(x, y, w, h) {
  return [
    ["M", x, y],
    ["L", x + w, y],
    ["L", x + w, y + h],
    ["L", x, y + h],
    ["Z"],
  ];
}

function replay(path) {
  const p2d = new Path2D();
  for (const c of path) {
    switch (c[0]) {
      case "M":
        p2d.moveTo(c[1], c[2]);
        break;
      case "L":
        p2d.lineTo(c[1], c[2]);
        break;
      case "A":
        p2d.arc(c[1], c[2], c[3], c[4], c[5], c[6]);
        break;
      case "Z":
        p2d.closePath();
        break;
    }
  }
  return p2d;
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

// A line reaches its endpoint and an arc its two endpoints plus whichever
// cardinal points its sweep passes, so this is the box and not an estimate.
function pathBox(path) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const at = (x, y) => {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  };

  for (const c of path) {
    if (c[0] === "M" || c[0] === "L") at(c[1], c[2]);
    else if (c[0] === "A") arcBox(c, at);
  }

  if (x0 === Infinity) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

function arcBox([, cx, cy, r, a0, a1, ccw], at) {
  at(cx + r * Math.cos(a0), cy + r * Math.sin(a0));
  at(cx + r * Math.cos(a1), cy + r * Math.sin(a1));

  // How far it winds the way canvas reads it: from a0 in the direction asked
  // until it meets a1, and a full turn at most.
  const d = ccw ? a0 - a1 : a1 - a0;
  const sweep = d >= TAU ? TAU : ((d % TAU) + TAU) % TAU;

  for (let k = 0; k < 4; ++k) {
    const a = k * Math.PI / 2;
    const along = ccw ? a0 - a : a - a0;
    if (((along % TAU) + TAU) % TAU > sweep) continue;
    at(cx + r * CARDINAL[k][0], cy + r * CARDINAL[k][1]);
  }
}

// The one command with no path behind it: the font is dots.
function textBox(c) {
  const [x, y] = c.args;
  const g = glyphs(c.text);
  const w = g.width * c.size;
  const h = g.height * c.size;
  return { x: x - w / 2, y: y - h / 2, width: w, height: h };
}
