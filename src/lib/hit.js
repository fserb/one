/*
 * hit.js - the overlap tests behind Entity's hitCircle/hitBox/hitPoly.
 *
 * A shape is a plain object offset from its entity's position: {r, x, y} is a
 * circle, {w, h, x, y} a box, {p} a convex polygon as a flat list of x, y
 * pairs. Nothing here reads an entity beyond `pos` and `angle`.
 *
 * ugl put these in sprite coordinates and ran them through the sprite matrix.
 * Here they hang off the position, and only a polygon turns with `angle`: a
 * box stays axis-aligned however the drawing is rotated.
 *
 * Circle against circle and box against box are answered head on. Anything
 * involving a polygon goes through corners(), which returns world points, so a
 * box arrives at the separating axis test as its four corners.
 */

export function overlap(ea, a, eb, b) {
  if (a.p !== undefined || b.p !== undefined) return polyOverlap(ea, a, eb, b);

  const ax = ea.pos.x + a.x;
  const ay = ea.pos.y + a.y;
  const bx = eb.pos.x + b.x;
  const by = eb.pos.y + b.y;

  if (a.r !== undefined && b.r !== undefined) {
    return Math.hypot(bx - ax, by - ay) <= a.r + b.r;
  }
  if (a.r !== undefined) return circleBox(ax, ay, a.r, bx, by, b.w, b.h);
  if (b.r !== undefined) return circleBox(bx, by, b.r, ax, ay, a.w, a.h);
  return Math.abs(ax - bx) <= (a.w + b.w) / 2 &&
    Math.abs(ay - by) <= (a.h + b.h) / 2;
}

function circleBox(cx, cy, r, bx, by, w, h) {
  const dx = Math.max(Math.abs(cx - bx) - w / 2, 0);
  const dy = Math.max(Math.abs(cy - by) - h / 2, 0);
  return dx * dx + dy * dy <= r * r;
}

// A polygon against anything. The box fast path cannot answer it, so a box
// arrives here as its four corners.
function polyOverlap(ea, a, eb, b) {
  if (a.r !== undefined) {
    return circlePoly(ea.pos.x + a.x, ea.pos.y + a.y, a.r, corners(eb, b));
  }
  if (b.r !== undefined) {
    return circlePoly(eb.pos.x + b.x, eb.pos.y + b.y, b.r, corners(ea, a));
  }
  return sat(corners(ea, a), corners(eb, b));
}

// Shape `s` in world coordinates: a polygon turned onto the entity's heading,
// a box as the four points it would have if it were one.
function corners(e, s) {
  if (s.p === undefined) {
    const x = e.pos.x + s.x;
    const y = e.pos.y + s.y;
    const w = s.w / 2;
    const h = s.h / 2;
    return [x - w, y - h, x + w, y - h, x + w, y + h, x - w, y + h];
  }

  const cos = Math.cos(e.angle);
  const sin = Math.sin(e.angle);
  const out = [];
  for (let i = 0; i < s.p.length; i += 2) {
    const x = s.p[i];
    const y = s.p[i + 1];
    out.push(e.pos.x + x * cos - y * sin, e.pos.y + x * sin + y * cos);
  }
  return out;
}

// Separating axis theorem: two convex polygons miss exactly when one of their
// edge normals has a gap between the shadows cast on it.
function sat(a, b) {
  for (const p of [a, b]) {
    for (let i = 0; i < p.length; i += 2) {
      const j = (i + 2) % p.length;
      // Not normalised: only the order of the shadows along it is read.
      const nx = p[j + 1] - p[i + 1];
      const ny = p[i] - p[j];
      if (apart(a, b, nx, ny)) return false;
    }
  }
  return true;
}

function apart(a, b, nx, ny) {
  let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
  for (let i = 0; i < a.length; i += 2) {
    const d = a[i] * nx + a[i + 1] * ny;
    if (d < amin) amin = d;
    if (d > amax) amax = d;
  }
  for (let i = 0; i < b.length; i += 2) {
    const d = b[i] * nx + b[i + 1] * ny;
    if (d < bmin) bmin = d;
    if (d > bmax) bmax = d;
  }
  return amax < bmin || bmax < amin;
}

// Inside the polygon, or within r of an edge. The crossings share a sign only
// for a point inside, whichever way the points wind.
function circlePoly(cx, cy, r, p) {
  let sides = 0;
  let near = Infinity;
  for (let i = 0; i < p.length; i += 2) {
    const j = (i + 2) % p.length;
    const ex = p[j] - p[i];
    const ey = p[j + 1] - p[i + 1];
    const dx = cx - p[i];
    const dy = cy - p[i + 1];
    sides |= ex * dy - ey * dx < 0 ? 1 : 2;
    const t = Math.max(0, Math.min(1, (dx * ex + dy * ey) / (ex * ex + ey * ey)));
    near = Math.min(near, Math.hypot(dx - ex * t, dy - ey * t));
  }
  return sides !== 3 || near <= r;
}
