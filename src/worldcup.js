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
 */

import { clamp } from "./alma/src/utils/extra.js";
import * as random from "./alma/src/random.js";
import { World } from "./alma/src/rigid.js";
import * as ent from "./lib/entity.js";
import { shake } from "./lib/camera.js";
import { fixed, gameOver, input, msg } from "./lib/one.js";
import * as play from "./lib/sounds.js";

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

let world;
let ball;
let you;
let bot;
let match;
let goals; // [yours, theirs] this match
let minute;
let clock;
let stoppage;
let state; // "play", "goal" or "end"
let wait; // real seconds left of the slow motion
let hold; // seconds before the machine's long throw is allowed after a kickoff
let far; // seconds to the machine's next long throw
let near; // seconds to its next poke
let drag;
let aim;

function part(x, y, group) {
  return world.body({ x, y, type: "dynamic", spinDamping: 0.01, data: group });
}

// Sizes are the original's: a torso as wide as it is tall, a head nearly as
// wide, arms that hang to the hip and short legs. Its legs hang just under the
// torso and hit it past about 35 degrees, so they stand stiff and wide; that is
// what keeps a player on its feet, and the leg limit here stands in for it.
function makePlayer(x, group, side) {
  const y = G - 0.3 - 0.33;
  const shape = {
    density: 1,
    friction: 0.5,
    restitution: 0.2,
    filter: { group, category: PLAYER, mask: PLAYER | BALLC | SOLID },
  };
  const torso = part(x, y, group);
  torso.box({ w: 0.42, h: 0.54, radius: 0.06, ...shape });

  const head = part(x, y - 0.52, group);
  head.circle({ r: 0.21, ...shape });
  world.revolute(torso, head, { x, y: y - 0.33, lower: -50 * DEG, upper: 50 * DEG });

  const limbs = [];
  for (
    const [dx, dy, len, lim] of [
      [-0.27, -0.21, 0.54, 90],
      [0.27, -0.21, 0.54, 90],
      [-0.16, 0.33, 0.3, 35],
      [0.16, 0.33, 0.3, 35],
    ]
  ) {
    const b = part(x + dx, y + dy + len / 2, group);
    b.box({ w: 0.18, h: len, ...shape });
    world.revolute(torso, b, {
      x: x + dx,
      y: y + dy,
      lower: -lim * DEG,
      upper: lim * DEG,
    });
    limbs.push({ body: b, len, x: x + dx, y: y + dy + len / 2 });
  }

  const pose = [
    [torso, x, y],
    [head, x, y - 0.52],
    ...limbs.map((l) => [l.body, l.x, l.y]),
  ];
  return { torso, head, limbs, pose, side };
}

const RIGHT = 5;
const DAMP = 0.6;

// A torque on the torso toward upright, weak enough that a throw still turns
// the body over in the air.
function stand(p) {
  const t = p.torso;
  const a = Math.atan2(Math.sin(t.angle), Math.cos(t.angle));
  t.torque(-a * RIGHT - t.spin * DAMP);
}

function throwAt(p, a, power) {
  p.torso.impulse(Math.cos(a) * power, Math.sin(a) * power);
}

// The kickoff: both players on their spots and the ball up in the middle, sent
// off upward at a random tilt.
function kickoff() {
  for (const p of [you, bot]) {
    for (const [body, x, y] of p.pose) {
      body.moveTo(x, y, 0);
      body.velocity(0, 0);
      body.spin = 0;
    }
  }
  ball.moveTo(CX, SPOT, 0);
  ball.velocity(0, 0);
  ball.spin = 0;
  const a = random.randFloat(235, 305) * DEG;
  ball.impulse(Math.cos(a) * 1.2, Math.sin(a) * 1.2);

  const d = match;
  hold = random.randFloat(1.5 / (d * 1.4), 1.5);
  far = longEvery();
  near = pokeEvery();
  state = "play";
}

function newMatch() {
  goals = [0, 0];
  minute = 0;
  clock = 0;
  stoppage = random.randFloat(0, 5);
  kickoff();
}

function longEvery() {
  return clamp(3 - match / 4 + random.randFloat(-0.5, 0.5), 0.2, 10);
}

