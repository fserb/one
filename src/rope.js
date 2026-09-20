// rope, May 2021.

import * as ease from "./alma/src/ease.js";
import * as extra from "./alma/src/utils/extra.js";
import * as vec from "./alma/src/geom/vec.js";
import { World } from "./alma/src/rigid.js";
import * as ent from "./lib/entity.js";
import { camera } from "./lib/camera.js";
import { act } from "./lib/act.js";
import { fixed, gameOver, score, time } from "./lib/one.js";
import { comb, lp } from "./alma/src/sfx.js";
import * as sound from "./lib/sound.js";

export { render } from "./lib/entity.js";

const { clamp, lerp, TAU } = extra;

export const meta = {
  title: "rope",
  bg: "#000000",
  fg: "#402F2E",
  scoreMax: true,
  release: true,
  date: "2021-05-23",
};

const CAVE = "#1D1515";
const ROPE = "#7E6352";
const ANCHOR = "#402F2E";
const WHITE = "#B8B5B9";
const IRIS = "#212123";
const SKIN = "#5F556A";
const BODY = "#352B42";
const SAW = "#C6424F";

// The world is in metres, and this many of them fill the screen.
const VIEW = 13;
const ZOOM = 1.5;
const REACH = VIEW * 2;
const CULL = VIEW * 3;
// Radians the path turns by, at most, per band.
const TURN = 0.1;
// Bands of cave before the saw starts and the score runs.
const START = 12;

// Two strings summed, so two nodes: a list in fx is a chain, which would put
// one through the other. `blend` is the chance a sign survives a round trip: 1
// is a string and .5 is the paper's drum. The decays are long for a 100ms sound
// on purpose, so the loop barely decays and the envelope does the shaping.
const FLAT = (d) => [0, d, 1e-4];
const PLUCK = (f, blend, decay, hit) => ({
  osc: { osc: "white", env: FLAT(hit) },
  fx: comb(f, { blend, decay, damp: 0.05 }),
});

sound.make("hold", {
  osc: {
    osc: [
      PLUCK(100, 1, 3, 0.01),
      { ...PLUCK(50, 0.5, 1, 0.02), gain: 1.6 },
      { osc: "white", gain: 0.3, env: FLAT(0.1) },
    ],
    env: FLAT(0.1),
    fx: lp(100),
  },
  gain: 2.51,
  env: [0, 0.1],
});

let world;

// The hard limit and the give in one joint: below `max` a spring at `hertz`
// pulls toward `length`, and `max` is where it stops extending. At the default
// 0 hertz the spring is off and the joint is a rope, which is the tail.
function link(a, b, { max, length = max, hertz, damping, localB = [0, 0] }) {
  return world.distance(a, b, {
    localA: [0, 0],
    localB,
    length,
    min: 0,
    max,
    spring: true,
    hertz,
    damping,
    collide: false,
  });
}

// The hand and the rope of a contact between the two, or null.
function handRope(a, b) {
  if (b.data === "hand") [a, b] = [b, a];
  return a.data === "hand" && b.data === "rope" ? [a, b] : null;
}

// A hand holding something passes through rope, and so does one that just let
// go: 300ms for the rope it left, 50ms for any other. Dropping the contact is
// also what prevents the grab, since it never reaches hold().
function presolve(fa, fb) {
  const hit = handRope(fa.body, fb.body);
  if (!hit) return true;
  const [hand, rope] = hit;

  if (hand.hold !== null) return false;
  if (hand.dropped === null) return true;
  return time - hand.dropped > (hand.holder === rope.ent ? 0.3 : 0.05);
}

function hold(contact) {
  const hit = handRope(contact.a.body, contact.b.body);
  if (!hit) return;
  const [hand, rope] = hit;
  if (hand.hold !== null) return;

  const p = contact.points[0];
  sound.play("hold", { detune: 800 * (2 * Math.random() - 1) });
  hand.hold = world.distance(hand, rope, {
    localA: [0, 0],
    localB: rope.toLocal(p.x, p.y),
    length: 0,
    spring: true,
    hertz: 10,
    damping: 0.5,
    collide: false,
  });
  hand.holder = rope.ent;
  hand.dropped = null;
}

// The cave's centre line, grown a band at a time. `horizon` is the clear air
// left in each of eight columns across the path's width, so bands never stack.
class Cave extends ent.Entity {
  constructor() {
    super();
    this.path = [{ x: 0, y: -5 }];
    this.dir = { x: 0, y: -1 };
    this.turning = 0;
    this.horizon = [0, 0, 0, 0, 0, 0, 0, 0];
  }

