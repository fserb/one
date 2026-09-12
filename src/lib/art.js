/*
 * art.js - a renderer of large square pixels.
 *
 * ```js
 * art.size(3).color(0xe1b81f, 0xa37d1d, 32).circle(8, 8, 8);
 * ```
 *
 * `size(px)` is how wide one pixel is; shapes are addressed in pixels, so a
 * radius of 8 at size 3 is 48 units across.
 *
 * `color(c, c2, pat)` is the dither. `pat` is up to three digits read
 * right-to-left as periods along x, y and x+y; a pixel counts
 * `x % xpat + y % ypat + (x + y) % xypat` and takes `c` when that is even,
 * `c2` when odd. So 32 is "3 across, 2 down" and a bare 0 is a flat fill.
 */

import { css } from "./gfx.js";

/*
 * The midpoint circle loop over the first octant, which circle() mirrors into
 * four spans and lcircle() into eight dots. Shared because the two have to
 * agree: an outline drawn by one variant and a fill by another are a pixel
 * apart at half the radii. alma's bresenhamCircle() is the other variant, off
 * `3 - 2r` rather than `1 - x`, and picks different pixels at 29 of the first
 * 60 radii, so it is not used.
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

// Every shape reduces to dot(), which resolves the dither and appends to a run.
export class Art {
  constructor() {
    this.runs = [];
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

  // w and h fix the box the art centres in, which obj() uses as its row length.
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
    this.disabled = false;
    this.cached = -1;
    this.dirty = true;
    return this;
  }

  // Skip every drawing call until the index changes: games redraw in update().
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

    // The dither uses the whole pixel the dot falls in and the run keeps the
    // coordinate given, so `rect(0, 1.5, 4, 1)` is a one-pixel bar centred on a
    // four-pixel box.
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

  // One character per pixel: `.` transparent, a digit an index into `colors`.
  // Rows are boxw wide, set by size().
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
    if (this.runs.length === 0) return;

    const [bx, by, bw, bh] = this.bounds();
    const ox = -bx - bw / 2;
    const oy = -by - bh / 2;
    const px = this.px;

    // One path per run of the same colour. Filled separately, two rectangles
    // sharing an edge each antialias against it, and 40% coverage over 60% of
    // the same colour is 76%, not 100%, so every shared edge shows a darker
    // line. Consecutive runs only, so draw order is kept.
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
  }
}
