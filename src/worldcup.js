/*
 * worldcup - one-on-one ragdoll football, after rujogames' A Small World Cup
 * (Ludum Dare 38 compo, "A Small World").
 *
 * The rules and numbers are the original's, read out of its Construct 2 export
 * (v1.3.2). It is 700x400 pixels at Construct's 50 pixels a metre, so the
 * arena is 14 m by 6.6 m from the grass to the ceiling, and the square board
 * puts the stand above it.
 *
 * Press, drag and let go: the torso gets one impulse along the drag, two
 * newton-seconds for every metre of it and 10 at most. A tap, a drag of 0.2 m
 * or less, throws the torso at the point tapped instead, by the same rule on
 * the distance from the torso to it; that one is from the Construct 3 version
 * (v1.3.2.5, on CrazyGames). Nothing else moves a
 * player. The ragdoll is six bodies on limited joints with no motors. The
 * original has nothing that stands a player back up; here a weak torque on
 * the torso does, since without it a player spent two thirds of a match lying
 * down.
 *
 * A match is 90 minutes at half a second each, plus 0 to 5 minutes of
 * stoppage, and a draw at the whistle plays on to a golden goal. The round is
 * a cup run of seven matches: a win is the next opponent, one step harder and
 * in a kit of its own, and a loss ends the run. The score is the goals you scored across it.
 *
 * The world is in metres and the board in its 1024 units. An entity drawn off
 * the bodies has a scale of PPM, so its render() draws in metres; the
 * particles, the score popups and the scoreboard stay in board units.
 */

import { clamp } from "./alma/src/utils/extra.js";
import * as random from "./alma/src/random.js";
import { World } from "./alma/src/rigid.js";
import * as ent from "./lib/entity.js";
import { shake } from "./lib/camera.js";
import { fixed, gameOver, msg } from "./lib/one.js";
import * as play from "./lib/sounds.js";

export { render } from "./lib/entity.js";

export const meta = {
  title: "worldcup",
  bg: "#9BD0E8",
  fg: "#1E252B",
  scoreMax: true,
  date: "2026-09-21",
};

const M = 14;
const PPM = 1024 / M;
const CX = M / 2;
const G = 11.4; // the grass
const ROOF = G - 6.6;
const DEG = Math.PI / 180;

const WHITE = "#FFFFFF";
const INK = "#1E252B";
const OUTLINE = "#0E1620";
const STAND = "#C9D7DE";
const TRUSS = "#56616B";
const TRUSS_DARK = "#3E4750";
const BALL = "#F6F2E7";
const BALL_DARK = "#2A3B2F";

const BAR = G - 2.8; // the crossbar's top; the goal has no post to hit
const MOUTH = 1; // the crossbar's length out from the wall
const LINE = 0.72; // a ball centre past this, from the wall, is in
const EDGE = MOUTH + 0.24; // a ball centre nearer the wall than this, above the bar, rests on it
const OVER = 8; // what a metre along the top of the crossbar counts as
const STUCK = 4.5; // metres a ball on top of the crossbar counts as, on top of OVER
const SPOT = G - 3.5; // where the kickoff drops the ball
const PLAYER = 2;
const BALLC = 4;
const SOLID = 8;

const REACH = 5; // a drag this long is the full impulse
const KICK = 2; // newton-seconds per metre of drag
const TAP = 0.2; // a drag no longer than this is a tap
const MINUTE = 0.5; // seconds a match minute takes
const MATCHES = 7;
const SLOW = 0.1; // time scale after a goal and at the whistle
// &p1=every:tries:spread:powers:err makes you a planner, &p2= sets the
// opponent's. powers split by /, empty keeps the default. &debug=true draws
// each planner's last plan over it and stops the game on each plan until the
// right arrow.

const RIGHT = 5;
const DAMP = 0.6;

let world;
let ball;
let you;
let bot;
let cup;
let ticks; // physics steps since the round began
let debug;
let paused;

function mix(a, b, t) {
  let out = "#";
  for (const shift of [16, 8, 0]) {
    const x = (parseInt(a.slice(1), 16) >> shift) & 255;
    const y = (parseInt(b.slice(1), 16) >> shift) & 255;
    out += Math.round(x + (y - x) * t).toString(16).padStart(2, "0");
  }
  return out;
}

// A kit: the shirt, a pattern on it in `pat`, `trim` for the sock band and the
// shorts' side stripe, then shorts, socks, boots, skin and its darker tone, hair
// and how it is cut.
function kit(shirt, pattern, pat, trim, shorts, socks, boots, skin, hair, cut) {
  return {
    shirt,
    pattern,
    pat,
    trim,
    shorts,
    socks,
    boots,
    skin,
    hair,
    cut,
    edge: mix(shirt, "#000000", 0.45),
    fan: mix(shirt, STAND, 0.4),
    skinEdge: mix(skin, "#000000", 0.3),
    hairEdge: mix(hair, "#000000", 0.4),
  };
}

const YOU = kit(
  "#F2C14E",
  "stripes",
  "#FBE3A4",
  "#2E3A59",
  "#2E3A59",
  "#F2C14E",
  INK,
  "#E3A77C",
  "#3A2418",
  "short",
);