  update() {
    const head = ent.one(Player).head;
    while (vec.distance(this.path.at(-1), head) <= REACH) this.grow();
    if (this.path.length > START) score.value += ent.game.time;
  }

  // One band: a slice across the path's width in `divs` columns, each taking a
  // rope across the band, one hanging off it, or nothing.
  grow() {
    const horizon = this.horizon;
    const last = this.path.at(-1);
    const step = VIEW / (4 + 2 * Math.random());
    const next = vec.add(last, vec.mul(this.dir, step));

    const length = VIEW + 7 * Math.random();
    const yv = vec.mul(vec.normalize(this.dir), step);
    const xv = vec.mul(vec.normalize(vec.perp(yv)), length);

    // A turn moves the outside of the bend further than the inside.
    let lastDir = vec.sub(last, this.path.at(-2) ?? last);
    if (lastDir.x === 0 && lastDir.y === 0) lastDir = { x: 0, y: -1 };
    const lastNorm = vec.mul(vec.normalize(vec.perp(lastDir)), length);

    for (let i = 0; i < horizon.length; ++i) {
      const p = i / horizon.length - 0.5;
      const a = vec.add(yv, vec.mul(xv, p));
      const b = vec.mul(lastNorm, p);
      horizon[i] -= vec.distance(a, b) / step;
    }

    // Resampled down to this band's columns, keeping the worst case.
    const divs = Math.floor(length / (2 + Math.random()));
    const span = (i) => [
      Math.floor(horizon.length * i / divs),
      Math.ceil(horizon.length * (i + 1) / divs),
    ];

    const horiz = [];
    for (let i = 0; i < divs; ++i) {
      const [h0, h1] = span(i);
      let max = -1;
      for (let x = h0; x < h1; x++) max = Math.max(max, horizon[x]);
      horiz.push(max);
    }

    // A column takes a rope once 0.4 of clear air has opened under it.
    const space = [];
    for (let i = 0; i < divs; ++i) {
      if (horiz[i] > -0.4) space.push(null);
      else space.push(Math.random() < 0.5 ? "line" : "hang");
    }
    const isLine = (i) => space[i] === "line";

    // Never three across in a row, then drop some so the band stays climbable.
    let cut = Math.max(1, divs - 4);
    for (let i = 0; i < divs - 2; ++i) {
      if (isLine(i) && isLine(i + 1) && isLine(i + 2)) {
        space[i + 2] = null;
        cut--;
      }
    }
    for (let i = 0; i < cut; i++) {
      space[Math.floor(divs * Math.random())] = null;
    }

    // How upright the path runs decides which kind comes out level. That one is
    // pinned at both ends; the steep one hangs from its top.
    const upright = Math.abs(vec.dot(vec.normalize(this.dir), { x: 0, y: -1 }));
    const pinLine = upright >= 0.25;
    const pinHang = upright <= 0.75;
    const band = (x, y = 0) =>
      vec.add(next, vec.add(vec.mul(xv, x / divs - 0.5), vec.mul(yv, y)));

    for (let i = 0; i < divs; ++i) {
      if (space[i] === "hang") {
        const near = horiz[i] + 0.5;
        const far = near + 0.75 + 1.5 * Math.random();
        horiz[i] = far;
        new Rope(band(i + 0.5, far), band(i + 0.5, near), pinHang);
        continue;
      }
      if (!isLine(i)) continue;

      // Two adjacent columns make one long rope instead of two short ones.
      const end = isLine(i + 1) ? i + 1 : i;
      for (let x = i; x <= end; x++) horiz[x] = 0;
      new Rope(band(i), band(end + 1), pinLine);
      i = end;
    }

    for (let i = 0; i < divs; ++i) {
      const [h0, h1] = span(i);
      for (let x = h0; x < h1; x++) {
        horizon[x] = Math.max(horizon[x], horiz[i]);
      }
    }

    this.path.push(next);

    this.turning = clamp(this.turning + TURN * (Math.random() - 0.5), -TURN, TURN);
    const turn = vec.mul(vec.normalize(vec.perp(this.dir)), this.turning);
    this.dir = vec.normalize(vec.add(this.dir, turn));
  }
}

