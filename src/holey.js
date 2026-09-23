/*
 * holey - Holey Hell by Daniel Linssen (Ludum Dare 48), ported from its
 * GameMaker bytecode, constants and all.
 *
 * It runs in the original's units: a 480 board, stepped 60 times a second by
 * fixed(), with speeds in pixels a step, and render() scales that onto 1024.
 * An angle is X * H degrees, where X is the unit a horizontal speed is counted
 * in, and a height is Y, the distance from the middle of the board. Gravity
 * points out, so the floor is the inside of the wall and Y grows downward.
 *
 * A level is a sheet of one colour with a wobbling hole in it. Three are alive
 * at once, each 0.666 the one around it, so the next two levels show through
 * the hole already populated. Everything a level holds is drawn in its colour
 * and, once it is the level being played, fades to white. Four sines at 3, 5,
 * 7 and 11 a turn make the wall, and each one's phase drifts every step, so the
 * floor moves under the player and a jump off a rising stretch goes higher.
 *
 * The key sits at the top and the door at the bottom. Through the door the
 * player is thrown inward, the sheet just left scales out to 5 and is dropped,
 * and the next one grows to 1 and meets them as they come down. Enemies come
 * off a danger budget that grows with depth, from the list of the level's
 * biome, and five hits end the run.
 */

import { fixed, gameOver, input, score } from "./lib/one.js";
import * as play from "./lib/sounds.js";

export const meta = {
  title: "holey",
  bg: "#1F1833",
  fg: "#FFFFFF",
  scoreMax: true,
  date: "2026-09-21",
  dpad: true,
};

const K = 1024 / 480;
const C = 240;
const H = 0.14;
const GRAV = 0.25;
const COUNT = 3;
const SHRINK = 0.666;
const RADIUS = 200;
const OUT = 5;

const DARK = [0x1f, 0x18, 0x33];
const WHITE = [255, 255, 255];

// By level_number: the level being played, the next, the one after.
const COLOURS = {
  forest: [0x51c43f, 0x2d5f72, 0x46275c],
  lava: [0xdb2b3a, 0x852d66, 0x46275c],
  water: [0x3689d7, 0x434c94, 0x46275c],
  desert: [0xffad3b, 0x852d66, 0x46275c],
};

const D2R = Math.PI / 180;
const dsin = (a) => Math.sin(a * D2R);
const dcos = (a) => Math.cos(a * D2R);
const rand = (a, b) => a + (b - a) * Math.random();
const choose = (...a) => a[Math.floor(Math.random() * a.length)];
const chance = (p) => Math.random() < p;

function approach(v, t, d) {
  return v < t ? Math.min(v + d, t) : Math.max(v - d, t);
}

function sqrtApproach(v, t, k) {
  return approach(v, t, Math.sqrt(Math.abs(v - t)) * k);
}

function angleDiff(a, b) {
  return ((((a - b) % 360) + 540) % 360) - 180;
}

