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
 * css(c) is here too: it turns one of those 0xrrggbb numbers into the string a
 * canvas takes, and every game reaches it through entity.js.
 *
 * Each shape is a list of commands, recorded when the call is made and replayed
 * into a Path2D the first time it is drawn. A command list has no DOM object in
 * it, so the build can still import a game under Deno.
 *
 *   ["M", x, y]  ["L", x, y]  ["C", x1, y1, x2, y2, x, y]
 *   ["A", cx, cy, r, a0, a1, ccw]  ["Z"]
 *
 * An arc stays an arc: Path2D takes one directly and pathBox() measures one in
 * closed form, so both are exact. alma's Path converts to beziers on the way in
 * and flattens them back to a polyline to measure, which costs 9.7 KB minified
 * in 19 bundles and changes the edge as well: Chrome antialiases a
 * bezier with three partial coverage values and an arc with 23, so a disc of
 * four cubics covers 0.6% less than the disc ctx.arc draws.
 *
 * A cubic is exact the same way: pathBox() solves B'(t) = 0, a quadratic in t,
 * rather than flattening the curve and measuring the polyline. ct() adds one to
 * an open poly the way lt() adds a line; rect(), circle() and arc() stay arcs
 * and never emit a "C".
 */

const TAU = 2 * Math.PI;

// Where an arc's x or y reverses, as unit vectors, so a quarter arc's box is
// exact instead of carrying the error in Math.cos(PI / 2).
const CARDINAL = [[1, 0], [0, 1], [-1, 0], [0, -1]];

// Every colour in a game is a 0xrrggbb number and every canvas call wants a
// string, so the two are paired once here and kept.
const CSS = new Map();

export function css(c) {
  let s = CSS.get(c);
  if (s === undefined) {
    s = `#${(c & 0xffffff).toString(16).padStart(6, "0")}`;
    CSS.set(c, s);
  }
  return s;
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

  // One shape under the current fill() and line(), which ends any open poly.
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

  // Several rectangles as one shape, each [x, y, w, h]. Filled separately, two
  // that share an edge each antialias against it, and 40% coverage over 60% of
  // the same colour is 76%, not 100%, so the join shows as a line.
  rects(boxes) {
    if (this.disabled) return this;
    const path = [];
    for (const [x, y, w, h] of boxes) path.push(...rectPath(x, y, w, h));
    return this.push(path);
  }

  // An empty box that sets what the drawing centres in, so a shape that is
  // off-centre about the entity does not move the whole drawing with it.
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
  // it back and so does arcBox(), so the angles are passed on unchanged.
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
    // The Path2D kept from the last frame is missing a shape now.
    this.poly.p2d = undefined;
    this.dirty = true;
    return this;
  }

  // Two control points and an endpoint, as Path2D's bezierCurveTo. With no open
  // poly it is a mt() to the endpoint, since a curve has nowhere to start.
  ct(x1, y1, x2, y2, x, y) {
    if (this.disabled) return this;
    if (this.poly === null) return this.mt(x, y);
    this.poly.path.push(["C", x1, y1, x2, y2, x, y]);
    this.poly.p2d = undefined;
    this.dirty = true;
    return this;
  }

  bounds() {
    if (!this.dirty) return this.box;

    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const c of this.cmds) {
      const b = pathBox(c.path);
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
      // Kept on the command, so an unchanged drawing replays the same Path2D.
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
      case "C":
        p2d.bezierCurveTo(c[1], c[2], c[3], c[4], c[5], c[6]);
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

// A line reaches its endpoint, an arc its two endpoints plus whichever cardinal
// points its sweep passes, and a cubic its endpoints plus where either axis
// turns around, so this is the box and not an estimate. A curve is the one
// command that needs where the path already is, so the point is carried along.
function pathBox(path) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const at = (x, y) => {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  };

  let px = 0, py = 0;
  for (const c of path) {
    if (c[0] === "M" || c[0] === "L") {
      at(c[1], c[2]);
      px = c[1];
      py = c[2];
    } else if (c[0] === "C") {
      curveBox(px, py, c, at);
      px = c[5];
      py = c[6];
    } else if (c[0] === "A") {
      arcBox(c, at);
      // Path2D leaves the point at the end angle, after the line it draws in.
      px = c[1] + c[3] * Math.cos(c[5]);
      py = c[2] + c[3] * Math.sin(c[5]);
    }
  }

  if (x0 === Infinity) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

function arcBox([, cx, cy, r, a0, a1, ccw], at) {
  at(cx + r * Math.cos(a0), cy + r * Math.sin(a0));
  at(cx + r * Math.cos(a1), cy + r * Math.sin(a1));

  // How far it sweeps the way canvas measures it: from a0 in the direction
  // asked until it reaches a1, and a full turn at most.
  const d = ccw ? a0 - a1 : a1 - a0;
  const sweep = d >= TAU ? TAU : ((d % TAU) + TAU) % TAU;

  for (let k = 0; k < 4; ++k) {
    const a = k * Math.PI / 2;
    const along = ccw ? a0 - a : a - a0;
    if (((along % TAU) + TAU) % TAU > sweep) continue;
    at(cx + r * CARDINAL[k][0], cy + r * CARDINAL[k][1]);
  }
}

// The endpoints, plus the point at each t where one axis turns around. The x
// turns and the y turns are different t values, so each is evaluated on both
// axes rather than mixing an x extreme with the y beside it.
function curveBox(x0, y0, [, x1, y1, x2, y2, x3, y3], at) {
  at(x0, y0);
  at(x3, y3);
  for (const t of [...turns(x0, x1, x2, x3), ...turns(y0, y1, y2, y3)]) {
    at(bez(x0, x1, x2, x3, t), bez(y0, y1, y2, y3, t));
  }
}

// B'(t) / 3 = a t^2 + b t + c on one axis, solved for the roots inside (0, 1);
// t = 0 and t = 1 are the endpoints, which curveBox() has already taken.
// a is 0 whenever p3 - p0 is 3 (p2 - p1), which round control points land on
// often enough to need the line b t + c solved instead.
function turns(p0, p1, p2, p3) {
  const a = p3 - 3 * p2 + 3 * p1 - p0;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  const inside = (t) => t > 0 && t < 1;

  if (Math.abs(a) < 1e-12) {
    return b === 0 ? [] : [-c / b].filter(inside);
  }
  const d = b * b - 4 * a * c;
  if (d < 0) return [];
  const r = Math.sqrt(d);
  return [(-b + r) / (2 * a), (-b - r) / (2 * a)].filter(inside);
}

function bez(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 +
    t * t * t * p3;
}