// Bricks parallaxed back by BGZOOM, on a hash of the cell so nothing is stored.
const BGZOOM = 4;
const BGSEED = 1 + Math.random();

class Bricks extends ent.Entity {
  render(ctx) {
    ctx.fillStyle = CAVE;

    const half = 7.5 * ZOOM * BGZOOM;
    const x0 = Math.round(camera.x - half);
    const y0 = Math.round(camera.y - half);
    const x1 = Math.round(camera.x + half);
    const y1 = Math.round(camera.y + half);

    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const v = Math.floor(BGSEED * (x + y * x + y + x * x * y));
        if (v % 346 !== 0) continue;

        ctx.beginPath();
        ctx.roundRect(
          (x - camera.x) / BGZOOM + camera.x,
          (y - camera.y) / BGZOOM + camera.y,
          2,
          1.24,
          0.2,
        );
        ctx.fill();
      }
    }
  }
}

// Links plus slack have to fit the span; if not, pull the ends in and retry.
function fit(a, b) {
  const len = vec.distance(a, b);
  const diff = len - (Math.round(len) * 1.1 + 0.1);
  if (diff <= -0.05) return [a, b];
  const d = vec.mul(vec.normalize(vec.sub(b, a)), Math.max(diff, 0.05) / 2);
  return fit(vec.add(a, d), vec.sub(b, d));
}

class Rope extends ent.Entity {
  // A chain of one-metre links from a to b, pinned at the far end when `close`
  // and hanging otherwise. Heaviest link first, so a rope does not whip.
  constructor(from, to, close = true) {
    super();
    const [a, b] = fit(from, to);
    const v = vec.normalize(vec.sub(b, a));
    const n = vec.perp(v);
    const parts = Math.round(vec.distance(a, b));

    // A hanging rope starts pushed to one side, so it does not balance upright.
    const dir = close || Math.random() < 0.5 ? 1 : -1;
    const angle = vec.angle(v) - Math.PI / 2;

    this.pos.x = a.x;
    this.pos.y = a.y;
    this.parts = [world.body(a)];

    for (let i = 0; i < parts; ++i) {
      const p = world.body({
        x: a.x + v.x * (i + 1) + dir * n.x * 0.5,
        y: a.y + v.y * (i + 1) + dir * n.y * 0.5,
        angle,
        type: "dynamic",
        damping: 0.25,
        data: "rope",
      });
      p.ent = this;
      p.box({
        w: 0.05,
        h: 1,
        y: -0.5,
        density: 9.5 - i * 0.2,
        filter: { group: -3, category: 4, mask: 4 },
      });
      this.parts.push(p);
    }

    if (close) this.parts.push(world.body(b));

    for (let i = 0; i < this.parts.length - 1; ++i) {
      // The last link meets the far anchor at its centre, not at its tip.
      const tip = close && i === this.parts.length - 2 ? [0, 0] : [0, -1];
      link(this.parts[i], this.parts[i + 1], {
        max: 0.1,
        hertz: 10,
        damping: 0.5,
        localB: tip,
      });
    }
  }

  update() {
    const player = ent.one(Player);
    if (vec.distance(this.parts[0], player.head) < CULL) return;
    // A rope a hand still holds stays: destroying it leaves the arm pointing
    // at a dead one.
    if (player.hands.some((h) => h.hold?.b.ent === this)) return;
    this.remove();
  }

  remove() {
    for (const p of this.parts) p.destroy();
    super.remove();
  }

  // _draw translated to pos, and the bodies are in world metres. The curve runs
  // through the centres of mass, with the link origins as the controls.
  render(ctx) {
    ctx.translate(-this.pos.x, -this.pos.y);

    const r = this.parts;
    const end = r.at(-1);

    ctx.strokeStyle = ROPE;
    ctx.lineWidth = 0.1;
    ctx.beginPath();
    ctx.moveTo(r[0].x, r[0].y);
    for (let i = 1; i < r.length; ++i) {
      ctx.quadraticCurveTo(r[i - 1].x, r[i - 1].y, r[i].cx, r[i].cy);
    }
    ctx.lineTo(end.x, end.y);
    ctx.stroke();

    ctx.fillStyle = ANCHOR;
    ctx.fillCircle(r[0].x, r[0].y, 0.2);
    if (end.data !== "rope") ctx.fillCircle(end.x, end.y, 0.2);
  }
}

const SHOULDER = 0.6;
const WRIST = 0.15;