function rgb(n) {
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function merge(c, t, k) {
  return c.map((v, i) => v + (t[i] - v) * k);
}

function css(c, a = 1) {
  return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
}

let levels = [];
let gone = []; // levels scaling out after a dive
let dust = [];
let player = null;
let clock = 0;
let completed = 0;
let jumpPressed = false;

// ---------------------------------------------------------------- levels

function wave(lv, a) {
  let v = 0;
  for (const w of lv.waves) v += w.mag * dsin(w.f * a + w.off);
  if (lv.biome === "lava") {
    const b = a - 90;
    if (Math.abs(angleDiff(b, 0)) < 60) v -= (1 + dcos(b * 3)) * 15;
  }
  if (player.shake > 0) v += rand(-player.shake, player.shake);
  return v;
}

function waveSlope(lv, a) {
  let v = 0;
  for (const w of lv.waves) v += w.mag * dcos(w.f * a + w.off) * w.f * D2R;
  if (lv.biome === "lava") {
    const b = a - 90;
    if (Math.abs(angleDiff(b, 0)) < 60) v -= dcos(b * 3) * 45 * D2R;
  }
  return v;
}

function ground(lv, X) {
  return lv.radius + wave(lv, X * H);
}

function slope(lv, X) {
  return Math.atan(waveSlope(lv, X * H) * 0.4) / D2R;
}

function lavaR(lv) {
  return (lv.radius + lv.lava + 2 * dsin(clock * 60)) * lv.scale;
}

function makeLevel(number) {
  const taken = levels.filter(Boolean).map((l) => l.biome);
  const biomes = ["forest", "lava", "water", "desert"].filter((b) =>
    !taken.includes(b)
  );
  const lv = {
    biome: choose(...biomes),
    number,
    colour: DARK,
    scale: 0,
    target: SHRINK ** number,
    radius: RADIUS,
    finishing: false,
    lava: 0,
    lavaColour: DARK,
    things: [],
    waves: [3, 5, 7, 11].map((f, i) => {
      const w = {
        f,
        mag: rand(...[[8, 12], [6, 10], [4, 8], [3, 5]][i]),
        off: rand(0, 360),
        A: rand(-1, 1) / 30,
        B: rand(1, 4),
        C: rand(-10, 10),
      };
      if (chance(0.05)) w.A *= 2;
      if (chance(0.05)) w.B *= 2;
      if (chance(0.05)) w.C *= 2;
      return w;
    }),
  };
  paint(lv);
  generate(lv);
  return lv;
}

function paint(lv) {
  lv.goal = rgb(COLOURS[lv.biome][Math.min(2, lv.number)]);
}

const ENEMIES = {
  forest: ["frog", "spear", "fly"],
  lava: ["ball", "ball"],
  water: ["spike", "spike", "spike", "shooterA", "shooterC", "drill"],
  desert: ["cactus", "cactus", "cannon", "bird"],
};

function generate(lv) {
  let danger = 8 + 2 * completed ** 0.6;
  if (lv.biome === "lava") {
    lv.lava = 20 - danger * 0.333;
    danger *= 0.5;
  }
  if (lv.biome === "forest" && chance(danger / 16) && !player?.dead) {
    danger -= spawn(lv, "chaser").danger;
  }
  while (danger > 0) danger -= spawn(lv, choose(...ENEMIES[lv.biome])).danger;

  const key = thing(lv, "key", { X: (270 + rand(-22, 22)) / H });
  key.wob = rand(0, 360);
  thing(lv, "door", { X: (90 + rand(-5, 5)) / H, open: false, used: false });
  lv.check = 0;
}

function stepLevel(lv) {
  if (lv.scale >= OUT) {
    gone.splice(gone.indexOf(lv), 1);
    return;
  }
  for (const w of lv.waves) w.off += w.A + w.B * dsin(w.C * clock);
  lv.colour = merge(lv.colour, lv.goal, 0.05);
  const rate = Math.min(Math.abs(lv.scale - lv.target) * 0.08, 0.04);
  lv.scale = approach(lv.scale, lv.target, rate);

  if (lv.biome === "lava") {
    lv.lavaColour = lv.number === 0 ? merge(lv.lavaColour, WHITE, 0.1) : lv.colour;
    if (lv === levels[0] && player.Y > lavaR(lv) + 0.5) player.touching = true;
  }

  const door = lv.things.find((t) => t.kind === "door");
  if (lv === levels[0] && !door.open && ++lv.check > 120) {
    lv.check = 0;
    if (!lv.things.some((t) => t.kind === "key")) openDoor(lv);
  }

  for (const t of [...lv.things]) {
    if (t.dead) continue;
    STEP[t.kind]?.(t, lv);
    if (t.danger !== undefined) {
      t.blend = lv.number === 0 ? merge(t.blend, WHITE, 0.1) : lv.colour;
    }
  }
  lv.things = lv.things.filter((t) => !t.dead);
}

function dive() {
  dust = dust.filter((d) => !d.floor);
  for (const lv of levels) {
    lv.things = lv.things.filter((t) => t.kind !== "bullet");
  }
  if (!player.dead) {
    player.ground = false;
    player.h = 0;
    player.v = -6;
    player.fastfall = false;
    player.invulnerable = 60;
    completed += 1;
    score.value = completed;
  }
  const old = levels.shift();
  old.target = OUT;
  old.finishing = true;
  gone.push(old);
  levels.forEach((lv, i) => {
    lv.number = i;
    lv.target = SHRINK ** i;
    paint(lv);
  });
  levels.push(makeLevel(COUNT - 1));
}

function openDoor(lv) {
  const door = lv.things.find((t) => t.kind === "door");
  door.open = true;
  for (let i = 0; i < 8; ++i) floorDust(door.X);
}

// ---------------------------------------------------------------- things

// What a thing is worth against the budget, the circles it is hit by as
// [x, y, r] with y up from its anchor, and whether it sits on the floor.
const KINDS = {
  ball: { danger: 2, hits: [[0, 6, 6]], floor: true },
  frog: { danger: 2, hits: [[0, 6, 7]], floor: true },
  spike: { danger: 1, hits: [[0, 4, 4.5]], floor: true },
  cactus: { danger: 1, hits: [[0, 7, 7], [0, 18, 6], [0, 28, 5]], floor: true },
  spear: { danger: 1, hits: [[0, 4, 4], [0, 12, 4]], floor: true },
  cannon: { danger: 2.5, hits: [[0, 5, 6]], floor: true },
  shooterA: { danger: 1, hits: [[0, 5, 5], [0, 11, 5]] },
  shooterC: { danger: 4, hits: [[0, 0, 11]] },
  drill: { danger: 2.5, hits: [[-5, 0, 6], [-15, 0, 4]] },
  bird: { danger: 2.5, hits: [[-3, 0, 5], [3, 0, 5]] },
  fly: { danger: 0.5, hits: [[0, 0, 5]] },
  chaser: { danger: 4, hits: [[0, 0, 11]] },
  cannonball: { danger: 1, hits: [[0, 0, 5.5]] },
  bullet: { danger: 1, hits: [[0, 0, 4.5]] },
};

function thing(lv, kind, props) {
  const t = { kind, X: 0, Y: 0, h: 0, v: 0, rot: 0, flip: 1, age: 0, ...props };
  const k = KINDS[kind];
  if (k) {
    t.danger = k.danger;
    t.hits = k.hits;
    t.blend = lv.colour;
  }
  lv.things.push(t);
  return t;
}

// An X at least 9 degrees from every other danger on the level, and 15 clear
// of the door either side.
function placeX(lv) {
  let X = 0;
  for (let fail = 500; fail > 0; --fail) {
    X = (105 + rand(0, 330)) / H;
    const a = X * H;
    const near = lv.things.some((o) =>
      o.danger !== undefined && Math.abs(angleDiff(a, o.X * H)) < 9
    );
    if (!near) break;
  }
  return X;
}

function spawn(lv, kind) {
  const t = thing(lv, kind, {});
  if (kind === "chaser") {
    t.xx = C;
    t.yy = C;
    t.a = Math.atan2(player.y - C, player.x - C) / D2R;
    t.as = 0;
    return t;
  }
  t.X = placeX(lv);
  switch (kind) {
    case "ball":
      t.h = choose(-1, 1) * rand(1.5, 3);
      break;
    case "frog":
      t.timer = 30 + rand(0, 120);
      t.ground = true;
      t.gp = 0;
      break;
    case "cactus":
      t.flip = choose(-1, 1);
      t.variant = Math.floor(rand(0, 3));
      break;
    case "spear":
      t.rise = rand(0, 360);
      break;
    case "cannon":
      t.max = Math.round(rand(120, 150));
      t.count = Math.round(rand(0, t.max)) - 60;
      break;
    case "shooterA":
    case "shooterC":
      t.h = choose(-1, 1) * rand(2, 4);
      t.base = Math.round(rand(70, 90));
      t.rate = rand(1.5, 2.5);
      t.rise = rand(0, 360);
      t.Y = t.base + 16 * dsin(t.rise);
      t.max = Math.round(rand(75, 90));
      t.count = Math.round(rand(0, t.max)) - 45;
      break;
    case "drill":
      t.h = choose(-1, 1) * rand(3, 4);
      t.Y = 190 + choose(0, 20);
      break;
    case "bird":
      t.h = choose(-1, 1) * 2.5;
      break;
    case "fly":
      t.c = rand(0, 360);
      t.h = rand(-1, 1);
      t.base = rand(130, 150);
      break;
  }
  if (KINDS[kind].floor) t.Y = ground(lv, t.X);
  place(t, lv);
  return t;
}

// The board position off X and Y, and the turn that stands a thing up on the
// wall; `tilt` leans it by the floor's slope.
function place(t, lv, tilt = 0) {
  const a = t.X * H;
  const r = t.Y * lv.scale;
  t.px = t.x ?? C;
  t.py = t.y ?? C;
  t.x = C + r * dcos(a);
  t.y = C + r * dsin(a);
  t.rot = (a - 90 - tilt) * D2R;
}

function onFloor(t, lv) {
  t.Y = ground(lv, t.X);
  place(t, lv, slope(lv, t.X));
}

function playing(lv) {
  return lv.number === 0 && !lv.finishing;
}

function bullet(lv, x, y, angle, from) {
  const xd = from.x - from.px;
  const yd = from.y - from.py;
  const a = angle + from.h * 8;
  const t = thing(lv, "bullet", {
    xx: C + (x - C) / lv.scale,
    yy: C + (y - C) / lv.scale,
    h: 1.5 * dcos(a) + xd,
    v: 1.5 * dsin(a) + yd,
  });
  for (let i = 0; i < 4; ++i) {
    puff(x, y, lv.colour, xd * 0.666 + rand(-0.4, 0.4), yd * 0.666);
  }
  return t;
}

const STEP = {
  ball(t, lv) {
    t.X += t.h;
    onFloor(t, lv);
  },

  spike: onFloor,
  cactus: onFloor,

  spear(t, lv) {
    t.rise = (t.rise + 3) % 360;
    t.Y = ground(lv, t.X) + 10 * dsin(t.rise);
    place(t, lv, slope(lv, t.X));
  },

  cannon(t, lv) {
    onFloor(t, lv);
    if (playing(lv)) t.count += 1;
    if (t.count <= t.max) return;
    t.count = 0;
    if (playing(lv)) play.shoot({ volume: 0.2, detune: -600 });
    const s = slope(lv, t.X) * 1.7;
    thing(lv, "cannonball", {
      X: t.X + 12 * dsin(s),
      Y: t.Y - 12 * dcos(s),
      h: 4.25 * dsin(s),
      v: -4.25 * dcos(s),
    });
  },

  cannonball(t, lv) {
    const g = ground(lv, t.X);
    t.v = Math.min(3, t.v + GRAV / 3);
    t.X += t.h;
    t.Y += t.v;
    if (t.Y > g && t.v > 0) {
      if (playing(lv)) {
        for (let i = 0; i < 3 + t.v; ++i) floorDust(t.X);
        for (let i = 0; i < 8; ++i) {
          puff(t.x + rand(-4, 4), t.y + rand(-4, 4), levels[0].colour);
        }
        play.step({ volume: 0.3 });
      }
      t.dead = true;
      return;
    }
    place(t, lv);
  },

  frog(t, lv) {
    const g = ground(lv, t.X);
    const s = slope(lv, t.X);
    if (t.ground) {
      t.h = approach(t.h, 0, 0.3);
      if (--t.timer < 0) {
        t.timer = rand(90, 150);
        t.ground = false;
        jump(t, 6.5, s * 1.65 + rand(-10, 10), g - t.gp);
        if (playing(lv)) {
          for (let i = 0; i < 6; ++i) floorDust(t.X);
          play.bounce({ volume: 0.15 });
        }
        t.X += t.h;
        t.Y += t.v;
      } else {
        t.X += t.h;
        t.Y = g;
      }
    } else {
      t.h *= 0.99;
      t.v = Math.min(6, t.v + GRAV);
      t.X += t.h;
      t.Y += t.v;
      if (t.Y > g && t.v > 0) {
        if (playing(lv)) {
          for (let i = 0; i < 3 + t.v; ++i) floorDust(t.X);
          play.step({ volume: 0.2 });
        }
        t.Y = g;
        t.v = 0;
        t.ground = true;
      }
    }
    t.tilt = approach(t.tilt ?? 0, t.ground ? s : 0, t.ground ? 10 : 0.5);
    t.gp = g;
    place(t, lv, t.tilt);
  },

  shooterA(t, lv) {
    if (playing(lv)) t.count += 1;
    if (t.count > t.max) {
      t.count = 0;
      bullet(lv, t.x, t.y, t.X * H, t);
      if (playing(lv)) play.shoot({ volume: 0.15 });
    }
    float(t, lv);
  },

  shooterC(t, lv) {
    float(t, lv);
    if (playing(lv)) t.count += 1;
    if (t.count <= t.max) return;
    t.count = 0;
    if (playing(lv)) play.shoot({ volume: 0.2, detune: -300 });
    for (let i = 0; i < 4; ++i) {
      const a = t.X * H + 90 * i;
      bullet(lv, t.x + 6 * dcos(a), t.y + 6 * dsin(a), a, t);
    }
  },

  drill(t, lv) {
    const g = ground(lv, t.X);
    t.X += t.h;
    t.Y += t.v;
    t.v += t.Y > g ? -GRAV / 4 : GRAV / 4;
    t.v *= 0.995;
    place(t, lv);
    t.rot = Math.atan2(t.py - t.y, t.px - t.x);
    if (!lv.finishing && lv.number === 0 && t.Y < g && chance(0.3)) {
      puff(t.x + rand(-2, 2), t.y + rand(-2, 2), levels[0].colour);
    }
  },

  bird(t, lv) {
    const g = ground(lv, t.X);
    t.X += t.h;
    t.Y = sqrtApproach(t.Y, 163 - (g - lv.radius) * 0.7, 0.5);
    t.Y = Math.min(t.Y, g - 14);
    place(t, lv);
    t.flip = t.h > 0 ? -1 : 1;
  },

  fly(t, lv) {
    t.c = (t.c + 1) % 360;
    t.X += t.h + 2 * dcos(t.c * 2);
    t.Y = t.base + 10 * dsin(t.c * 3);
    place(t, lv);
    t.flip = t.h > 0 ? -1 : 1;
  },

  chaser(t, lv) {
    const target = Math.atan2(player.y - t.yy, player.x - t.xx) / D2R;
    const d = angleDiff(target, t.a);
    const want = 8 * Math.min(1, Math.abs(d / 180)) * Math.sign(d);
    t.as = approach(t.as, want, 0.15);
    t.a = (t.a + t.as) % 360;
    const sp = (8 - Math.abs(t.as)) / 8;
    t.xx += sp * dcos(t.a);
    t.yy += sp * dsin(t.a);
    t.x = C + (t.xx - C) * lv.scale;
    t.y = C + (t.yy - C) * lv.scale;
    t.rot = t.a * D2R;
  },

  bullet(t, lv) {
    t.xx += t.h;
    t.yy += t.v;
    t.X = Math.atan2(t.yy - C, t.xx - C) / D2R / H;
    t.Y = Math.hypot(t.xx - C, t.yy - C);
    if (t.Y > ground(lv, t.X) + 1) {
      if (!lv.finishing && lv.number === 0) {
        for (let i = 0; i < 6; ++i) floorDust(t.X);
        for (let i = 0; i < 4; ++i) puff(t.x, t.y, levels[0].colour);
        play.step({ volume: 0.2 });
      }
      t.dead = true;
      return;
    }
    place(t, lv);
  },

  key(t, lv) {
    t.Y = ground(lv, t.X) - 30;
    place(t, lv);
    t.rot = 30 * dcos(clock * 120 + t.wob) * -D2R;
  },

  door(t, lv) {
    onFloor(t, lv);
  },
};

function float(t, lv) {
  t.rise = (t.rise + t.rate) % 360;
  t.X += t.h;
  t.Y = t.base + 16 * dsin(t.rise);
  place(t, lv);
}

// The shared jump: the force goes off along the floor's slope, and the floor's
// own rise since the last step is added, so a wall coming in throws harder.
function jump(t, force, s, rise) {
  rise = Math.max(-3, Math.min(3, rise));
  t.h = t.h * 0.666 + force * dsin(s);
  t.v = rise * 0.666 - force * dcos(s);
}

// ---------------------------------------------------------------- dust

function puff(x, y, colour, h = rand(-0.4, 0.4), v = rand(-0.4, 0.4)) {
  const life = 9 / rand(0.15, 0.4);
  dust.push({ x, y, h, v, colour, age: 0, life });
}

// Dust that slides along the floor of the level being played.
function floorDust(X) {
  const start = rand(0, 3);
  const life = (9 - start) / rand(0.2, 0.3333);
  dust.push({
    floor: true,
    X,
    h: choose(1, -1) * rand(1, 2),
    colour: levels[0].colour,
    age: start / 9 * life,
    life,
  });
}

function ring(gap, r, x, y) {
  for (let i = 0; i < 360; i += gap) {
    const f = rand(1.5, 2.5);
    puff(
      x + r * dcos(i),
      y + r * dsin(i),
      levels[0].colour,
      f * dcos(i),
      f *
        dsin(i),
    );
  }
}

function stepDust() {
  const lv = levels[0];
  for (const d of dust) {
    d.age += 1;
    if (d.floor) {
      d.X += d.h;
      d.h *= 0.95;
      const r = ground(lv, d.X) * lv.scale;
      d.x = C + r * dcos(d.X * H);
      d.y = C + r * dsin(d.X * H);
    } else {
      d.x += d.h;
      d.y += d.v;
      d.h *= 0.9;
      d.v *= 0.9;
    }
  }
  dust = dust.filter((d) => d.age < d.life);
}

// ---------------------------------------------------------------- player

function newPlayer() {
  return {
    X: 90 / H,
    Y: 0,
    h: 0,
    v: -4,
    x: C,
    y: C,
    ground: false,
    gp: 0,
    fastfall: false,
    prefire: 0,
    invulnerable: 60,
    hp: 5,
    dead: false,
    deadFor: 0,
    tilt: 0,
    face: 1,
    frame: 0,
    walking: false,
    danger: 0,
    touching: false,
    shake: 0,
    flash: 0,
  };
}

function stepPlayer() {
  const p = player;
  const lv = levels[0];
  const left = input.press.left;
  const right = input.press.right;
  const held = input.press.up || input.press.act;
  // Right runs clockwise, which is rightward along the floor at the bottom.
  const dir = (left ? 1 : 0) - (right ? 1 : 0);

  if (p.invulnerable > 0) p.invulnerable -= 1;
  if (p.flash > 0) p.flash -= 1;
  if (p.shake > 0) p.shake = sqrtApproach(p.shake, 0, 0.18);
  if (p.invulnerable <= 0 && p.touching) {
    if (++p.danger > 4) hurt();
  } else if (p.danger > 0) p.danger -= 1;
  p.touching = false;

  const g = ground(lv, p.X);
  const s = slope(lv, p.X);
  p.walking = false;

  if (p.dead) {
    p.deadFor += 1;
    if (p.deadFor === 60) gameOver({ score: true });
    p.v = Math.min(4, p.v + GRAV);
    p.X += p.h;
    p.Y += p.v;
    p.tilt -= 12;
  } else if (p.ground) {
    if (dir === 0) p.h = approach(p.h, 0, 0.35);
    else p.h = approach(p.h, dir * 5, Math.abs(p.h) > 5 ? 0.35 : 0.7);
    p.walking = Math.abs(p.h) > 0.1;
    if (jumpPressed || p.prefire > 0) {
      p.fastfall = true;
      for (let i = 0; i < 6; ++i) floorDust(p.X);
      p.ground = false;
      jump(p, 4, s, g - p.gp);
      play.jump({ volume: 0.3 });
      p.X += p.h;
      p.Y += p.v;
    } else {
      p.X += p.h;
      p.Y = g;
    }
  } else {
    if (p.prefire > 0) p.prefire = held ? p.prefire - 1 : 0;
    if (jumpPressed) p.prefire = 4;
    if (dir === 0) p.h *= 0.99;
    else p.h = approach(p.h, dir * 5, Math.abs(p.h) > 5 ? 0.1 : 0.2);
    const cut = p.v < -0.5 && !held && p.fastfall;
    p.v = Math.min(4, p.v + GRAV * (cut ? 2 : 1));
    p.X += p.h;
    p.Y += p.v;
    if (p.Y > g && p.v > 0) {
      p.fastfall = false;
      for (let i = 0; i < 3 + p.v; ++i) floorDust(p.X);
      play.land({ volume: 0.2 });
      p.Y = g;
      p.h += p.v * dsin(s) * 0.5;
      p.v = 0;
      p.ground = true;
    }
  }
  jumpPressed = false;

  if (p.walking) {
    const before = p.frame;
    p.frame = (p.frame + Math.abs(p.h / 12)) % 3;
    if (p.frame < before) play.step({ volume: 0.08 });
  }
  if (p.h > 0.2) p.face = -1;
  if (p.h < -0.2) p.face = 1;
  if (!p.dead) {
    p.tilt = p.ground ? approach(p.tilt, s, 5) : approach(p.tilt, 0, 0.5);
  }
  p.gp = g;

  const a = p.X * H;
  p.x = C + p.Y * dcos(a);
  p.y = C + p.Y * dsin(a);
  p.rot = (a - 90 - p.tilt) * D2R;
  if (p.dead) return;

  for (const t of lv.things) {
    if (t.dead) continue;
    if (t.kind === "key" && near(p, t, [[0, 0, 8]])) {
      ring(20, 4, t.x, t.y);
      openDoor(lv);
      play.coin({ volume: 0.3 });
      t.dead = true;
    } else if (t.kind === "door" && t.open && !t.used) {
      if (near(p, t, [[0, 3, 2.5], [0, 9, 2.5]])) {
        t.used = true;
        play.power({ volume: 0.3 });
        dive();
        return;
      }
    } else if (t.hits && p.invulnerable <= 0 && near(p, t, t.hits)) {
      hurt();
    }
  }
}

function hurt() {
  const p = player;
  if (p.invulnerable > 0 || p.dead) return;
  p.hp -= 1;
  if (p.hp <= 0) return die();
  p.invulnerable = 90;
  p.ground = false;
  p.v = -4.5;
  p.h *= 0.5;
  const a = p.X * H;
  ring(20, 6, C + (p.Y - 6) * dcos(a), C + (p.Y - 6) * dsin(a));
  play.hit({ volume: 0.35 });
  p.shake = 16;
  p.flash = 90;
}

function die() {
  const p = player;
  p.dead = true;
  p.ground = false;
  p.v = -5.5;
  p.h = 0;
  p.Y -= 6;
  ring(12, 6, p.x, p.y);
  play.lose();
  p.flash = 90;
  p.shake = 40;
}

const PLAYER_HITS = [[0, 6, 3], [0, 14, 3]];

// Circles in each thing's own frame, turned onto the board and compared.
function near(p, t, hits) {
  for (const a of world(p, PLAYER_HITS)) {
    for (const b of world(t, hits)) {
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) < a[2] + b[2]) return true;
    }
  }
  return false;
}

