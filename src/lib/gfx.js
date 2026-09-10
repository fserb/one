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
 *
 * Each shape is one of alma's `Shape`s, built when the call is recorded and
 * turned into a Path2D the first time it is drawn. That is where bounds() and
 * the drawing come from: a Shape flattens itself to measure and replays itself
 * to paint. Shape holds no DOM, and toPath2D() is the only call that wants one,
 * so the build can still import a game under Deno.
 */

import { Shape } from "../alma/src/geom/shape/shape.js";
import * as measure from "../alma/src/geom/shape/measure.js";
import { css, glyphs } from "./art.js";

/*
 * How finely bounds() flattens a curve before measuring it. Shape.bounds()
 * flattens at 1, which is a fifth of a screen pixel off on flap's coin and
 * moves the drawing half of that, so the box is measured here instead.
 * At 0.01 the widest arc in the games is within 0.003 of its true extent.
 * bounds() is held behind `dirty`, so this runs when the drawing changes and
 * not once a frame.
 */
const FLAT = 0.01;

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

  // `round` is the corner diameter, as Flash's drawRoundRect took it. One
  // radius for both axes, clamped to the shorter side, the way ctx.roundRect
  // takes a scalar. Four quarter-arcs rather than Shape.squircle or four
  // arcTo: those two draw the corner as a curve into the box, not around it,
  // and Shape.arc is the call that matches ctx.arc. Each arc after the first
  // opens with the line to its own start, which is the edge between corners.
  rect(x, y, w, h, round = 0) {
    if (this.disabled) return this;
    if (round === 0) return this.push(Shape.rect(x, y, w, h));
    const r = Math.min(round / 2, w / 2, h / 2);
    const q = Math.PI / 2;
    const path = new Shape()
      .arc(x + w - r, y + r, r, -q, 0)
      .arc(x + w - r, y + h - r, r, 0, q)
      .arc(x + r, y + h - r, r, q, 2 * q)
      .arc(x + r, y + r, r, 2 * q, 3 * q)
      .closePath();
    return this.push(path);
  }

  // ugl's gfx.size(w, h): an empty box that fixes what the drawing centres in,
  // so a shape lopsided about the entity does not drag the whole entity with
  // it. Centred on the entity here, where ugl cornered it at the origin.
  size(w, h = w, x = 0, y = 0) {
    if (this.disabled) return this;
    const path = Shape.rect(x - w / 2, y - h / 2, w, h);
    this.cmds.push({ path, fill: null, line: null });
    this.poly = null;
    this.dirty = true;
    return this;
  }

  circle(x, y, r) {
    if (this.disabled) return this;
    return this.push(Shape.circle(x, y, r));
  }

  // ugl's arc: out along r1 from b to e, back along r2, so r1 == r2 is a plain
  // arc and r1 != r2 a ring segment. Angles turn anticlockwise on screen.
  //
  // Shape.arc joins two sweeps with a line the way ctx.arc does, so the band
  // closes itself.
  arc(x, y, r1, r2, b, e) {
    if (this.disabled) return this;
    const path = new Shape()
      .arc(x, y, r1, -b, turn(-b, -e, e > b), e > b)
      .arc(x, y, r2, -e, turn(-e, -b, e < b), e < b)
      .closePath();
    return this.push(path);
  }

  // Flash's moveTo and lineTo. A filled path closes itself, a stroked one does
  // not, which is what Path2D does on its own.
  mt(x, y) {
    if (this.disabled) return this;
    this.poly = {
      path: new Shape().moveTo(x, y),
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
    // The Path2D held from the last frame is a shape short now.
    this.poly.p2d = undefined;
    this.dirty = true;
    return this;
  }

  // One line of the bitmap font, centred on (x, y) in screen units. The colour
  // is an argument rather than the standing fill(), as ugl's gfx.text had it.
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
      const b = c.text === undefined
        ? measure.bounds(c.path.toPoints(FLAT))
        : textBox(c);
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
      // Kept on the command: a game that leaves its drawing alone, or holds it
      // with cache(), replays the same Path2D every frame.
      c.p2d ??= c.path.toPath2D();
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

/*
 * Where a sweep from `from` to `to` ends, once. ctx.arc reads anything past a
 * full turn as exactly one and Shape.arc keeps winding, which fills as a
 * different shape, so the angle is cut back here instead.
 */
function turn(from, to, ccw) {
  const TAU = 2 * Math.PI;
  let d = to - from;
  if (ccw) {
    if (d > 0) d -= TAU;
    return from + Math.max(d, -TAU);
  }
  if (d < 0) d += TAU;
  return from + Math.min(d, TAU);
}

// The one command with no Shape behind it: the bitmap font is dots, not a path.
function textBox(c) {
  const [x, y] = c.args;
  const g = glyphs(c.text);
  const w = g.width * c.size;
  const h = g.height * c.size;
  return { x: x - w / 2, y: y - h / 2, width: w, height: h };
}