function pokeEvery() {
  return 2 / (match * 1.4) + random.randFloat(-0.5, 0.5);
}

// The machine plays from the right and only ever goes at the ball. The long
// throw aims where the ball is going, a quarter second ahead; from the wrong
// side of it, it throws at a point three metres above the ball to come down
// behind it. The poke is for when it has come to rest near the ball on its own
// side.
function machine(dt) {
  const t = bot.torso;
  far -= dt;
  if (far <= 0 && hold <= 0) {
    far = longEvery();
    if (t.y > ROOF + 2.5) {
      const power = random.randFloat(6, 10);
      const to = t.x > ball.x
        ? { x: ball.x + ball.vx / 4, y: ball.y + ball.vy / 4 }
        : { x: ball.x, y: ball.y - 3 };
      throwAt(bot, Math.atan2(to.y - t.y, to.x - t.x), power);
    }
  }

  near -= dt;
  if (near > 0) return;
  near = pokeEvery();
  if (t.x <= ball.x) return;
  if (Math.hypot(t.vx, t.vy) >= 1) return;
  if (Math.hypot(t.x - ball.x, t.y - ball.y) >= 3) return;
  throwAt(bot, Math.atan2(ball.y - 1 - t.y, ball.x - t.x), random.randFloat(4, 10));
}

// Each side's own goal mouth pushes its own parts out with a newton each. It is
// what keeps a player from parking in front of its net.
function eject(p) {
  const x0 = p.side < 0 ? -0.46 : M - 0.94;
  for (const [b] of p.pose) {
    if (b.x < x0 || b.x > x0 + 1.4 || b.y < BAR + 0.14) continue;
    b.push(-p.side, 0);
  }
}

function scored(side) {
  goals[side > 0 ? 0 : 1] += 1;
  state = "goal";
  wait = 1;
  ball.velocity(ball.vx / 2, ball.vy / 2);
  shake(0.6);
  new ent.Particle({
    x: ball.x * PPM,
    y: ball.y * PPM,
    color: side > 0 ? 0xf2c14e : 0xd1495b,
    count: 44,
    size: [8, 5],
    speed: [280, 180],
    duration: [0.6, 0.2],
  });
  if (side > 0) {
    ent.addScore(1, ball.x * PPM, (ball.y - 0.8) * PPM);
    play.win();
  } else {
    play.lose();
  }
}

function whistle() {
  state = "end";
  wait = 2;
  play.alarm();
  msg(goals[0] > goals[1] ? "YOU WIN" : "FULL TIME", { hold: 2 });
}

// What a release does once the slow motion is over.
function resume() {
  if (state === "goal") {
    if (minute > 90 + stoppage) whistle();
    else kickoff();
    return;
  }
  if (goals[0] < goals[1]) {
    gameOver({ score: true, msg: "KNOCKED OUT" });
    return;
  }
  if (match >= MATCHES) {
    gameOver({ score: true, win: true });
    return;
  }
  match += 1;
  newMatch();
}

export function init() {
  world?.destroy();
  world = new World({ gravity: { x: 0, y: 8 } });
  ent.reset();

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

  ball = world.body({ x: CX, y: SPOT, type: "dynamic", spinDamping: 0.01 });
  ball.circle({
    r: 0.24,
    density: 1.5,
    friction: 0.9,
    restitution: 0.9,
    filter: { category: BALLC, mask: PLAYER | SOLID },
  });

  you = makePlayer(2, -3, -1);
  bot = makePlayer(12, -4, 1);

  match = 1;
  drag = null;
  aim = null;
  newMatch();
}

