/*
 * hypermania.
 *
 * Megamania on a time limit. The orange bar is both the timer and the
 * ammunition: it drains on its own, every shot takes half a point off it, and
 * at zero the ship is destroyed. Clearing a wave spends what is left for score,
 * two points per energy point per wave already cleared, then refills it. The
 * score is what you did not spend clearing.
 *
 * Eight formations rotate, four crossing and four falling, and every eight
 * waves a timing pattern runs the formation in bursts of up to three times
 * speed. Hits chain: a kill is worth (waves + 1) times the length of its chain.
 *
 * The shooter is chosen at random from the enemies on screen: if each bullet
 * came down your own column there would be nothing to do but dodge.
 */

import * as ent from "./lib/entity.js";
import { gameOver, score } from "./lib/one.js";
import { explosion, laser, powerup } from "./lib/fsfx/sfxr.js";
import * as sound from "./lib/sound.js";

export const meta = {
  title: "hypermania",
  desc: `
arrows move, space shoots
the bar is the clock, and every shot spends it
`,
  bg: "#04a2fc",
  fg: "#024972",
  scoreMax: true,
  date: "2014-04-13",
  dpad: true,
};

const WHITE = 0xffffff;
const BLACK = 0x000000;
// meta.fg is PANEL too: the bar is the darkest thing on the board.
const PANEL = 0x024972;
const DEEP = 0x011f30;
const ORANGE = 0xe65205;
const FLASH = 0xffffcc;
const EMBER = 0xb23f04;

// The game's own bar, along the bottom.
const BARH = 105;
const BOT = 1024 - BARH;

const EW = 850;
const EH = 26;
const EY = BOT + (BARH - EH) / 2;

// Rests 60 above the bar, drops to 21 on the recoil, climbs back at RISE.
const PY = BOT - 60;
const PDIP = BOT - 21;
const RISE = 215;
const WALK = 425;
const PX = 38;

// A shot leaves from above the ship whatever the recoil is doing.
const SHOTY = PY - 38;
const UP = 1070;
const DOWN = 850;
const CEIL = 19;
const SINK = BOT + 21;

// A full bar is two minutes of holding still.
const DRAIN = 100 / 120;
const COST = 100 / 200;
const DUMP = 1.5;
const FILL = 0.75;
const BEAT = 0.1;

// Wider than the screen on both axes, so an enemy leaving one side is already
// in place at the other. Wrapping happens 11 past the foot of the field.
const WRAPX = 1024 + 32;
const BANDX = 1024 + 64;
const WRAPY = BOT + 11;
const BANDY = 917;

const COLS = 5;
const ROWS = 4;
const PIXEL = 13;

const DEATH = 0.4;
const LIGHT = 0.05;
const WHITEOUT = 0.1;
const POP = 0.2;

// All at 0.2 except the spend, which plays ten times a second.
sound.voice("begin", { ...powerup(8428), vol: 0.2 });
sound.voice("spend", { ...explosion(1345), vol: 0.1 });
sound.voice("shot", { ...laser(1350), vol: 0.2 });
sound.voice("dead", { ...explosion(1344), vol: 0.2 });
sound.voice("enemyshot", { ...laser(1403), vol: 0.2 });
sound.voice("boom", { ...explosion(1345), vol: 0.2 });

// `across` spawns w by h off the left edge and moves them right; the other
// spawns a column every dx and moves them down. At t == 0, `xmove(row, t)` is
// not a speed but that row's spawn offset, which is what spawn() reads it for.
const STRATS = [
  {
    spawn: { across: true, w: 5, h: 3, dy: 107 },
    xmove: () => 425,
    ymove: () => 0,
    shooting: 0.1,
  },
  {
    spawn: { across: false, w: 3, h: 6, dx: 218 },
    xmove: (y, t) => t === 0 ? 385 * y : Math.trunc(t) % 4 <= 1 ? 425 : -425,
    ymove: (t) => Math.trunc(t) % 2 === 0 ? 107 : 0,
    shooting: 0.1,
  },
  {
    spawn: { across: true, w: 5, h: 3, dy: 107 },
    xmove: () => 425,
    ymove: (t) => 32 * Math.sin(2 * Math.PI * t / 30),
    shooting: 0.3,
  },
  {
    spawn: { across: false, w: 3, h: 6, dx: 218 },
    xmove: (y, t) => t === 0 ? 277 * y : (y + Math.trunc(t)) % 4 <= 1 ? 425 : -425,
    ymove: (t) => Math.trunc(t) % 3 === 0 ? 107 : 0,
    shooting: 0.3,
  },
  {
    spawn: { across: true, w: 5, h: 3, dy: 107 },
    xmove: () => 425,
    ymove: (t) => 170 * Math.sin(2 * Math.PI * t / 5),
    shooting: 0.5,
  },
  {
    spawn: { across: false, w: 3, h: 6, dx: 218 },
    xmove: (_y, t) => {
      if (t === 0) return 512;
      const s = Math.trunc(1.5 * t) % 6;
      if (s === 0 || s === 4) return 0;
      return s === 1 || s === 3 ? -640 : 640;
    },
    ymove: (t) => Math.trunc(t) % 3 !== 0 ? 85 : 0,
    shooting: 0.4,
  },
  {
    spawn: { across: true, w: 5, h: 3, dy: 107 },
    xmove: () => 425,
    ymove: (t) => 600 * Math.sin(2 * Math.PI * t / 1.5),
    shooting: 0.6,
  },
  {
    spawn: { across: false, w: 3, h: 6, dx: 218 },
    xmove: (y, t) => t === 0 ? (y * 7843) % 1024 : 0,
    ymove: () => 425,
    shooting: 0,
  },
];

