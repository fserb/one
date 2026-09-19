/*
 * gfx.js - the other thing an entity draws with: filled and stroked paths.
 *
 * ```js
 * gfx.fill(0xe9e1e1).circle(0, 0, 10).fill(null)
 *    .line(2, 0x847f7f).circle(0, 0, 10);
 * ```
 *
 * fill() and line() set what every shape after them uses, and null turns
 * either off. mt()/lt()/ct() draw a path where the shape calls will not.
 *
 * css(c) and hex(s) are here too: one turns a 0xrrggbb number into the string a
 * canvas takes, the other a "#rrggbb" string back into the number. Games reach
 * both through entity.js.
 *
 * Each shape is an alma Path2D, which records the calls and hands them to a
 * real Path2D the first time it is drawn, so a command list holds no DOM
 * object and the build can still import a game under Deno. bounds() there is
 * closed form on arcs and curves alike, and an arc stays an arc: Chromium
 * draws a radius 24 disc of four cubics 0.37% larger than the one ctx.arc
 * draws, over 67 partial coverage values against the arc's 83. rect(),
 * circle() and arc() stay arcs and never emit a curve.
 */

import { Path2D } from "../alma/src/geom/path2d.js";

const TAU = 2 * Math.PI;

// Every colour in a game is a 0xrrggbb number and every canvas call wants a
// string, so the two are paired once and kept.
const CSS = new Map();

export function css(c) {
  let s = CSS.get(c);
  if (s === undefined) {
    s = `#${(c & 0xffffff).toString(16).padStart(6, "0")}`;
    CSS.set(c, s);
  }
  return s;
}

// The other way: meta and theme() carry "#rrggbb", and drawing takes numbers.
export function hex(s) {
  return parseInt(s.slice(1), 16);
}

const ALIGN = ["left", "center", "right"];
const VALIGN = ["top", "middle", "bottom"];

// One word from each of those lists, in either order and space separated, into
// the pair ctx.text() takes. Anything else in the string is ignored, and a
// missing word keeps the default given.
export function anchor(s, align = "center", valign = "middle") {
  for (const w of s.toLowerCase().split(/[\s_]+/)) {
    if (ALIGN.includes(w)) align = w;
    if (VALIGN.includes(w)) valign = w;
  }
  return [align, valign];
}

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

  // Skips every call after it until the index changes, so a drawing that only
  // has two states is rebuilt on the frame it switches and not every frame.
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

  // One shape under the current fill() and line(), which ends any open poly.
  push(path) {
    this.cmds.push({ path, fill: this._fill, line: this._line });
    this.poly = null;
    this.dirty = true;
    return this;
  }

  // `round` is the corner diameter, one radius for both axes. Clamped here
  // rather than left to roundRect, whose overflow rule reaches the same corner
  // through 20 * (12 / 40) and lands a bit under it.
  rect(x, y, w, h, round = 0) {
    if (this.disabled) return this;
    const path = new Path2D();
    if (round === 0) path.rect(x, y, w, h);
    else path.roundRect(x, y, w, h, Math.min(round / 2, w / 2, h / 2));
    return this.push(path);
  }

  // Several rectangles as one shape, each [x, y, w, h]. Filled separately, two
  // that share an edge each antialias against it, and 40% coverage over 60% of
  // the same colour is 76%, not 100%, so the join shows as a line.
  rects(boxes) {
    if (this.disabled) return this;
    const path = new Path2D();
    for (const [x, y, w, h] of boxes) path.rect(x, y, w, h);
    return this.push(path);
  }

  // An empty box that sets what the drawing centres in, so a shape that is
  // off-centre about the entity does not move the whole drawing with it.
  size(w, h = w, x = 0, y = 0) {
    if (this.disabled) return this;
    const path = new Path2D().rect(x - w / 2, y - h / 2, w, h);
    this.cmds.push({ path, fill: null, line: null });
    this.poly = null;
    this.dirty = true;
    return this;
  }

  circle(x, y, r) {
    if (this.disabled) return this;
    return this.push(new Path2D().arc(x, y, r, 0, TAU).closePath());
  }

  // Out along r1 from b to e, back along r2, so r1 == r2 is a plain arc and
  // r1 != r2 a ring segment. A sweep past a full turn is one turn: Path2D cuts
  // it back and so does bounds(), so the angles are passed on unchanged.
  arc(x, y, r1, r2, b, e) {
    if (this.disabled) return this;
    return this.push(
      new Path2D()
        .arc(x, y, r1, -b, -e, e > b)
        .arc(x, y, r2, -e, -b, e < b)
        .closePath(),
    );
  }

  // A filled path closes itself and a stroked one does not, which is Path2D's
  // own behaviour.
  mt(x, y) {
    if (this.disabled) return this;
    this.poly = {
      path: new Path2D().moveTo(x, y),
      fill: this._fill,
      line: this._line,
    };
    this.cmds.push(this.poly);
    this.dirty = true;
    return this;
  }

  lt(x, y) {
    if (this.disabled) return this;
    if (this.poly === null) return this.mt(x, y);
    this.poly.path.lineTo(x, y);
    this.dirty = true;
    return this;
  }

  // Two control points and an endpoint, as Path2D's bezierCurveTo. With no open
  // poly it is a mt() to the endpoint, since a curve has nowhere to start.
  ct(x1, y1, x2, y2, x, y) {
    if (this.disabled) return this;
    if (this.poly === null) return this.mt(x, y);
    this.poly.path.bezierCurveTo(x1, y1, x2, y2, x, y);
    this.dirty = true;
    return this;
  }

  bounds() {
    if (!this.dirty) return this.box;

    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const c of this.cmds) {
      const b = c.path.bounds();
      // A stroke extends half its width outside the path it follows.
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
      const p2d = c.path.toPath2D();
      if (c.fill !== null) {
        ctx.globalAlpha = c.fill.alpha;
        ctx.fillStyle = css(c.fill.c);
        ctx.fill(p2d);
      }
      if (c.line !== null) {
        ctx.globalAlpha = c.line.alpha;
        ctx.lineWidth = c.line.width;
        ctx.strokeStyle = css(c.line.c);
        ctx.stroke(p2d);
      }
    }

    ctx.globalAlpha = 1;
    ctx.restore();
  }
}
