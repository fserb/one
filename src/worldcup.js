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
 * a cup run of seven matches: a win is the next opponent, one step harder, and
 * a loss ends the run. The score is the goals you scored across it.
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
  bg: "#1F5740",
  fg: "#F2EFE4",
  scoreMax: true,
  date: "2026-09-21",
};

const M = 14;
const PPM = 1024 / M;
const CX = M / 2;
const G = 11.4; // the grass
const ROOF = G - 6.6;
const DEG = Math.PI / 180;

const GRASS = "#3C8A5C";
const GRASS_DARK = "#2E6E48";
const STAND = "#194A36";
const WHITE = "#F2EFE4";
const YOU = "#F2C14E";
const YOU_DARK = "#B98A17";
const BOT = "#D1495B";
const BOT_DARK = "#8B2E3C";
const BALL = "#F6F2E7";
const BALL_DARK = "#2A3B2F";

const BAR = G - 2.8; // the crossbar's top; the goal has no post to hit
const MOUTH = 1; // the crossbar's length out from the wall
const LINE = 0.72; // a ball centre past this, from the wall, is in
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

const RIGHT = 5;
const DAMP = 0.6;

let world;
let ball;
let you;
let bot;
let cup;

function disc(ctx, at, r, fill, edge = null) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(at.x, at.y, r, 0, 2 * Math.PI);
  ctx.fill();
  if (edge === null) return;
  ctx.strokeStyle = edge;
  ctx.lineWidth = r / 4;
  ctx.stroke();
}