// Extra substeps the formation takes this frame, on top of its ten. A wave runs
// a tenth of a step a substep, so 20 is three times speed and -2 is four fifths
// of it, and the formation's own timer runs at the same rate.
const TICKERS = [
  () => 0,
  (t) => Math.trunc(t) % 2 === 0 ? 0 : 10,
  (t) => {
    const s = Math.trunc(t) % 12;
    if (s < 3) return 0;
    if (s < 6) return 15;
    if (s < 9) return 5;
    return 20;
  },
  (t) => 8 - Math.trunc(10 * Math.cos(t * 2 * Math.PI / 10)),
];

let energy = 0;
let wave = null;
let waves = 0;
let player = null;
// Earned but not yet shown: the bar releases it a pop at a time.
let buffer = 0;
let dying = 0;

function addScore(v) {
  buffer += v;
}

class Bar extends ent.Entity {
  // Flush with the bottom edge: shaken, it shows meta.bg underneath.
  static screen = true;

  constructor() {
    super();
    this.pos.x = 512;
    this.pos.y = BOT + BARH / 2;
  }

  update() {
    // Frame and gauge in one entity: three rectangles a frame is not worth
    // splitting to keep the frame cached.
    const y = EY - this.pos.y;
    const left = Math.max(0, energy) / 100;
    this.gfx.clear()
      .fill(PANEL).rect(-512, -BARH / 2, 1024, BARH)
      .fill(DEEP).rect(-EW / 2, y, EW, EH)
      .fill(ORANGE).rect(-EW / 2, y, EW * left, EH);

    if (buffer < 1 || this.age < POP) return;
    const n = Math.floor(buffer);
    buffer -= n;
    score.value += n;
    this.age = 0;
    new ent.Text({
      text: `+${n}`,
      x: 512 + EW / 2 - 32,
      y: BOT - 21,
      size: 40,
      color: ORANGE,
      vel: [0, -85],
      duration: 0.3,
    });
  }
}

class Player extends ent.Entity {
  constructor() {
    super();
    this.pos.x = 512;
    this.pos.y = PY;
    this.bullet = null;
    this.combo = 0;
    this.hitBox(48, 72);
    this.art.size(6, 8, 12).obj(
      [WHITE],
      `
...00...
..0000..
.000000.
.000000.
..0000..
...00...
00.00.00
00.00.00
00000000
00000000
00....00
00....00`,
    );
  }

  explode() {
    if (this.dead) return;
    this.bullet?.remove();
    this.remove();
    sound.play("dead");
    new ent.Particle({
      x: this.pos.x,
      y: this.pos.y,
      color: WHITE,
      count: 80,
      size: 13,
      speed: [43, 107],
      duration: 1.5,
    });
    ent.shake(1);
    dying = DEATH;
  }

  update() {
    const { input, time } = ent.game;
    this.pos.y = Math.max(PY, this.pos.y - RISE * time);

    // Flown from here, not from itself: steer while it climbs and it follows.
    if (this.bullet === null) {
      if (input.press.act) {
        sound.play("shot");
        this.bullet = new Bullet(this.pos.x);
        new Light(this.pos.x, SHOTY, true);
        energy -= COST;
        this.pos.y = PDIP;
      }
    } else {
      this.bullet.pos.x = this.pos.x;
      this.bullet.pos.y -= UP * time;
      if (this.bullet.pos.y < CEIL) this.bullet.explode(false);
    }

    if (input.press.left) this.pos.x = Math.max(PX, this.pos.x - WALK * time);
    else if (input.press.right) {
      this.pos.x = Math.min(1024 - PX, this.pos.x + WALK * time);
    }
  }
}