function world(t, hits) {
  const c = Math.cos(t.rot);
  const s = Math.sin(t.rot);
  return hits.map(([x, y, r]) => {
    x *= t.flip ?? 1;
    y = -y;
    return [t.x + x * c - y * s, t.y + x * s + y * c, r];
  });
}

// ---------------------------------------------------------------- round

export function init() {
  clock = rand(0, 60);
  completed = 0;
  score.value = 0;
  dust = [];
  gone = [];
  levels = [];
  player = newPlayer();
  for (let i = 0; i < COUNT; ++i) {
    const lv = makeLevel(i);
    lv.scale = lv.target;
    lv.colour = lv.goal;
    levels.push(lv);
  }
  for (const lv of levels) {
    for (const t of lv.things) if (t.blend) t.blend = lv.colour;
  }
  player.Y = ground(levels[0], player.X) - 40;
  player.x = C;
  player.y = C + player.Y;
  player.rot = 0;
  ring(12, 6, C + (player.Y - 20) * dcos(90), C + (player.Y - 20) * dsin(90));
}

function step() {
  clock += 1 / 60;
  for (const lv of [...gone, ...levels]) stepLevel(lv);
  stepPlayer();
  stepDust();
}

export function update() {
  if (input.just.up || input.just.act) jumpPressed = true;
  fixed(60, step);
}