// One opponent a match, in cup order; none in yellow, and the last in red.
const OPPONENTS = [
  kit(
    "#F2EFE4",
    "solid",
    "",
    "#2E4A8B",
    "#2E4A8B",
    "#F2EFE4",
    INK,
    "#F1C7A5",
    "#E8C872",
    "short",
  ),
  kit(
    "#2F8F4E",
    "solid",
    "",
    "#F2EFE4",
    "#F2EFE4",
    "#2F8F4E",
    "#F2EFE4",
    "#8D5A36",
    "#1A1210",
    "buzz",
  ),
  kit(
    "#F2EFE4",
    "stripes",
    "#7FB7E6",
    INK,
    INK,
    "#F2EFE4",
    INK,
    "#E3A77C",
    "#2B1A12",
    "long",
  ),
  kit(
    "#F07A2A",
    "solid",
    "",
    INK,
    "#F2EFE4",
    "#F07A2A",
    INK,
    "#F1C7A5",
    "#C98A3A",
    "short",
  ),
  kit(
    "#F2EFE4",
    "sash",
    "#D1495B",
    "#D1495B",
    "#F2EFE4",
    "#F2EFE4",
    INK,
    "#C68652",
    "#1A1210",
    "short",
  ),
  kit(
    "#2F8F4E",
    "hoops",
    "#F2EFE4",
    "#F2EFE4",
    "#F2EFE4",
    "#2F8F4E",
    INK,
    "#F1C7A5",
    "#B5502A",
    "short",
  ),
  kit(
    "#D1495B",
    "chevron",
    "#8B2E3C",
    "#F2EFE4",
    "#F2EFE4",
    "#D1495B",
    INK,
    "#5E3A22",
    "#1A1210",
    "afro",
  ),
];

// The shadow side of a part is what a copy of it moved toward the lamp, up and
// to the left, leaves uncovered.
const LAMP_X = -0.054;
const LAMP_Y = -0.072;

// A body part in its own frame: `paint` fills it clipped to `path`, then the
// shadow side darkens, then a faint edge in `edge`.
function part(ctx, b, path, paint, edge) {
  ctx.save();
  ctx.translate(b.x, b.y);
  ctx.rotate(b.angle);
  ctx.beginPath();
  path();
  ctx.save();
  ctx.clip();
  paint();
  const c = Math.cos(b.angle);
  const s = Math.sin(b.angle);
  const ox = LAMP_X * c + LAMP_Y * s;
  const oy = LAMP_Y * c - LAMP_X * s;
  ctx.beginPath();
  ctx.rect(-1, -1, 2, 2);
  ctx.translate(ox, oy);
  path();
  ctx.translate(-ox, -oy);
  ctx.fillStyle = "rgba(0,0,0,0.2)";
  ctx.fill("evenodd");
  ctx.restore();
  ctx.beginPath();
  path();
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = edge;
  ctx.lineWidth = 0.015;
  ctx.stroke();
  ctx.restore();
}

// The outline round a whole player is every part drawn fat in one dark colour
// before any part is drawn.
function silhouette(ctx, b, path) {
  ctx.save();
  ctx.translate(b.x, b.y);
  ctx.rotate(b.angle);
  ctx.beginPath();
  path();
  ctx.fillStyle = OUTLINE;
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 0.1;
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.restore();
}

function fill(ctx, color) {
  ctx.fillStyle = color;
  ctx.fillRect(-1, -1, 2, 2);
}

// The ground, the two walls, the roof and the two crossbars.
function arena(w) {
  const solid = { friction: 0.9, restitution: 0.9, filter: { category: SOLID } };
  w.box({ x: CX, y: G + 1, w: M + 2, h: 2, ...solid });
  w.box({ x: -1, y: G - 4, w: 2, h: 10, ...solid });
  w.box({ x: M + 1, y: G - 4, w: 2, h: 10, ...solid });
  w.box({ x: CX, y: ROOF - 1, w: M + 2, h: 2, ...solid });
  for (const x of [MOUTH / 2, M - MOUTH / 2]) {
    w.box({
      x,
      y: BAR + 0.05,
      w: MOUTH,
      h: 0.1,
      friction: 0.5,
      restitution: 0.2,
      filter: { category: SOLID },
    });
  }
}

function ballBody(w) {
  const b = w.body({ x: CX, y: SPOT, type: "dynamic", spinDamping: 0.01 });
  b.circle({
    r: 0.24,
    density: 1.5,
    friction: 0.9,
    restitution: 0.9,
    filter: { category: BALLC, mask: PLAYER | SOLID },
  });
  return b;
}

// Sizes are the original's: a torso as wide as it is tall, a head nearly as
// wide, arms that hang to the hip and short legs. Its legs hang just under the
// torso and hit it past about 35 degrees, so they stand stiff and wide; that is
// what keeps a player on its feet, and the leg limit here stands in for it.
function ragdoll(w, x, group) {
  const p = {};
  const part = (x, y) =>
    w.body({ x, y, type: "dynamic", spinDamping: 0.01, data: group });
  const y = G - 0.3 - 0.33;
  const shape = {
    density: 1,
    friction: 0.5,
    restitution: 0.2,
    filter: { group, category: PLAYER, mask: PLAYER | BALLC | SOLID },
  };
  p.torso = part(x, y);
  p.torso.box({ w: 0.42, h: 0.54, radius: 0.06, ...shape });

  p.head = part(x, y - 0.52);
  p.head.circle({ r: 0.21, ...shape });
  w.revolute(p.torso, p.head, {
    x,
    y: y - 0.33,
    lower: -50 * DEG,
    upper: 50 * DEG,
  });

  p.limbs = [];
  p.pose = [[p.torso, x, y], [p.head, x, y - 0.52]];
  for (
    const [dx, dy, len, lim] of [
      [-0.27, -0.21, 0.54, 90],
      [0.27, -0.21, 0.54, 90],
      [-0.16, 0.33, 0.3, 35],
      [0.16, 0.33, 0.3, 35],
    ]
  ) {
    const b = part(x + dx, y + dy + len / 2);
    b.box({ w: 0.18, h: len, ...shape });
    w.revolute(p.torso, b, {
      x: x + dx,
      y: y + dy,
      lower: -lim * DEG,
      upper: lim * DEG,
    });
    b.len = len;
    p.limbs.push(b);
    p.pose.push([b, x + dx, y + dy + len / 2]);
  }
  return p;
}