class Bullet extends ent.Entity {
  constructor(x) {
    super();
    this.pos.x = x;
    this.pos.y = SHOTY;
    this.hitBox(12, 36);
    this.art.size(6).color(WHITE).rect(0, 0, 2, 6);
  }

  explode(hit) {
    player.combo = hit ? player.combo + 1 : 0;
    if (player.combo > 1) {
      new ent.Text({
        text: `x${player.combo}`,
        x: this.pos.x,
        y: this.pos.y,
        size: 40,
        color: EMBER,
        vel: [0, -107],
        duration: 0.5,
      });
    }
    player.bullet = null;
    this.remove();
  }
}

class EnemyBullet extends ent.Entity {
  constructor(x, y) {
    super();
    this.pos.x = x;
    this.pos.y = y;
    this.hitBox(12, 36);
    this.art.size(6).color(BLACK).rect(0, 0, 2, 6);
    new Light(x, y, false);
  }

  update() {
    if (this.hit(player.bullet)) {
      ent.shake(0.1);
      player.bullet.explode(true);
      // Shot down: white, held, and harmless on the way.
      this.clearHits();
      this.art.clear().size(4).color(WHITE).rect(0, 0, 2, 6);
      ent.after(WHITEOUT, () => this.remove());
      return;
    }

    if (this.hit(player)) player.explode();

    this.pos.y += DOWN * ent.game.time;
    if (this.pos.y >= SINK) this.remove();
  }
}

// One frame is 16ms on one screen and 8 on another, so it holds for LIGHT.
class Light extends ent.Entity {
  constructor(x, y, mine) {
    super();
    this.pos.x = x;
    this.pos.y = y;
    this.gfx.fill(mine ? FLASH : BLACK).circle(0, 0, mine ? 26 : 17);
  }

  update() {
    if (this.age >= LIGHT) this.remove();
  }
}

class Enemy extends ent.Entity {
  constructor(row, x, y, sprite, wave) {
    super();
    this.row = row;
    this.pos.x = x;
    this.pos.y = y;
    this.sprite = sprite;
    this.wave = wave;
    this.exploding = false;
    this.hitBox(COLS * PIXEL, ROWS * PIXEL);
    this.draw(BLACK);
  }

  draw(c) {
    this.art.size(PIXEL, COLS, ROWS).color(c);
    for (let y = 0; y < ROWS; ++y) {
      for (let x = 0; x < COLS; ++x) {
        if (this.sprite.pat[x + y * COLS]) this.art.dot(x, y);
      }
    }
  }

  shoot() {
    new EnemyBullet(this.pos.x + 5, this.pos.y + 26);
    sound.play("enemyshot");
  }

  update() {
    if (this.exploding) return;

    if (this.hit(player)) {
      this.exploding = true;
      player.explode();
      this.remove();
      this.wave.drop(this);
      sound.play("boom");
      return;
    }

    if (!this.hit(player.bullet)) return;

    this.exploding = true;
    this.draw(WHITE);
    sound.play("boom");
    ent.shake(0.2);
    ent.delay(0.01);
    player.bullet.explode(true);
    addScore((waves + 1) * player.combo);
    ent.after(WHITEOUT, () => {
      this.remove();
      this.wave.drop(this);
      new ent.Particle({
        x: this.pos.x,
        y: this.pos.y,
        color: WHITE,
        count: this.sprite.dots,
        size: 13,
        speed: [43, 107],
        spread: 11,
        duration: 0.5,
      });
    });
  }
}

// It owns its enemies rather than reading them back out of the group, because
// it moves them itself: an enemy has no velocity, only a place in the pattern.
class Wave extends ent.Entity {
  // Not begin(): the wave is built and pushed off its entry edge in the same
  // call, and begin() runs a frame later.
  constructor() {
    super();
    this.strat = STRATS[waves % STRATS.length];
    this.ticker = TICKERS[Math.trunc(waves / STRATS.length) % TICKERS.length];
    this.all = [];
    this.spawn();
  }