// `ra` wide across a and `rb` across b, bent through c.
function taper(ctx, a, ra, c, b, rb) {
  const n = vec.normalize(vec.perp(vec.sub(b, a)));
  ctx.beginPath();
  ctx.moveTo(a.x + n.x * ra, a.y + n.y * ra);
  ctx.quadraticCurveTo(c.x, c.y, b.x + n.x * rb, b.y + n.y * rb);
  ctx.lineTo(b.x - n.x * rb, b.y - n.y * rb);
  ctx.quadraticCurveTo(c.x, c.y, a.x - n.x * ra, a.y - n.y * ra);
  ctx.closePath();
}

class Player extends ent.Entity {
  constructor() {
    super();
    this.eye = { x: 0, y: 0 };
    this.eyelook = { x: 0, y: 0 };
    this.focuson = null;
    this.onair = 0;
    this.pupil = 0;
    this.blink = 0;
    this.blinking = 1;
    this.looking = 2;
    this.breath = 0;

    const density = 1 / 10;

    this.head = world.body({ x: 0, y: 0, type: "dynamic", data: "head" });
    // A category of its own, which only the saw's mask includes. A category of
    // 0 fails the broadphase query, so the saw would pass over the head.
    this.head.circle({ r: 0.6, density, filter: { category: 8, mask: 8 } });
    this.pos.x = this.head.x;
    this.pos.y = this.head.y;

    this.tail = [];
    let last = this.head;
    for (let i = 0; i < 2; ++i) {
      // box2d solves the length limit softly and returns the energy, so
      // undamped the tail winds round the head at 5.2 turns a second, which the
      // joint does not constrain. At a damping of 3 it winds 1.48 a second.
      const o = world.body({ x: 0, y: i, type: "dynamic", damping: 3 });
      o.radius = 0.4 - i * 0.2;
      o.circle({
        r: o.radius,
        density,
        sensor: true,
        filter: { group: -1, category: 0 },
      });

      link(last, o, { max: 1 - i * 0.4 });
      last = o;
      this.tail.push(o);
    }

    this.hands = [this.makeHand(-1), this.makeHand(1)];
  }

  // Hand to elbow to head, with a link() at each step. The hand carries its own
  // state: the joint holding a rope, the rope it last held, and when it let go.
  makeHand(side) {
    const hand = world.body({
      x: 1.5 * side,
      y: -1,
      type: "dynamic",
      bullet: true,
      damping: 0.1,
      data: "hand",
    });
    // A small solid one that meets rope, a wide sensor for a click near the
    // hand, and a tiny one for the pointer query. Only the solid one has mass,
    // since a sensor weighs what its density says. It is built first, because
    // box2d asserts on a massless body.
    hand.circle({
      r: 0.3,
      density: 1,
      preSolveEvents: true,
      filter: { category: 4, mask: 4 },
    });
    hand.circle({ r: 0.8 * ZOOM, sensor: true, density: 0 });
    hand.circle({ r: 0.1, density: 0, filter: { group: 3 } });

    hand.elbow = world.body({ x: side, y: -0.5, type: "dynamic" });
    hand.elbow.circle({ r: 0.1, density: 0.1 });

    const give = { max: 0.9, length: 0.85, hertz: 10, damping: 0.5 };
    link(hand, hand.elbow, give);
    link(hand.elbow, this.head, give);

    hand.hold = null;
    hand.holder = null;
    hand.dropped = null;
    return hand;
  }

  update() {
    const dt = ent.game.time;
    this.pos.x = this.head.x;
    this.pos.y = this.head.y;

    this.breath = Math.sin(TAU * time * 0.12);
    this.pupil = Math.cos(333 + TAU * time * 0.035);

    this.blinking -= dt;
    if (this.blinking <= 0 && this.blink === 0) {
      act(this)
        .attr("blink", 1, 0.15, ease.quadIn).then()
        .attr("blink", 0, 0.15, ease.quadIn);
      this.blinking = 2 + 8 * Math.random();
    }

    this.eye.x = lerp(this.eye.x, this.eyelook.x, 0.15);
    this.eye.y = lerp(this.eye.y, this.eyelook.y, 0.15);

    if (this.hands.every((h) => h.hold === null)) {
      this.eyelook.x = this.eyelook.y = 0;
      this.looking = 5 + Math.random();
      this.onair += dt;
      if (this.onair > 5) gameOver({ score: true });
      return;
    }
    this.onair = 0;

    // Watching holds the wander timer off, so the eye drifts only once both
    // hands are on a rope and nothing is in flight.
    const watch = ent.one(Throw)?.hand ??
      this.hands.find((h) => h.hold === null);
    if (watch) {
      this.focuson = watch;
      this.looking = 5 + Math.random();
    }

    this.looking -= dt;
    if (this.looking <= 0) {
      this.looking = 5 + 3 * Math.random();
      this.eyelook.x = -1 + 2 * Math.random();
      this.eyelook.y = -1 + 2 * Math.random();
    } else if (this.focuson) {
      const d = vec.normalize(vec.sub(this.focuson, this.head));
      this.eyelook.x = d.x;
      this.eyelook.y = d.y;
    }
  }