// ---------------------------------------------------------------- drawing

function sheet(ctx, lv) {
  ctx.beginPath();
  ctx.rect(-10, -10, 500, 500);
  for (let i = 0; i <= 360; i += 4) {
    const r = lv.radius * lv.scale + lv.scale * wave(lv, i);
    const x = C + r * dcos(i);
    const y = C + r * dsin(i);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = css(lv.colour);
  ctx.fill("evenodd");
}

function lavaSheet(ctx, lv) {
  const r = lavaR(lv);
  ctx.beginPath();
  ctx.rect(-10, -10, 500, 500);
  ctx.moveTo(C + r, C);
  ctx.arc(C, C, r, 0, 2 * Math.PI);
  ctx.fillStyle = css(lv.lavaColour);
  ctx.fill("evenodd");
}

function lavaDots(ctx, lv) {
  const r = lavaR(lv) + lv.scale;
  ctx.fillStyle = css(lv.lavaColour);
  for (let i = 0; i <= 360; i += 4) {
    ctx.fillRect(C + r * dcos(i) - 0.5, C + r * dsin(i) - 0.5, 1, 1);
  }
}

// Over their own sheet, as the original's flyers are; the rest sink into it.
const ABOVE = new Set(["drill", "bird", "fly", "chaser"]);

function drawLevel(ctx, lv) {
  const back = lv.things.filter((t) => !ABOVE.has(t.kind));
  for (const kind of ["door", "key"]) {
    for (const t of back) if (t.kind === kind) drawThing(ctx, t, lv.colour);
  }
  for (const t of back) {
    if (t.kind !== "door" && t.kind !== "key") drawThing(ctx, t, t.blend);
  }
  if (lv.biome === "lava") lavaSheet(ctx, lv);
  sheet(ctx, lv);
  if (lv.biome === "lava" && lv.number === 0) lavaDots(ctx, lv);
  for (const t of lv.things) {
    if (ABOVE.has(t.kind)) drawThing(ctx, t, t.blend);
  }
}

// A shape's holes are cut with destination-out, which would cut the sheet
// under it too, so each one is drawn alone on `scratch` and then copied over.
const SPAN = 64;
let scratch = null;

function drawThing(ctx, t, colour) {
  if (scratch === null) {
    scratch = document.createElement("canvas");
    scratch.width = scratch.height = Math.ceil(SPAN * K);
  }
  const s = scratch.getContext("2d");
  s.setTransform(1, 0, 0, 1, 0, 0);
  s.clearRect(0, 0, scratch.width, scratch.height);
  s.setTransform(K, 0, 0, K, 0, 0);
  s.translate(SPAN / 2, SPAN / 2);
  s.rotate(t.rot);
  if (t.flip === -1) s.scale(-1, 1);
  s.fillStyle = css(colour);
  s.strokeStyle = css(colour);
  s.beginPath();
  SHAPE[t.kind](s, t);
  ctx.drawImage(scratch, t.x - SPAN / 2, t.y - SPAN / 2, SPAN, SPAN);
}

function poly(ctx, pts) {
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.closePath();
}

function disc(ctx, x, y, r) {
  ctx.moveTo(x + r, y);
  ctx.arc(x, y, r, 0, 2 * Math.PI);
}

// A round window with a cross in it, the mark every shooter carries.
function eye(ctx, x, y, r, turn = Math.PI / 4) {
  ctx.fill("evenodd");
  ctx.beginPath();
  disc(ctx, x, y, r);
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.fill();
  ctx.restore();
  ctx.lineWidth = r * 0.45;
  ctx.beginPath();
  for (let i = 0; i < 2; ++i) {
    const a = turn + i * Math.PI / 2;
    ctx.moveTo(x - r * Math.cos(a), y - r * Math.sin(a));
    ctx.lineTo(x + r * Math.cos(a), y + r * Math.sin(a));
  }
  ctx.stroke();
}

// y is up the page from the anchor, negative in canvas terms.
const SHAPE = {
  ball(ctx, t) {
    disc(ctx, 0, -6, 6);
    eye(ctx, 0, -6, 2.6, t.X * H * D2R * 3);
  },

  cannonball(ctx) {
    disc(ctx, 0, 0, 5.5);
    ctx.fill();
  },

  bullet(ctx) {
    disc(ctx, 0, 0, 4);
    ctx.fill();
  },

  spike(ctx) {
    poly(ctx, [-6, 1, 0, -11, 6, 1]);
    ctx.fill();
  },

  frog(ctx, t) {
    const air = !t.ground;
    ctx.ellipse(0, -4, 8, 5.5, 0, Math.PI, 2 * Math.PI);
    ctx.rect(-8, -4, 16, 3);
    disc(ctx, -4, -9.5, 3);
    disc(ctx, 4, -9.5, 3);
    if (air) {
      ctx.rect(-9, -2, 3, 5);
      ctx.rect(6, -2, 3, 5);
    } else {
      ctx.rect(-9, -2, 4, 2.5);
      ctx.rect(5, -2, 4, 2.5);
    }
    ctx.fill();
    ctx.beginPath();
    disc(ctx, -4, -9.5, 1.2);
    disc(ctx, 4, -9.5, 1.2);
    ctx.rect(-3, -4.5, 6, 1);
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.fill();
    ctx.restore();
  },

  cactus(ctx, t) {
    const lift = [0, 4, -3][t.variant];
    ctx.roundRect(-4, -34, 8, 36, 4);
    ctx.roundRect(-11, -26 + lift, 4.5, 11, 2.25);
    ctx.rect(-11, -18 + lift, 8, 3.5);
    ctx.roundRect(6.5, -30 - lift, 4.5, 11, 2.25);
    ctx.rect(3, -22 - lift, 8, 3.5);
    ctx.fill();
  },

  spear(ctx) {
    poly(ctx, [-4, 14, -4, -12, 0, -18, 4, -12, 4, 14]);
    ctx.fill();
  },

  cannon(ctx) {
    poly(ctx, [-6, 1, 6, 1, 4.5, -6, -4.5, -6]);
    ctx.rect(-3.5, -12, 7, 7);
    ctx.fill();
    ctx.beginPath();
    ctx.rect(-2, -12, 4, 4);
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.fill();
    ctx.restore();
  },

  shooterA(ctx, t) {
    const leg = Math.floor(t.rise / 45) % 2;
    ctx.roundRect(-5.5, -17, 11, 15, [5.5, 5.5, 0, 0]);
    ctx.rect(-5.5, -2, 4, 3 + leg);
    ctx.rect(1.5, -2, 4, 4 - leg);
    eye(ctx, 0, -10.5, 3.6);
  },

  shooterC(ctx, t) {
    const pts = [];
    const spin = t.rise * D2R;
    for (let i = 0; i < 16; ++i) {
      const r = i % 2 ? 8.5 : 12.5;
      const a = spin + i * Math.PI / 8;
      pts.push(r * Math.cos(a), r * Math.sin(a));
    }
    poly(ctx, pts);
    eye(ctx, 0, 0, 5, spin + Math.PI / 4);
  },

  drill(ctx, t) {
    // Drawn pointing back along its path, like the original's sprite, so
    // the nose is at -x.
    poly(ctx, [-22, 0, -11, -6, -11, 6]);
    ctx.roundRect(-11, -6, 12, 12, 3);
    eye(ctx, -5, 0, 3.5, t.X * H * D2R * 2);
  },

  bird(ctx, t) {
    const flap = dsin(t.X * H * 40);
    poly(ctx, [-8, 1, -3, -2, 3, -3, 6, -2, 9, 0, 6, 0, 3, 2, -4, 3]);
    poly(ctx, [-3, -1, 3, -1, -1, -1 - 8 * flap]);
    ctx.fill();
  },

  fly(ctx, t) {
    const flap = Math.abs(dsin(t.c * 40));
    disc(ctx, 0, 0, 2.8);
    ctx.ellipse(-3, -2 - 2 * flap, 3, 1.5 + flap, -0.5, 0, 2 * Math.PI);
    ctx.ellipse(3, -2 - 2 * flap, 3, 1.5 + flap, 0.5, 0, 2 * Math.PI);
    ctx.fill();
  },

  chaser(ctx, t) {
    disc(ctx, 0, 0, 11);
    ctx.fill();
    ctx.beginPath();
    const spin = t.age * 0.3 + clock * 12;
    for (let i = 0; i < 4; ++i) {
      const a = spin + i * Math.PI / 2;
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, 7.5, a, a + 0.9);
      ctx.closePath();
    }
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.fill();
    ctx.restore();
  },

  key(ctx) {
    disc(ctx, -5, 0, 3.6);
    ctx.rect(-2, -1.3, 10, 2.6);
    ctx.rect(4.5, 1.3, 1.8, 2.4);
    ctx.rect(6.8, 1.3, 1.8, 3.2);
    ctx.fill();
    ctx.beginPath();
    disc(ctx, -5, 0, 1.5);
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.fill();
    ctx.restore();
  },

  door(ctx, t) {
    ctx.lineWidth = 1.4;
    ctx.rect(-6.5, -19.5, 13, 20.5);
    if (t.open) {
      for (let i = 0; i < 3; ++i) {
        ctx.moveTo(-4 + i, -3 - 3 * i);
        ctx.lineTo(4 - i, -3 - 3 * i);
      }
    } else {
      ctx.moveTo(-4, -16);
      ctx.lineTo(4, -4);
      ctx.moveTo(4, -16);
      ctx.lineTo(-4, -4);
    }
    ctx.stroke();
  },
};