// How far a ball at (x, y) is from going in the goal on `side`. The only way in
// is the mouth under the open end of the crossbar, so a ball above the goal
// has to go out along the bar past its end and then down. Being up there at all
// counts STUCK metres, and each metre along the bar OVER times, since a ball up
// there mostly sits on the bar or against the wall and does not roll off by
// itself.
function toGoal(x, y, side) {
  const u = side < 0 ? x : M - x;
  const top = BAR + 0.34;
  const bottom = G - 0.24;
  if (u < MOUTH && y > BAR) return Math.max(0, u - LINE);
  if (u < EDGE && y <= BAR) {
    return STUCK + OVER * (EDGE - u) + top - y + MOUTH - LINE;
  }
  return Math.hypot(u - MOUTH, y - clamp(y, top, bottom)) + MOUTH - LINE;
}

// The angle, in radians, that the mouth of the goal on `side` fills as seen
// from a ball at (x, y). Past the mouth it is all of π, and on top of the
// crossbar, or nearer the wall than its end above it, the bar is in the way
// and it is 0.
function view(x, y, side) {
  const u = (side < 0 ? x : M - x) - MOUTH;
  if (y <= BAR && u < EDGE - MOUTH) return 0;
  if (u <= 0) return Math.PI;
  return Math.atan2(G - 0.24 - y, u) - Math.atan2(BAR + 0.34 - y, u);
}

// How good a ball at (x, y) is for the side whose own goal is on `side`: how
// much nearer it is to going in their goal than its own, a pitch length to 1,
// and a fifth for each radian more of their mouth it sees than of its own.
function worth(x, y, side) {
  const near = (toGoal(x, y, side) - toGoal(x, y, -side)) / M;
  return near + 0.2 * (view(x, y, -side) - view(x, y, side));
}

// One physics step of a player. Each side's own goal mouth pushes its own
// parts out with a newton each, which keeps a player from parking in front of
// its net. The torque on the torso toward upright is weak enough that a throw
// still turns the body over in the air.
function brace(p) {
  const x0 = p.side < 0 ? -0.46 : M - 0.94;
  for (const [b] of p.pose) {
    if (b.x < x0 || b.x > x0 + 1.4 || b.y < BAR + 0.14) continue;
    b.push(-p.side, 0);
  }

  const t = p.torso;
  const a = Math.atan2(Math.sin(t.angle), Math.cos(t.angle));
  t.torque(-a * RIGHT - t.spin * DAMP);
}

const CLOUDS = [[3, 6.2, 1], [10.5, 5.7, 0.8], [7.2, 7.1, 0.6]];

// Sky, clouds, the far stand and its crowd, the ad boards, the roof truss the
// scoreboard hangs from, the grass, and the shadows on the grass.
// `crowd` is the stand's people as x, y pairs in four lists: two plain tones,
// then the left team's fans and the right team's.
class Pitch extends ent.Entity {
  constructor() {
    super();
    this.scale = PPM;
    arena(world);
    this.crowd = [[], [], [], []];
    for (let y = G - 2.2; y < G - 0.5; y += 0.22) {
      for (let x = 0.1; x < M; x += 0.2) {
        const fan = random.random() < 0.3;
        this.crowd[fan ? (x < CX ? 2 : 3) : random.randInt(2)].push(x, y);
      }
    }
  }

  render(ctx) {
    ctx.fillStyle = WHITE;
    for (const [x, y, k] of CLOUDS) {
      for (
        const [dx, dy, r] of [[0, 0, 0.5], [0.55, -0.2, 0.6], [1.15, 0, 0.45], [
          0.55,
          0.15,
          0.5,
        ]]
      ) {
        ctx.beginPath();
        ctx.arc(x + dx * k, y + dy * k, r * k, 0, 2 * Math.PI);
        ctx.fill();
      }
    }

    ctx.fillStyle = STAND;
    ctx.fillRect(0, G - 2.4, M, 2.4);
    const tones = ["#B3C3CC", "#DCE5EA", YOU.fan, bot.kit.fan];
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = tones[i];
      const c = this.crowd[i];
      for (let j = 0; j < c.length; j += 2) ctx.fillRect(c[j], c[j + 1], 0.12, 0.12);
    }
    ctx.fillStyle = "#1F5740";
    ctx.fillRect(0, G - 0.4, M, 0.4);
    ctx.fillStyle = "#F2EFE4";
    for (let x = MOUTH + 0.2; x < M - MOUTH; x += 2) {
      ctx.fillRect(x, G - 0.33, 1.6, 0.26);
    }

    ctx.fillStyle = TRUSS;
    ctx.fillRect(0, 0, M, ROOF);
    ctx.fillStyle = TRUSS_DARK;
    ctx.fillRect(0, ROOF - 0.35, M, 0.35);
    ctx.fillRect(0, 0, M, 0.3);
    ctx.strokeStyle = TRUSS_DARK;
    ctx.lineWidth = 0.1;
    ctx.beginPath();
    for (let x = 0; x < M; x += 1.4) {
      ctx.moveTo(x, 0.3);
      ctx.lineTo(x + 0.7, ROOF - 0.35);
      ctx.lineTo(x + 1.4, 0.3);
    }
    ctx.stroke();