  postUpdate() {
    const off = this.pos.x - camera.x;
    const angle = Math.abs(off) < 1 ? 0 : -TAU * off / 40;

    // approach()'s rates are per second: 3 is its default for the pan, and the
    // lean follows slower. Slowing the pan loses the player.
    const to = { x: this.pos.x, y: this.pos.y, angle };
    camera.approach(to, ent.game.time, { angle: 2.45 });
  }

  // _draw translated to pos, and the bodies are in world metres.
  render(ctx) {
    ctx.translate(-this.pos.x, -this.pos.y);

    ctx.fillStyle = BODY;
    for (const hand of this.hands) {
      taper(ctx, hand, WRIST, hand.elbow, this.head, SHOULDER);
      ctx.fill();
    }

    ctx.fillStyle = SKIN;
    for (const hand of this.hands) {
      ctx.fillCircle(hand.x, hand.y, hand.hold ? 0.22 : 0.3);
    }

    this.renderTail(ctx);
    this.renderHead(ctx);
  }

  // Not a taper(): the tip turns with the tail while the head end stays square
  // to the neck, so each end has its own normal and control, and the tip is
  // capped.
  renderTail(ctx) {
    const h = this.head;
    const tip = this.tail[1];
    const r = tip.radius;

    // The middle is pulled back so it cannot fold through the head.
    const mid = vec.lerp(h, tip, 0.5);
    const m = vec.add(mid, vec.clamp(vec.sub(this.tail[0], mid), 0, 0.3));

    const nh = vec.normalize(vec.perp(vec.sub(h, m)));
    const along = vec.normalize(vec.sub(m, tip));
    const nt = vec.perp(along);

    ctx.fillStyle = BODY;
    ctx.beginPath();
    ctx.moveTo(tip.x - nt.x * r, tip.y - nt.y * r);
    ctx.quadraticCurveTo(
      m.x - nt.x * 0.3,
      m.y - nt.y * 0.3,
      h.x - nh.x * SHOULDER,
      h.y - nh.y * SHOULDER,
    );
    ctx.lineTo(h.x + nh.x * SHOULDER, h.y + nh.y * SHOULDER);
    ctx.quadraticCurveTo(
      m.x + nt.x * 0.3,
      m.y + nt.y * 0.3,
      tip.x + nt.x * r,
      tip.y + nt.y * r,
    );
    ctx.arcTo(
      tip.x - along.x * r * 5,
      tip.y - along.y * r * 5,
      tip.x - nt.x * r,
      tip.y - nt.y * r,
      r,
    );
    ctx.closePath();
    ctx.fill();
  }

  // Drawn in the same 38-unit space trap uses, then scaled down to metres.
  renderHead(ctx) {
    ctx.save();
    ctx.translate(this.head.x, this.head.y);
    ctx.scale(0.45 / 38, 0.45 / 38);

    ctx.fillStyle = BODY;
    ctx.fillCircle(0, 0, 51 + this.breath);
    ctx.fillStyle = WHITE;
    ctx.fillCircle(0, 0, 38);

    const ER = 16;
    const rb = 20.5 - this.pupil;
    const rx = rb - 5 * vec.len(this.eye);
    const ang = vec.angle(this.eye);

    ctx.fillStyle = IRIS;
    ctx.beginPath();
    ctx.ellipse(this.eye.x * ER, this.eye.y * ER, rx, rb, ang, 0, TAU);
    ctx.fill();

    const f = Math.sin((vec.len(this.eye) / Math.SQRT2) * Math.PI / 2) ** 2;
    const ff = 4 + 2 * f;
    const d = rb / 4 + (rb / 10) * f;
    ctx.fillStyle = WHITE;
    ctx.beginPath();
    ctx.ellipse(
      this.eye.x * ER - d,
      this.eye.y * ER - d,
      rx / ff,
      rb / ff,
      ang,
      0,
      TAU,
    );
    ctx.fill();

    if (this.blink > 0) {
      ctx.fillStyle = BODY;
      ctx.beginPath();
      ctx.arc(0, 0, 39, Math.PI, TAU);
      if (this.blink < 0.5) {
        ctx.ellipse(0, 0, 39, lerp(39, 0, this.blink * 2), 0, 0, Math.PI, true);
      } else {
        ctx.ellipse(0, 0, 39, lerp(0, 39, (this.blink - 0.5) * 2), 0, 0, Math.PI);
      }
      ctx.fill();
    }

    ctx.restore();
  }
}