  spawn() {
    const { across, w, h, dx, dy } = this.strat.spawn;
    const sprite = pattern();
    const add = (row, x, y) => this.all.push(new Enemy(row, x, y, sprite, this));

    if (across) {
      // Rows every dy, a screen wide, odd ones half a gap over.
      const gap = BANDX / w;
      for (let y = 0; y < h; ++y) {
        for (let x = 0; x < w; ++x) {
          add(y, x * gap + (y % 2) * (gap / 2) - 1058, 107 + y * dy);
        }
      }
    } else {
      const gap = BANDY / h;
      for (let y = 0; y < h; ++y) {
        for (let x = 0; x < w; ++x) {
          add(y, 32 + x * dx + this.strat.xmove(y, 0), -gap * y);
        }
      }
    }

    // Moved back off the entry edge, so the wave arrives rather than appears.
    if (across) {
      const max = Math.max(...this.all.map((e) => e.pos.x));
      if (max > 0) { for (const e of this.all) e.pos.x -= max + 215; }
    } else {
      const max = Math.max(...this.all.map((e) => e.pos.y));
      if (max > 0) { for (const e of this.all) e.pos.y -= max + 64; }
    }
  }

  drop(e) {
    const i = this.all.indexOf(e);
    if (i >= 0) this.all.splice(i, 1);
  }

  update() {
    const { time } = ent.game;
    const { across } = this.strat.spawn;
    const { xmove, ymove, shooting } = this.strat;
    const steps = 10 + this.ticker(this.age);

    // Reservoir sampling: each of the n on screen gets the same 1/n chance
    // without counting them first.
    const shoot = Math.random() < shooting * time * 2;
    let shooter = null;
    let seen = 0;

    for (const e of this.all) {
      for (let s = 0; s < steps; ++s) {
        const t = this.age + s * time / 10;
        e.pos.x += xmove(e.row, t) * time / 10;
        e.pos.y += ymove(t) * time / 10;
      }

      if (e.pos.x >= WRAPX) e.pos.x -= BANDX;
      if (!across) {
        if (e.pos.x <= -32) e.pos.x += BANDX;
        if (e.pos.y >= WRAPY) e.pos.y -= BANDY;
      }

      if (!shoot || e.pos.y <= 0) continue;
      seen += 1;
      if (shooter === null || Math.random() < 1 / seen) shooter = e;
    }

    this.age += this.ticker(this.age) * time / 10;
    shooter?.shoot();

    if (this.all.length > 0) return;
    this.remove();
    nextLevel();
  }
}

// Mirrored left to right, generated again until it has enough set pixels to be
// legible at 65 units across. The count is how many particles it comes apart
// into.
function pattern() {
  for (;;) {
    const pat = new Array(COLS * ROWS);
    let dots = 0;
    for (let y = 0; y < ROWS; ++y) {
      for (let x = 0; x <= COLS / 2; ++x) {
        const on = Math.random() < 0.5;
        pat[y * COLS + x] = pat[y * COLS + COLS - 1 - x] = on;
        if (on) dots += x === COLS - 1 - x ? 1 : 2;
      }
    }
    if (dots >= 10) return { pat, dots };
  }
}

// Spend what is left of the bar, at DUMP for a full one.
function nextLevel() {
  if (wave === null) return;
  waves += 1;
  wave = null;

  let beat = 0;
  ent.every(0, () => {
    const was = energy;
    energy = Math.max(1, energy - ent.game.time * 100 / DUMP);
    addScore(waves * 2 * (was - energy));

    beat -= ent.game.time;
    if (beat <= 0) {
      sound.play("spend");
      beat += BEAT;
    }

    if (energy > 1) return true;
    beginLevel();
    return false;
  });
}

function beginLevel() {
  if (energy <= 0) energy = 1;
  sound.play("begin");

  ent.every(0, () => {
    energy = Math.min(100, energy + ent.game.time * 100 / FILL);
    if (energy < 100) return true;
    wave = new Wave();
    return false;
  });
}

export function init() {
  // Update order as much as draw order: ship moves its bullet, wave moves the
  // formation, then an enemy asks what it is touching.
  ent.reset([Player, Wave, Enemy, EnemyBullet, Bullet, Light, ent.Particle, Bar]);

  energy = 0;
  wave = null;
  waves = 0;
  buffer = 0;
  dying = 0;

  new Bar();
  player = new Player();
  beginLevel();
}

export function update(dt) {
  // Entities first: entity.js holds a hit by running a frame at dt 0 rather
  // than skipping it, which the drain below only sees by running after.
  ent.update(dt);

  if (dying > 0) {
    dying -= dt;
    if (dying <= 0) gameOver({ score: true });
    return;
  }

  // Between waves the bar is being spent or refilled, and the drain is off.
  if (wave === null) return;

  energy -= ent.game.time * DRAIN;
  if (energy <= 0) player.explode();
}

export { render } from "./lib/entity.js";