function drawPlayer(ctx, p, x, y, rot, frame, air, colour) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  if (p.face === -1) ctx.scale(-1, 1);
  ctx.fillStyle = css(colour);
  ctx.beginPath();
  if (p.dead) {
    ctx.translate(0, -8);
    disc(ctx, 0, -4, 3);
    ctx.roundRect(-3, -1, 6, 6, 2);
    ctx.rect(-5, 0, 2, 4);
    ctx.rect(3, 0, 2, 4);
  } else {
    const swing = air ? 1.8 : 1.6 * Math.sin(frame / 3 * 2 * Math.PI);
    disc(ctx, 0.5, -14, 3.2);
    ctx.roundRect(-2.5, -11, 5, 6.5, 1.5);
    ctx.rect(-2 + swing, -5, 2, 5);
    ctx.rect(0 - swing, -5, 2, 5);
    ctx.rect(-4 - swing * 0.6, -10, 2, 4);
  }
  ctx.fill();
  ctx.restore();
}

export function render(ctx) {
  ctx.save();
  ctx.scale(K, K);
  for (const lv of [...levels].reverse().concat(gone)) {
    drawLevel(ctx, lv);
    if (lv === levels[0]) drawActors(ctx);
  }
  ctx.restore();
}

function drawActors(ctx) {
  for (const d of dust) {
    const k = 1 - d.age / d.life;
    ctx.fillStyle = css(d.colour);
    ctx.beginPath();
    disc(ctx, d.x, d.y, 0.6 + 3 * k);
    ctx.fill();
  }

  const p = player;
  const flashing = p.flash > 0 && p.flash % 8 < 4;
  drawPlayer(ctx, p, p.x, p.y, p.rot, p.frame, !p.ground, flashing ? DARK : WHITE);

  for (let i = 0; i < 5; ++i) {
    const alive = i < p.hp;
    const lean = 5 * dsin(clock * 120 + i * 120) * D2R;
    drawPlayer(
      ctx,
      { face: 1, dead: false },
      480 - 12 * (i + 1),
      24,
      lean,
      alive ? clock * 15 + i : 2,
      false,
      alive ? WHITE : DARK,
    );
  }
}