    for (let x = 0, i = 0; x < M; x += 0.7, i++) {
      ctx.fillStyle = i % 2 ? "#5FAE4E" : "#54A044";
      ctx.fillRect(x, G, 0.7, M - G);
    }
    ctx.fillStyle = WHITE;
    ctx.fillRect(0, G, M, 0.05);

    // A shadow shrinks and fades as what casts it rises.
    for (const b of [ball.body, you.torso, bot.torso]) {
      const k = 1 / (1 + Math.max(0, G - b.y) * 0.4);
      ctx.fillStyle = `rgba(0,0,0,${0.25 * k})`;
      ctx.beginPath();
      ctx.ellipse(b.x, G + 0.05, 0.4 * k + 0.1, 0.07, 0, 0, 2 * Math.PI);
      ctx.fill();
    }
  }
}

// Net, post and crossbar go over the players and the ball, so a goal goes
// behind the post into the net.
class Goal extends ent.Entity {
  constructor() {
    super();
    this.scale = PPM;
  }

  render(ctx) {
    // The net: a light fill from the wall to the post under the bar, and a mesh.
    ctx.lineWidth = 0.025;
    for (const x0 of [0, M - MOUTH]) {
      ctx.fillStyle = "rgba(255,255,255,0.3)";
      ctx.fillRect(x0, BAR, MOUTH, G - BAR);
      ctx.strokeStyle = "rgba(255,255,255,0.8)";
      ctx.beginPath();
      for (let t = 0.16; t < MOUTH; t += 0.16) {
        ctx.moveTo(x0 + t, BAR);
        ctx.lineTo(x0 + t, G);
      }
      for (let t = BAR + 0.16; t < G; t += 0.16) {
        ctx.moveTo(x0, t);
        ctx.lineTo(x0 + MOUTH, t);
      }
      ctx.stroke();
    }

    ctx.strokeStyle = WHITE;
    ctx.lineWidth = 0.12;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const s of [-1, 1]) {
      const post = s < 0 ? MOUTH : M - MOUTH;
      ctx.beginPath();
      ctx.moveTo(post, G);
      ctx.lineTo(post, BAR + 0.05);
      ctx.lineTo(s < 0 ? 0 : M, BAR + 0.05);
      ctx.stroke();
    }
  }
}

class Player extends ent.Entity {
  constructor(x, group, side, kit) {
    super();
    this.scale = PPM;
    this.side = side;
    this.kit = kit;

    Object.assign(this, ragdoll(world, x, group));
  }

  // Back on its spot, still.
  reset() {
    for (const [body, x, y] of this.pose) {
      body.moveTo(x, y, 0);
      body.velocity(0, 0);
      body.spin = 0;
    }
  }

  step() {
    brace(this);
  }

  throwAt(a, power) {
    this.torso.impulse(Math.cos(a) * power, Math.sin(a) * power);
  }

  // The parts are drawn a little off the physics: a torso 0.54 by 0.66 over a
  // 0.42 by 0.54 box, and limbs 0.16 wide over 0.18. The boot sticks out
  // forward, the way the face looks, which is toward the other goal.
  render(ctx) {
    const k = this.kit;
    const f = -this.side;
    const [armL, armR, legL, legR] = this.limbs;
    const rr = (x, y, w, h, r) => () => ctx.roundRect(x, y, w, h, r);
    const legPath = (l) => rr(-0.08, -l.len / 2, 0.16, l.len, 0.03);
    const bootPath = (l) =>
      rr(f < 0 ? -0.18 : -0.09, l.len / 2 - 0.09, 0.27, 0.11, 0.045);
    const armPath = (a) => rr(-0.075, -a.len / 2, 0.15, a.len, 0.075);
    const torsoPath = rr(-0.27, -0.33, 0.54, 0.66, 0.12);
    const headPath = () => ctx.arc(0, 0, 0.21, 0, 2 * Math.PI);
    const hairPath = k.cut === "afro"
      ? () => ctx.arc(-f * 0.03, -0.07, 0.27, 0, 2 * Math.PI)
      : k.cut === "long"
      ? rr(f > 0 ? -0.22 : 0.02, -0.12, 0.2, 0.34, 0.08)
      : null;

    for (const l of [legL, legR]) {
      silhouette(ctx, l, legPath(l));
      silhouette(ctx, l, bootPath(l));
    }
    silhouette(ctx, armL, armPath(armL));
    silhouette(ctx, armR, armPath(armR));
    silhouette(ctx, this.torso, torsoPath);
    if (hairPath) silhouette(ctx, this.head, hairPath);
    silhouette(ctx, this.head, headPath);

    for (const l of [legL, legR]) {
      const h = l.len;
      part(ctx, l, legPath(l), () => {
        fill(ctx, k.skin);
        ctx.fillStyle = k.socks;
        ctx.fillRect(-0.1, -h / 2 + h * 0.3, 0.2, h);
        ctx.fillStyle = k.trim;
        ctx.fillRect(-0.1, -h / 2 + h * 0.3, 0.2, 0.035);
      }, k.edge);
      part(ctx, l, bootPath(l), () => fill(ctx, k.boots), OUTLINE);
    }

    // A sleeve down to 40% of the arm, and skin below it.
    const arm = (a) =>
      part(ctx, a, armPath(a), () => {
        fill(ctx, k.skin);
        ctx.fillStyle = k.shirt;
        ctx.fillRect(-0.1, -a.len / 2, 0.2, a.len * 0.4);
      }, k.skinEdge);

    arm(armL);
    part(ctx, this.torso, torsoPath, () => {
      fill(ctx, k.shirt);
      ctx.fillStyle = k.pat;
      ctx.beginPath();
      if (k.pattern === "stripes") {
        for (let x = -0.24; x < 0.3; x += 0.16) ctx.rect(x, -0.4, 0.07, 0.55);
      } else if (k.pattern === "hoops") {
        for (let y = -0.3; y < 0.1; y += 0.13) ctx.rect(-0.3, y, 0.6, 0.065);
      } else if (k.pattern === "sash") {
        ctx.moveTo(-0.3, -0.24);
        ctx.lineTo(-0.18, -0.36);
        ctx.lineTo(0.3, 0);
        ctx.lineTo(0.3, 0.14);
      } else if (k.pattern === "chevron") {
        ctx.moveTo(-0.3, -0.22);
        ctx.lineTo(0, -0.04);
        ctx.lineTo(0.3, -0.22);
        ctx.lineTo(0.3, -0.1);
        ctx.lineTo(0, 0.08);
        ctx.lineTo(-0.3, -0.1);
      }
      ctx.fill();
      ctx.fillStyle = k.shorts;
      ctx.fillRect(-0.3, 0.1, 0.6, 0.3);
      ctx.fillStyle = k.trim === k.shorts ? k.shirt : k.trim;
      ctx.fillRect(f > 0 ? -0.27 : 0.23, 0.1, 0.04, 0.3);
    }, k.edge);
    arm(armR);

    if (hairPath) {
      part(ctx, this.head, hairPath, () => fill(ctx, k.hair), k.hairEdge);
    }
    part(ctx, this.head, headPath, () => {
      fill(ctx, k.skin);
      ctx.fillStyle = k.hair;
      const back = f > 0 ? -0.25 : 0.1;
      if (k.cut === "buzz") {
        ctx.fillRect(-0.25, -0.25, 0.5, 0.1);
        ctx.fillRect(f > 0 ? -0.25 : 0.14, -0.25, 0.11, 0.22);
      } else {
        ctx.fillRect(-0.25, -0.25, 0.5, 0.14);
        ctx.fillRect(back, -0.25, 0.15, 0.3);
      }
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.arc(f * 0.11, -0.01, 0.035, 0, 2 * Math.PI);
      ctx.fill();
      ctx.fillRect(f * 0.11 - 0.05, -0.08, 0.1, 0.022);
    }, k.skinEdge);
  }
}