// The pull is backwards: dragging one way throws the hand the other. `hand` is
// null between throws, and the entity outlives each one.
class Throw extends ent.Entity {
  constructor() {
    super();
    this.hand = null;
    this.target = { x: 0, y: 0 };
  }

  update() {
    const input = ent.game.input;
    if (this.hand === null) {
      if (input.just.act) this.grab();
      return;
    }
    if (input.press.act) {
      this.drag();
      return;
    }
    this.release();
  }

  // The hand under the pointer, unless it is loose and moving fast.
  grab() {
    const p = ent.game.input;

    let best = null;
    let dist = Infinity;
    for (const f of world.pick(p.x, p.y)) {
      const b = f.body;
      if (b.data !== "hand") continue;
      if (!b.hold && Math.hypot(b.vx, b.vy) > 5) continue;

      const d = vec.distance(p, b);
      if (d >= dist) continue;
      best = b;
      dist = d;
    }

    if (best === null) return;
    this.hand = best;
    this.drag();
  }

  drag() {
    const pull = vec.clamp(vec.sub(ent.game.input, this.hand), 0, 3);
    this.target = vec.add(this.hand, pull);
    this.pos.x = this.hand.x;
    this.pos.y = this.hand.y;
    this.angle = vec.angle(pull);
  }

  release() {
    const hand = this.hand;
    this.hand = null;

    const v = vec.sub(hand, this.target);
    const l = vec.len(v);
    // Too short a drag is a tap, not a throw.
    if (l < 1) return;

    if (hand.hold) {
      hand.hold.destroy();
      hand.hold = null;
      hand.dropped = time;
    }
    const f = vec.mul(v, 50 * l);
    hand.push(f.x, f.y);
  }

  // _draw put the hand at the origin and the target on +x.
  render(ctx) {
    if (this.hand === null) return;

    const len = vec.distance(this.target, this.hand);
    const BR = 0.4;
    const SR = 0.05;

    ctx.strokeStyle = SAW;
    ctx.lineWidth = 0.075;
    ctx.setLineDash([0.2, 0.2]);
    ctx.lineDashOffset = this.age * 0.4; // one dash period a second

    ctx.beginPath();
    ctx.moveTo(len, -SR);
    ctx.arcTo(len + 10, 0, len, SR, SR);
    ctx.lineTo(0, BR);
    ctx.arcTo(-10, 0, 0, -BR, BR);
    ctx.closePath();
    ctx.stroke();
  }
}

const TEETH = 20;
const TEETH_PHASE = 50;
const TOOTH = 1;
const TOOTH_UP = TOOTH / 3;

// The shortest way round to an angle.
const wrap = (a) => a - TAU * Math.round(a / TAU);

class Saw extends ent.Entity {
  constructor() {
    super();
    // Kinematic, since it is moved by hand every step, and never asleep.
    this.body = world.body({ y: 5 * ZOOM, type: "kinematic", canSleep: false });
    // A sensor filling the space behind the line the teeth ride, wider than the
    // view, and a category only the head's mask includes.
    const depth = 6.5;
    this.body.box({
      w: 52,
      h: depth,
      y: depth / 2,
      sensor: true,
      filter: { category: 8, mask: 8 },
    });

    this.at = 0;
    this.phase = 0;
    // The pace rises by one every `wait` steps, and `wait` itself shortens.
    this.pace = 0;
    this.wait = 1000;
    this.since = 0;
  }