// A rounded box in a body's own frame, centred on it.
function block(ctx, body, w, h, r, fill, edge) {
  ctx.save();
  ctx.translate(body.x, body.y);
  ctx.rotate(body.angle);
  ctx.beginPath();
  ctx.roundRect(-w / 2, -h / 2, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = edge;
  ctx.lineWidth = 0.05;
  ctx.stroke();
  ctx.restore();
}

// The stand, the grass, the halfway line and the two nets.
class Pitch extends ent.Entity {
  constructor() {
    super();
    this.scale = PPM;

    const solid = { friction: 0.9, restitution: 0.9, filter: { category: SOLID } };
    world.box({ x: CX, y: G + 1, w: M + 2, h: 2, ...solid });
    world.box({ x: -1, y: G - 4, w: 2, h: 10, ...solid });
    world.box({ x: M + 1, y: G - 4, w: 2, h: 10, ...solid });
    world.box({ x: CX, y: ROOF - 1, w: M + 2, h: 2, ...solid });
    for (const x of [MOUTH / 2, M - MOUTH / 2]) {
      world.box({
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

  render(ctx) {
    ctx.fillStyle = STAND;
    ctx.fillRect(0, 0, M, ROOF);
    ctx.fillStyle = GRASS;
    ctx.fillRect(0, G, M, M - G);
    ctx.fillStyle = GRASS_DARK;
    ctx.fillRect(0, G, M, 0.12);

    ctx.strokeStyle = GRASS;
    ctx.lineWidth = 0.1;
    ctx.beginPath();
    ctx.moveTo(CX, ROOF);
    ctx.lineTo(CX, G);
    ctx.stroke();

    // The net: a light fill from the wall to the post under the bar, and a mesh.
    ctx.lineWidth = 0.025;
    for (const x0 of [0, M - MOUTH]) {
      ctx.fillStyle = "rgba(242,239,228,0.12)";
      ctx.fillRect(x0, BAR, MOUTH, G - BAR);
      ctx.strokeStyle = "rgba(242,239,228,0.4)";
      ctx.beginPath();
      for (let t = 0.2; t < MOUTH; t += 0.2) {
        ctx.moveTo(x0 + t, BAR);
        ctx.lineTo(x0 + t, G);
      }
      for (let t = BAR + 0.2; t < G; t += 0.2) {
        ctx.moveTo(x0, t);
        ctx.lineTo(x0 + MOUTH, t);
      }
      ctx.stroke();
    }
  }
}

// Post and crossbar go over the players and the ball, so a goal goes behind
// the post into the net.
class Goal extends ent.Entity {
  constructor() {
    super();
    this.scale = PPM;
  }

  render(ctx) {
    ctx.strokeStyle = WHITE;
    ctx.lineWidth = 0.14;
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

// Sizes are the original's: a torso as wide as it is tall, a head nearly as
// wide, arms that hang to the hip and short legs. Its legs hang just under the
// torso and hit it past about 35 degrees, so they stand stiff and wide; that is
// what keeps a player on its feet, and the leg limit here stands in for it.
class Player extends ent.Entity {
  constructor(x, group, side, fill, edge) {
    super();
    this.scale = PPM;
    this.side = side;
    this.fill = fill;
    this.edge = edge;

    const part = (x, y) =>
      world.body({ x, y, type: "dynamic", spinDamping: 0.01, data: group });
    const y = G - 0.3 - 0.33;
    const shape = {
      density: 1,
      friction: 0.5,
      restitution: 0.2,
      filter: { group, category: PLAYER, mask: PLAYER | BALLC | SOLID },
    };
    this.torso = part(x, y);
    this.torso.box({ w: 0.42, h: 0.54, radius: 0.06, ...shape });

    this.head = part(x, y - 0.52);
    this.head.circle({ r: 0.21, ...shape });
    world.revolute(this.torso, this.head, {
      x,
      y: y - 0.33,
      lower: -50 * DEG,
      upper: 50 * DEG,
    });

    this.limbs = [];
    this.pose = [[this.torso, x, y], [this.head, x, y - 0.52]];
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
      world.revolute(this.torso, b, {
        x: x + dx,
        y: y + dy,
        lower: -lim * DEG,
        upper: lim * DEG,
      });
      b.len = len;
      this.limbs.push(b);
      this.pose.push([b, x + dx, y + dy + len / 2]);
    }
  }

  // Back on its spot, still.
  reset() {
    for (const [body, x, y] of this.pose) {
      body.moveTo(x, y, 0);
      body.velocity(0, 0);
      body.spin = 0;
    }
  }

  // One physics step. Each side's own goal mouth pushes its own parts out with
  // a newton each, which keeps a player from parking in front of its net. The
  // torque on the torso toward upright is weak enough that a throw still turns
  // the body over in the air.
  step() {
    const x0 = this.side < 0 ? -0.46 : M - 0.94;
    for (const [b] of this.pose) {
      if (b.x < x0 || b.x > x0 + 1.4 || b.y < BAR + 0.14) continue;
      b.push(-this.side, 0);
    }

    const t = this.torso;
    const a = Math.atan2(Math.sin(t.angle), Math.cos(t.angle));
    t.torque(-a * RIGHT - t.spin * DAMP);
  }

  throwAt(a, power) {
    this.torso.impulse(Math.cos(a) * power, Math.sin(a) * power);
  }

  // Shirt, and the darker tone for shorts and the outline.
  render(ctx) {
    const { fill, edge } = this;
    const [armL, armR, legL, legR] = this.limbs;
    for (const l of [legL, legR]) block(ctx, l, 0.18, l.len, 0.05, edge, edge);
    block(ctx, armL, 0.17, armL.len, 0.08, fill, edge);
    block(ctx, this.torso, 0.54, 0.66, 0.14, fill, edge);
    block(ctx, armR, 0.17, armR.len, 0.08, fill, edge);
    disc(ctx, this.head, 0.21, fill, edge);
    for (const dy of [-0.06, 0.05]) {
      disc(ctx, this.head.toWorld(-this.side * 0.1, dy), 0.04, BALL_DARK);
    }
  }
}

// The machine plays from the right and only ever goes at the ball. The long
// throw aims where the ball is going, a quarter second ahead; from the wrong
// side of it, it throws at a point three metres above the ball to come down
// behind it. The poke is for when it has come to rest near the ball on its own
// side.
class Bot extends Player {
  reset(match) {
    super.reset();
    this.match = match;
    this.hold = random.randFloat(1.5 / (match * 1.4), 1.5);
    this.far = this.longEvery();
    this.near = this.pokeEvery();
  }

  longEvery() {
    return clamp(3 - this.match / 4 + random.randFloat(-0.5, 0.5), 0.2, 10);
  }

  pokeEvery() {
    return 2 / (this.match * 1.4) + random.randFloat(-0.5, 0.5);
  }

  update() {
    if (cup.state !== "play") return;
    const dt = ent.game.time;
    const t = this.torso;
    const b = ball.body;

    this.hold -= dt;
    this.far -= dt;
    if (this.far <= 0 && this.hold <= 0) {
      this.far = this.longEvery();
      if (t.y > ROOF + 2.5) {
        const power = random.randFloat(6, 10);
        const to = t.x > b.x
          ? { x: b.x + b.vx / 4, y: b.y + b.vy / 4 }
          : { x: b.x, y: b.y - 3 };
        this.throwAt(Math.atan2(to.y - t.y, to.x - t.x), power);
      }
    }

    this.near -= dt;
    if (this.near > 0) return;
    this.near = this.pokeEvery();
    if (t.x <= b.x) return;
    if (Math.hypot(t.vx, t.vy) >= 1) return;
    if (Math.hypot(t.x - b.x, t.y - b.y) >= 3) return;
    this.throwAt(
      Math.atan2(b.y - 1 - t.y, b.x - t.x),
      random.randFloat(4, 10),
    );
  }
}

// `body` is the ball's, and the entity follows it.
class Ball extends ent.Entity {
  constructor() {
    super();
    this.scale = PPM;
    this.body = world.body({ x: CX, y: SPOT, type: "dynamic", spinDamping: 0.01 });
    this.body.circle({
      r: 0.24,
      density: 1.5,
      friction: 0.9,
      restitution: 0.9,
      filter: { category: BALLC, mask: PLAYER | SOLID },
    });
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

    ctx.strokeStyle = WHITE;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 0.08;
    ctx.beginPath();
    ctx.moveTo(t.x + ux * 0.4, t.y + uy * 0.4);
    ctx.lineTo(to.x, to.y);
    for (const s of [-1, 1]) {
      ctx.moveTo(to.x - ux * 0.3 - uy * 0.2 * s, to.y - uy * 0.3 + ux * 0.2 * s);
      ctx.lineTo(to.x, to.y);
    }
    ctx.stroke();
  }
}

// The run of matches: the clock, the goals, and the scoreboard in the stand.
// `state` is "play", "goal" or "end", and `wait` the real seconds left of the
// slow motion after a goal or the whistle.
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
    this.kickoff();
  }

  kickoff() {
    this.state = "play";
    you.reset();
    bot.reset(this.match);
    ball.reset();
  }

  get over() {
    return this.minute > 90 + this.stoppage;
  }

  update() {
    const dt = ent.game.time;
    if (this.state !== "play") {
      this.wait -= dt;
      if (this.wait <= 0 && ent.game.input.release.act) this.resume();
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
      color: side > 0 ? 0xf2c14e : 0xd1495b,
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

  // Past full time with the score level, the clock blinks: the next goal wins.
  render(ctx) {
    const [mine, theirs] = this.goals;
    ctx.fillStyle = YOU;
    ctx.text(`${mine}`, 380, 200, 120);
    ctx.fillStyle = BOT;
    ctx.text(`${theirs}`, 644, 200, 120);
    ctx.fillStyle = WHITE;
    const golden = this.over && mine === theirs;
    if (!golden || this.minute % 2 === 0) {
      ctx.text(`${this.minute}'`, 512, 200, 56);
    }
    ctx.text(`MATCH ${this.match}/${MATCHES}`, 512, 90, 36);
  }
}

export function init() {
  world?.destroy();
  world = new World({ gravity: { x: 0, y: 8 } });

  ent.reset([Pitch, Bot, Player, Aim, Ball, Goal, Cup]);

  // Aim's update comes before Cup's, so the release that ends the slow motion
  // is not also a throw.
  new Pitch();
  ball = new Ball();
  you = new Player(2, -3, -1, YOU, YOU_DARK);
  bot = new Bot(12, -4, 1, BOT, BOT_DARK);
  new Aim();
  new Goal();
  cup = new Cup();
}

export function update(dt) {
  const scale = cup.state === "play" ? 1 : SLOW;
  let hard = false;
  fixed(60, (h) => {
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