const AHEAD = 60; // physics steps, one second, the most the planner plays ahead
const SOON = 15; // physics steps, a quarter second, the least it plays ahead
const BUDGET = 100; // milliseconds a frame the planner may spend
const STAY = 0.05; // what no throw is worth over a throw that leaves the ball as good
const CHASE = 0.5; // what ending a pitch length nearer behind the ball is worth
const BEHIND = 0.6; // metres behind the ball, toward its own goal, it goes for
const SIDE = 0.1; // ending on its own goal's side of the ball; over STAY, so it pays to get there

// The planner takes down where every body is, plays out each throw it could
// make from there in a second world, with the other player left to coast, and
// makes the one that leaves the ball best for it. It plays each out until its
// next throw could come, and a second at most, since past that its own next
// throw makes the rest wrong, and a quarter second at least, however soon that
// next throw comes. The second world steps exactly as the game's does. A plan
// runs over several frames, so it plans from where things will be `lead`
// physics steps on, two more than its last plan took, and throws on that step.
// A plan that runs past it throws late, and the next one leads by more. It
// plays either side.
//
// Its parameters, which `brain` overrides:
//   every   seconds between plans
//   tries   directions to try, centred on the ball's
//   spread  degrees the directions cover
//   powers  impulses to try in each direction
//   err     random aim error, up to this many degrees either way
// One direction and one impulse is thrown without playing anything out.
class Planner extends Player {
  // The first opponent plans every second and a half and throws up to 30
  // degrees off; the seventh plans four times a second and throws true.
  reset(match) {
    super.reset();
    const f = (match - 1) / (MATCHES - 1);
    Object.assign(this, {
      every: 1.5 - 1.25 * f,
      tries: 16,
      spread: 360,
      powers: [5, 10],
      err: 30 * (1 - f),
    }, this.brain);
    console.log(
      "planner",
      this.every,
      this.tries,
      this.spread,
      this.powers,
      this.err,
    );
    this.wait = this.every;
    this.moves = null;
    this.aim = null;
    this.lead ??= 4;
    if (this.copies) return;

    // Built in the order and on the spots the game builds its own, so each body
    // and joint gets the same id and the solver takes them in the same order.
    const sim = new World({ gravity: { x: 0, y: 8 } });
    this.sim = sim;
    arena(sim);
    const foe = this === bot ? you : bot;
    this.ball = ballBody(sim);
    const copy = (p) => ({
      ...ragdoll(sim, p.pose[0][1], p.torso.data),
      side: p.side,
    });
    const first = copy(you);
    const second = copy(bot);
    this.me = this === you ? first : second;
    this.them = this === you ? second : first;
    this.copies = [
      [ball.body, this.ball],
      ...this.pose.map(([b], i) => [b, this.me.pose[i][0]]),
      ...foe.pose.map(([b], i) => [b, this.them.pose[i][0]]),
    ];
  }