export function update(dt) {
  const at = { x: input.x / PPM, y: input.y / PPM };
  if (input.just.act) drag = at;
  if (drag !== null) aim = { x: at.x - drag.x, y: at.y - drag.y };
  if (input.release.act) {
    const len = aim === null ? 0 : Math.hypot(aim.x, aim.y);
    if (state === "play" && len > TAP) {
      throwAt(you, Math.atan2(aim.y, aim.x), Math.min(len, REACH) * KICK);
      play.whoosh();
    } else if (state === "play") {
      // A tap throws the torso at the point tapped, as hard as it is far.
      const t = you.torso;
      const d = Math.min(Math.hypot(at.x - t.x, at.y - t.y), REACH);
      throwAt(you, Math.atan2(at.y - t.y, at.x - t.x), d * KICK);
      play.whoosh();
    } else if (state !== "play" && wait <= 0) {
      resume();
    }
    drag = null;
    aim = null;
  }
  if (state !== "play") aim = null;

  const scale = state === "play" ? 1 : SLOW;
  if (state === "play") {
    hold -= dt;
    machine(dt);
    clock += dt;
    if (clock >= MINUTE) {
      clock -= MINUTE;
      minute += 1;
    }
  } else {
    wait -= dt;
  }

  let hard = false;
  fixed(60, (h) => {
    eject(you);
    eject(bot);
    stand(you);
    stand(bot);
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

  if (state === "play" && ball.y > BAR) {
    if (ball.x < LINE) scored(-1);
    else if (ball.x > M - LINE) scored(1);
  }
  if (
    state !== "end" && minute > 90 + stoppage && goals[0] !== goals[1] &&
    state === "play"
  ) {
    whistle();
  }

  ent.update(dt);
}

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

// A rounded box in a body's own frame, centred on (x, y) of it.
function block(ctx, body, x, y, w, h, r, fill, edge) {
  ctx.save();
  ctx.translate(body.x, body.y);
  ctx.rotate(body.angle);
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - h / 2, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = edge;
  ctx.lineWidth = 0.05;
  ctx.stroke();
  ctx.restore();
}

// Shirt, and the darker tone for shorts and the outline.
function drawPlayer(ctx, p, fill, edge) {
  const [armL, armR, legL, legR] = p.limbs;
  for (const l of [legL, legR]) {
    block(ctx, l.body, 0, 0, 0.18, l.len, 0.05, edge, edge);
  }
  block(ctx, armL.body, 0, 0, 0.17, armL.len, 0.08, fill, edge);
  block(ctx, p.torso, 0, 0, 0.54, 0.66, 0.14, fill, edge);
  block(ctx, armR.body, 0, 0, 0.17, armR.len, 0.08, fill, edge);
  disc(ctx, p.head, 0.21, fill, edge);
  for (const dy of [-0.06, 0.05]) {
    disc(ctx, p.head.toWorld(-p.side * 0.1, dy), 0.04, BALL_DARK);
  }
}

// A pentagon in the middle and five patches cut off by the rim, turning with
// the ball.
function drawBall(ctx) {
  const r = 0.24;
  ctx.save();
  ctx.translate(ball.x, ball.y);
  ctx.rotate(ball.angle);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, 2 * Math.PI);
  ctx.fillStyle = BALL;
  ctx.fill();
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
  disc(ctx, ball, r, "rgba(0,0,0,0)", BALL_DARK);
}

// The throw the drag is holding, drawn from the torso it would throw.
function drawAim(ctx, v) {
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

export function render(ctx) {
  ctx.save();
  ctx.scale(PPM, PPM);

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
  for (const s of [-1, 1]) {
    const x0 = s < 0 ? 0 : M - MOUTH;
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

  drawPlayer(ctx, bot, BOT, BOT_DARK);
  drawPlayer(ctx, you, YOU, YOU_DARK);
  if (aim !== null) drawAim(ctx, aim);

  drawBall(ctx);

  // Post and crossbar go over the players and the ball, so a goal goes behind
  // the post into the net.
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

  ctx.restore();

  // The scoreboard in the stand. Past full time with the score level, the
  // clock blinks: the next goal wins.
  ctx.fillStyle = YOU;
  ctx.text(`${goals[0]}`, 380, 200, 120);
  ctx.fillStyle = BOT;
  ctx.text(`${goals[1]}`, 644, 200, 120);
  const golden = minute > 90 + stoppage && goals[0] === goals[1];
  if (!golden || minute % 2 === 0) {
    ctx.fillStyle = WHITE;
    ctx.text(`${minute}'`, 512, 200, 56);
  }
  ctx.fillStyle = WHITE;
  ctx.text(`MATCH ${match}/${MATCHES}`, 512, 90, 36);

  ent.render(ctx);
}