  // One physics step, since every rate here is per step and not per second.
  step() {
    this.phase = (this.phase + 1) % TEETH_PHASE;

    const path = ent.one(Cave).path;
    if (path.length <= START || this.at >= path.length) return;

    const body = this.body;
    const here = path[this.at];
    const last = path[this.at - 1] ?? { x: 0, y: 0 };

    // It sprints if the player gets too far ahead.
    const away = vec.distance(ent.one(Player).head, body);
    const reach = 0.001 * (away > 20 ? 100 : this.pace);
    const full = vec.sub(here, body);
    const next = vec.add(body, vec.clamp(full, 0, reach));

    const aim = vec.angle(vec.sub(here, last)) + TAU / 4;
    const turn = clamp(wrap(aim - body.angle), -0.0035, 0.0035);
    body.moveTo(next.x, next.y, body.angle + turn);

    if (vec.len(full) < 0.001) this.at++;

    if (++this.since > this.wait) {
      this.since -= this.wait;
      this.wait = Math.max(300, this.wait * 0.9);
      this.pace++;
    }
  }

  update() {
    this.pos.x = this.body.x;
    this.pos.y = this.body.y;
    this.angle = this.body.angle;
  }

  // An infinite line, so only the span crossing the view is drawn. _draw put
  // the line on the x axis with the filled side at +y.
  render(ctx) {
    const half = 1024 / camera.scale / 2;
    const b = half * Math.SQRT2;

    const view = vec.rotate(vec.sub(camera, this.pos), -this.angle);
    if (Math.abs(view.y) > b) return;

    // Anchored to the world, so the teeth do not drift as the view moves.
    const size = 2 * b / (TEETH - 1);
    const x0 = view.x - b - size * this.phase / TEETH_PHASE - view.x % size;

    ctx.fillStyle = SAW;
    ctx.beginPath();
    ctx.moveTo(x0, TOOTH_UP);
    for (let i = 0; i < TEETH; ++i) {
      ctx.lineTo(x0 + size * i, TOOTH_UP);
      ctx.lineTo(x0 + size * (i + 0.5), TOOTH_UP - TOOTH);
      ctx.lineTo(x0 + size * (i + 1), TOOTH_UP);
    }
    ctx.lineTo(view.x + b, TOOTH_UP);
    ctx.lineTo(view.x + b, half * 2);
    ctx.lineTo(view.x - b, half * 2);
    ctx.fill();
  }
}

// The board is the square the camera covers, which the turn leaves corners of
// the canvas outside. Those are cave wall, painted over the world.
class Wall extends ent.Entity {
  static screen = true;

  constructor() {
    super();
    this.pos.x = this.pos.y = 512;
  }

  update() {
    this.angle = -camera.angle;
  }

  render(ctx) {
    // Half the canvas diagonal, so the outer square covers it at any turn.
    const out = 512 * Math.SQRT2;
    ctx.fillStyle = CAVE;
    ctx.beginPath();
    ctx.rect(-out, -out, 2 * out, 2 * out);
    ctx.rect(-512, -512, 1024, 1024);
    ctx.fill("evenodd");
  }
}

export function init() {
  // The engine holds 32 worlds for the life of the page, so the last round has
  // to release its slot.
  world?.destroy();
  world = new World({ gravity: { x: 0, y: 9.8 } });
  world.presolve = presolve;

  ent.reset([Cave, Bricks, Rope, Player, Throw, Saw, Wall]);

  new Cave();
  new Bricks();
  new Player();
  new Throw();
  new Saw();
  new Wall();

  // The opening handholds, so the first swing is always the same.
  new Rope({ x: -2, y: 0 }, { x: 2, y: 0 });
  new Rope({ x: -4, y: 2 }, { x: 4, y: 2 });
  new Rope({ x: -3.5, y: -6 }, { x: -3.5, y: -1 }, false);
  new Rope({ x: 0, y: -6 }, { x: 0, y: -2 }, false);
  new Rope({ x: 3.5, y: -6 }, { x: 3.5, y: -1 }, false);

  camera.moveTo({ x: 0, y: 0, scale: 1024 / (VIEW * ZOOM) });
}

export function update(dt) {
  const saw = ent.one(Saw);

  // Events are read inside the loop, since a step clears the one before it.
  fixed(60, (h) => {
    world.step(h);
    for (const c of world.began) hold(c);
    for (const s of world.sensorBegan) {
      if (s.visitor.body.data === "head") gameOver({ score: true });
    }
    saw?.step();
  });

  ent.update(dt);
}