  update() {
    if (cup.state !== "play") return;
    this.wait -= ent.game.time;
    if (this.wait > 0) return;
    if (this.moves === null) this.look();

    const { moves } = this;
    const end = performance.now() + BUDGET;
    while (this.next < moves.length && performance.now() < end) {
      const move = moves[this.next++];
      const v = this.play(move);
      this.tried.push([move, v]);
      if (v <= this.top) continue;
      this.top = v;
      this.best = move;
    }
    if (this.next < moves.length) return;
    if (this.at > this.from) {
      this.lead = Math.max(this.lead - 1, ticks - this.from + 2);
    }

    this.moves = null;
    this.wait = this.every;
    this.aim = null;
    if (this.best !== null) {
      const [a, power] = this.best;
      this.aim = [a + random.randFloat(-this.err, this.err) * DEG, power];
    }
    this.shown = { ...this.origin, to: this.to, tried: this.tried, aim: this.aim };
    if (debug) paused = true;
  }

  // Called before each physics step. The chosen throw goes on the step the plan
  // was made for. A plan that took longer than `lead` throws late, on the first
  // step it can.
  fire() {
    if (this.aim === null || ticks < this.at) return;
    this.throwAt(...this.aim);
    this.aim = null;
  }

  // Where everything will be once the plan is done, and the throws to try
  // from there.
  look() {
    const only = this.tries * this.powers.length === 1;
    this.seen = this.copies.map(([b]) => [b.x, b.y, b.angle, b.vx, b.vy, b.spin]);
    this.from = ticks;
    this.at = only ? ticks : ticks + this.lead;
    this.set();
    for (let k = ticks; k < this.at; k++) this.advance();
    this.seen = this.copies.map(([, b]) => [b.x, b.y, b.angle, b.vx, b.vy, b.spin]);

    const t = this.me.torso;
    const b = this.ball;
    const to = (t.x - b.x) * this.side > 0
      ? { x: b.x + b.vx / 4, y: b.y + b.vy / 4 }
      : { x: b.x, y: b.y - 3 };
    const at = Math.atan2(to.y - t.y, to.x - t.x);
    this.origin = { x: t.x, y: t.y };
    this.to = to;
    this.tried = [];
    const half = Math.floor(this.tries / 2);
    this.moves = [null];
    for (let i = 0; i < this.tries; i++) {
      for (const power of this.powers) {
        this.moves.push([at + this.spread * DEG * (i - half) / this.tries, power]);
      }
    }
    this.top = -Infinity;
    this.best = only ? this.moves[1] : null;
    this.next = only ? this.moves.length : 0;
  }

  // How good the ball is for this side, as far on as it looks, after `move`
  // from what it saw, where a null move is no throw: a goal is worth 100 less
  // the steps it took, an own goal as much below zero, and otherwise it is
  // worth() of where the ball is a third of a second on. If that third of a
  // second crosses a crossbar, a ball coming down stops on top of it, and one
  // going up stays where it is. Less CHASE for how far its torso ends from
  // BEHIND the ball on its own goal's side, so a ball out of reach for now is
  // still worth going after, and one it is on the wrong side of is worth going
  // round, and SIDE more if the torso ends between the ball and its own goal.
  // No throw gets STAY on top.
  play(move) {
    this.set();
    if (move !== null) {
      const [a, power] = move;
      this.me.torso.impulse(Math.cos(a) * power, Math.sin(a) * power);
    }
    const s = this.side;
    const b = this.ball;
    const score = (v) => (move === null ? v + STAY : v);
    const ahead = clamp(Math.floor(this.every * 60) + this.lead, SOON, AHEAD);
    for (let k = 0; k < ahead; k++) {
      this.advance();
      if (b.y <= BAR) continue;
      if (b.x < LINE) return score(s * (100 - k));
      if (b.x > M - LINE) return score(-s * (100 - k));
    }
    let x = clamp(b.x + b.vx / 3, 0, M);
    let y = clamp(b.y + b.vy / 3, ROOF, G);
    if ((b.y > BAR) !== (y > BAR)) {
      const cross = b.x + (x - b.x) * (BAR - b.y) / (y - b.y);
      if (cross < EDGE || cross > M - EDGE) {
        [x, y] = y > BAR ? [cross, BAR - 0.24] : [b.x, b.y];
      }
    }
    const t = this.me.torso;
    const near = Math.hypot(t.x - b.x - s * BEHIND, t.y - b.y) / M;
    const side = s * (t.x - b.x) > 0 ? SIDE : 0;
    return score(worth(x, y, s) - CHASE * near + side);
  }

  // With debug on, the last plan, from where the torso was going to be when it
  // threw: a faint line per throw tried, as long as its impulse over five, and
  // a dot at its end, red for the worst through green for the best by rank, so
  // the powers in one direction show as dots along one line; a ring for no
  // throw, a cross
  // on the point the directions centre on, and the throw made, error and all,
  // in white.
  render(ctx) {
    super.render(ctx);
    if (!debug || !this.shown) return;
    const { x, y, to, tried, aim } = this.shown;
    const order = tried.map(([, v]) => v).sort((a, b) => a - b);
    ctx.lineCap = "round";
    ctx.lineWidth = 0.04;
    const ray = ([a, power]) => {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * power / 5, y + Math.sin(a) * power / 5);
      ctx.stroke();
    };
    for (const [move, v] of tried) {
      const r = order.length > 1 ? order.indexOf(v) / (order.length - 1) : 1;
      ctx.strokeStyle = `hsl(${120 * r},90%,45%)`;
      if (move !== null) {
        const [a, power] = move;
        ctx.globalAlpha = 0.3;
        ray(move);
        ctx.globalAlpha = 1;
        ctx.fillStyle = ctx.strokeStyle;
        ctx.beginPath();
        ctx.arc(
          x + Math.cos(a) * power / 5,
          y + Math.sin(a) * power / 5,
          0.1,
          0,
          2 * Math.PI,
        );
        ctx.fill();
        continue;
      }
      ctx.beginPath();
      ctx.arc(x, y, 0.3, 0, 2 * Math.PI);
      ctx.stroke();
    }
    ctx.strokeStyle = WHITE;
    ctx.beginPath();
    ctx.moveTo(to.x - 0.15, to.y - 0.15);
    ctx.lineTo(to.x + 0.15, to.y + 0.15);
    ctx.moveTo(to.x + 0.15, to.y - 0.15);
    ctx.lineTo(to.x - 0.15, to.y + 0.15);
    ctx.stroke();
    if (aim === null) return;
    ctx.lineWidth = 0.08;
    ray(aim);
  }

  // The second world back on what the planner saw.
  set() {
    this.copies.forEach(([, to], i) => {
      const [x, y, angle, vx, vy, spin] = this.seen[i];
      to.moveTo(x, y, angle);
      to.velocity(vx, vy);
      to.spin = spin;
      to.awake = true;
    });
  }

  // One physics step of the second world, as the game steps its own.
  advance() {
    brace(this.me);
    brace(this.them);
    this.sim.step(1 / 60);
  }
}

// `body` is the ball's, and the entity follows it.
class Ball extends ent.Entity {
  constructor() {
    super();
    this.scale = PPM;
    this.body = ballBody(world);
    this.update();
  }

  // Up in the middle, and sent off upward at a random tilt.
  reset() {
    const b = this.body;
    b.moveTo(CX, SPOT, 0);
    b.velocity(0, 0);
    b.spin = 0;
    const a = random.randFloat(235, 305) * DEG;
    b.impulse(Math.cos(a) * 1.2, Math.sin(a) * 1.2);
  }

  update() {
    this.pos.x = this.body.x * PPM;
    this.pos.y = this.body.y * PPM;
    this.angle = this.body.angle;
  }

  // A pentagon in the middle and five patches cut off by the rim.
  render(ctx) {
    const r = 0.24;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, 2 * Math.PI);
    ctx.fillStyle = BALL;
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = BALL_DARK;
    const penta = (cx, cy, size, turn) => {
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const a = turn + i * 2 * Math.PI / 5;
        ctx.lineTo(cx + Math.cos(a) * size, cy + Math.sin(a) * size);
      }
      ctx.fill();
    };
    penta(0, 0, 0.09, -Math.PI / 2);
    for (let i = 0; i < 5; i++) {
      const a = Math.PI / 2 + i * 2 * Math.PI / 5;
      penta(Math.cos(a) * 0.27, Math.sin(a) * 0.27, 0.09, a);
    }
    ctx.restore();
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, 2 * Math.PI);
    ctx.strokeStyle = BALL_DARK;
    ctx.lineWidth = r / 4;
    ctx.stroke();
  }
}

// Press, drag and let go. `from` is where the press was, in metres, and null
// between drags; the arrow is drawn from the torso it would throw.
class Aim extends ent.Entity {
  constructor() {
    super();
    this.scale = PPM;
    this.from = null;
    this.v = null;
  }

  update() {
    const { input } = ent.game;
    const at = { x: input.x / PPM, y: input.y / PPM };
    if (input.just.act) this.from = at;
    this.v = this.from === null || cup.state !== "play"
      ? null
      : { x: at.x - this.from.x, y: at.y - this.from.y };
    if (!input.release.act) return;
    this.from = null;
    if (cup.state !== "play") return;

    const t = you.torso;
    const len = this.v === null ? 0 : Math.hypot(this.v.x, this.v.y);
    if (len > TAP) {
      you.throwAt(Math.atan2(this.v.y, this.v.x), Math.min(len, REACH) * KICK);
    } else {
      // A tap throws the torso at the point tapped, as hard as it is far.
      const d = Math.min(Math.hypot(at.x - t.x, at.y - t.y), REACH);
      you.throwAt(Math.atan2(at.y - t.y, at.x - t.x), d * KICK);
    }
    this.v = null;
    play.whoosh();
  }

  render(ctx) {
    const v = this.v;
    if (v === null) return;
    const len = Math.hypot(v.x, v.y);
    if (len < 0.05) return;
    const f = Math.min(len, REACH) / len;
    const ux = v.x / len;
    const uy = v.y / len;
    const t = you.torso;
    const to = { x: t.x + v.x * f, y: t.y + v.y * f };

    ctx.strokeStyle = INK;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 0.22;
    ctx.beginPath();
    ctx.moveTo(t.x + ux * 0.5, t.y + uy * 0.5);
    ctx.lineTo(to.x, to.y);
    // The head shrinks on a drag shorter than 1.2 m, so it stays in front of the torso.
    const h = Math.min(1, (len * f) / 1.2);
    for (const s of [-1, 1]) {
      ctx.moveTo(
        to.x - (ux * 0.6 + uy * 0.45 * s) * h,
        to.y - (uy * 0.6 - ux * 0.45 * s) * h,
      );
      ctx.lineTo(to.x, to.y);
    }
    ctx.stroke();
  }
}

const AUTO = 2;

// The run of matches: the clock, the goals, and the scoreboard in the stand.
// `state` is "play", "goal" or "end", and `wait` the real seconds left of the
// slow motion after a goal or the whistle. Past it, a release resumes, or
// another AUTO seconds do.
class Cup extends ent.Entity {
  constructor() {
    super();
    this.match = 1;
    this.newMatch();
  }

  newMatch() {
    this.goals = [0, 0]; // yours, theirs
    this.minute = 0;
    this.clock = 0;
    this.stoppage = random.randFloat(0, 5);
    bot.kit = OPPONENTS[this.match - 1];
    this.kickoff();
  }

  kickoff() {
    this.state = "play";
    you.reset(MATCHES);
    bot.reset(MATCHES); // testing: every match plays the seventh opponent
    ball.reset();
  }

  get over() {
    return this.minute > 90 + this.stoppage;
  }

  update() {
    const dt = ent.game.time;
    if (this.state !== "play") {
      this.wait -= dt;
      const click = this.wait <= 0 && ent.game.input.release.act;
      if (click || this.wait <= -AUTO) this.resume();
      return;
    }

    this.clock += dt;
    if (this.clock >= MINUTE) {
      this.clock -= MINUTE;
      this.minute += 1;
    }

    const b = ball.body;
    if (b.y > BAR && b.x < LINE) this.scored(-1);
    else if (b.y > BAR && b.x > M - LINE) this.scored(1);
    else if (this.over && this.goals[0] !== this.goals[1]) this.whistle();
  }

  scored(side) {
    const b = ball.body;
    this.goals[side > 0 ? 0 : 1] += 1;
    this.state = "goal";
    this.wait = 1;
    b.velocity(b.vx / 2, b.vy / 2);
    shake(0.6);
    new ent.Particle({
      x: b.x * PPM,
      y: b.y * PPM,
      color: parseInt((side > 0 ? YOU : bot.kit).shirt.slice(1), 16),
      count: 44,
      size: [8, 5],
      speed: [280, 180],
      duration: [0.6, 0.2],
    });
    if (side > 0) {
      ent.addScore(1, b.x * PPM, (b.y - 0.8) * PPM);
      play.win();
    } else {
      play.lose();
    }
  }

  whistle() {
    this.state = "end";
    this.wait = 2;
    play.alarm();
    msg(this.goals[0] > this.goals[1] ? "YOU WIN" : "FULL TIME", { hold: 2 });
  }

  // What a release does once the slow motion is over.
  resume() {
    if (this.state === "goal") {
      if (this.over) this.whistle();
      else this.kickoff();
      return;
    }
    if (this.goals[0] < this.goals[1]) {
      gameOver({ score: true, msg: "KNOCKED OUT" });
      return;
    }
    if (this.match >= MATCHES) {
      gameOver({ score: true, win: true });
      return;
    }
    this.match += 1;
    this.newMatch();
  }

  // A panel hung from the truss, with each side's shirt colour under its
  // goals. Past full time with the score level, the clock blinks: the next
  // goal wins.
  render(ctx) {
    const [mine, theirs] = this.goals;
    ctx.strokeStyle = "#2A3036";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(360, 20);
    ctx.lineTo(360, 110);
    ctx.moveTo(664, 20);
    ctx.lineTo(664, 110);
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.roundRect(302, 100, 420, 150, 10);
    ctx.fill();
    ctx.fillStyle = YOU.shirt;
    ctx.fillRect(302, 222, 210, 28);
    ctx.fillStyle = bot.kit.shirt;
    ctx.fillRect(512, 222, 210, 28);

    ctx.fillStyle = WHITE;
    ctx.text(`${mine}`, 400, 166, 90);
    ctx.text(`${theirs}`, 624, 166, 90);
    const golden = this.over && mine === theirs;
    if (!golden || this.minute % 2 === 0) {
      ctx.text(`${this.minute}'`, 512, 166, 40);
    }
    ctx.fillStyle = "#9AA6B0";
    ctx.text(`MATCH ${this.match}/${MATCHES}`, 512, 120, 22, {
      weight: "normal",
    });
  }
}

export function init() {
  const q = new URLSearchParams(location.search);
  const p1 = q.get("p1");
  const p2 = q.get("p2");
  debug = q.get("debug") === "true";
  paused = false;
  for (const p of ent.get(Planner)) p.sim.destroy();
  world?.destroy();
  world = new World({ gravity: { x: 0, y: 8 } });
  ticks = 0;

  ent.reset([Pitch, Planner, Player, Aim, Ball, Goal, Cup]);

  // Aim's update comes before Cup's, so the release that ends the slow motion
  // is not also a throw.
  new Pitch();
  ball = new Ball();
  const brain = (p) => {
    const [every, tries, spread, powers, err] = p.split(":");
    const out = { err: 0 };
    if (every) out.every = Number(every);
    if (tries) out.tries = Number(tries);
    if (spread) out.spread = Number(spread);
    if (powers) out.powers = powers.split("/").map(Number);
    if (err) out.err = Number(err);
    return out;
  };
  you = new (p1 === null ? Player : Planner)(2, -3, -1, YOU);
  bot = new Planner(12, -4, 1, OPPONENTS[0]);
  if (p1 !== null) you.brain = brain(p1);
  if (p2 !== null) bot.brain = brain(p2);
  if (p1 === null) new Aim();
  new Goal();
  cup = new Cup();
}

export function update(dt) {
  if (paused) {
    if (!ent.game.input.just.right) return;
    paused = false;
  }
  const planners = [you, bot].filter((p) => p instanceof Planner);
  const scale = cup.state === "play" ? 1 : SLOW;
  let hard = false;
  fixed(60, (h) => {
    if (cup.state === "play") { for (const p of planners) p.fire(); }
    if (cup.state === "play") ticks += 1;
    you.step();
    bot.step();
    world.step(h * scale);
    for (const c of world.began) {
      const a = c.a.body.data;
      const b = c.b.body.data;
      if (a === null || b === null || a === b) continue;
      const v = Math.max(
        Math.hypot(you.torso.vx, you.torso.vy),
        Math.hypot(bot.torso.vx, bot.torso.vy),
      );
      if (v > 5) hard = true;
    }
  });
  if (hard) shake(0.3);

  ent.update(dt);
}
