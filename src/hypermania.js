/*
 * hypermania.
 *
 * Megamania on a fuse. A formation crosses the screen, you hold one bullet in
 * the air at a time, and the orange bar is both clock and magazine: it drains
 * on its own, every shot takes half a point off it, and at zero the ship goes
 * up. Clearing a wave spends what is left for score, two points per energy
 * point per wave already cleared, then refills it. The score is what you did
 * not spend clearing.
 *
 * Eight formations rotate, four crossing and four falling, and every eight
 * waves a timing pattern runs the formation in bursts of up to three times
 * speed. Hits chain: a kill is worth (waves + 1) times the length of its chain.
 *
 * The bar carries no score line, so it is 49 units rather than 70 and the field
 * is 431.
 *
 * The shooter is drawn at random from the enemies on screen. A wave fires 0.2
 * to 1.2 bullets a second, and if each came down your own column there would be
 * nothing to do but dodge.
 */

import * as ent from "./lib/entity.js";
import { gameOver, msg, score } from "./lib/one.js";
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
};

const WHITE = 0xffffff;
const BLACK = 0x000000;
// meta.fg is PANEL too: the bar is the darkest thing on the board.
const PANEL = 0x024972;
const DEEP = 0x011f30;
const ORANGE = 0xe65205;
const FLASH = 0xffffcc;
const EMBER = 0xb23f04;

const W = 480;
// The game's own bar, along the bottom.
const BARH = 49;
const BOT = W - BARH;

const EW = 400;
const EH = 12;
const EY = BOT + (BARH - EH) / 2;

// Rests 28 above the bar, drops to 10 on the recoil, climbs back at RISE. The
// ship is 24 across, so WALL is 18.
const PY = BOT - 28;
const PDIP = BOT - 10;
const RISE = 100;
const WALK = 200;
const PX = 18;

// A shot leaves from above the ship whatever the recoil is doing, and has
// missed once past the top of the field.
const SHOTY = PY - 18;
const UP = 500;
const DOWN = 400;
const CEIL = 9;
const SINK = BOT + 10;

// A full bar is two minutes of holding still.
const DRAIN = 100 / 120;
const COST = 100 / 200;
const DUMP = 1.5;
const FILL = 0.75;
const BEAT = 0.1;

// Wider than the screen on both axes, so an enemy leaving one side is already
// in place at the other.
const WRAPX = W + 15;
const BANDX = W + 30;
// Wrapping happens 5 past the foot of the field.
const WRAPY = BOT + 5;
const BANDY = 430;

// 5x4 pixels at 6 units each.
const COLS = 5;
const ROWS = 4;
const PIXEL = 6;

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

/*
 * The eight formations. `across` spawns w by h off the left edge and walks them
 * right; the other spawns a column every dx and walks them down. At t == 0,
 * `xmove(row, t)` is not a speed but the spawn offset of that row, which is the
 * one place spawn() reads it for.
 */
const STRATS = [
  {
    spawn: { across: true, w: 5, h: 3, dy: 50 },
    xmove: () => 200,
    ymove: () => 0,
    shooting: 0.1,
  },
  {
    spawn: { across: false, w: 3, h: 6, dx: 102 },
    xmove: (y, t) => t === 0 ? 180 * y : Math.trunc(t) % 4 <= 1 ? 200 : -200,
    ymove: (t) => Math.trunc(t) % 2 === 0 ? 50 : 0,
    shooting: 0.1,
  },
  {
    spawn: { across: true, w: 5, h: 3, dy: 50 },
    xmove: () => 200,
    ymove: (t) => 15 * Math.sin(2 * Math.PI * t / 30),
    shooting: 0.3,
  },
  {
    spawn: { across: false, w: 3, h: 6, dx: 102 },
    xmove: (y, t) => t === 0 ? 130 * y : (y + Math.trunc(t)) % 4 <= 1 ? 200 : -200,
    ymove: (t) => Math.trunc(t) % 3 === 0 ? 50 : 0,
    shooting: 0.3,
  },
  {
    spawn: { across: true, w: 5, h: 3, dy: 50 },
    xmove: () => 200,
    ymove: (t) => 80 * Math.sin(2 * Math.PI * t / 5),
    shooting: 0.5,
  },
  {
    spawn: { across: false, w: 3, h: 6, dx: 102 },
    xmove: (_y, t) => {
      if (t === 0) return 240;
      const s = Math.trunc(1.5 * t) % 6;
      if (s === 0 || s === 4) return 0;
      return s === 1 || s === 3 ? -300 : 300;
    },
    ymove: (t) => Math.trunc(t) % 3 !== 0 ? 40 : 0,
    shooting: 0.4,
  },
  {
    spawn: { across: true, w: 5, h: 3, dy: 50 },
    xmove: () => 200,
    ymove: (t) => 280 * Math.sin(2 * Math.PI * t / 1.5),
    shooting: 0.6,
  },
  {
    spawn: { across: false, w: 3, h: 6, dx: 102 },
    xmove: (y, t) => t === 0 ? (y * 7843) % W : 0,
    ymove: () => 200,
    shooting: 0,
  },
];

/*
 * Extra substeps the formation takes this frame, on top of its ten. A wave
 * runs a tenth of a step per substep, so 20 is three times speed and -2 is
 * four fifths of it. The formation's own clock runs at the same rate, which is
 * what makes the patterns above shift with it.
 */
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
// Earned but not yet shown: the bar hands it over a pop at a time.
let buffer = 0;
let dying = 0;

function addScore(v) {
  buffer += v;
}

class Bar extends ent.Entity {
  constructor() {
    super();
    this.pos.x = W / 2;
    this.pos.y = BOT + BARH / 2;
  }

  update() {
    // Frame and gauge in one entity: three rectangles a frame is not worth
    // splitting to keep the frame cached.
    const y = EY - this.pos.y;
    const left = Math.max(0, energy) / 100;
    this.gfx.clear()
      .fill(PANEL).rect(-W / 2, -BARH / 2, W, BARH)
      .fill(DEEP).rect(-EW / 2, y, EW, EH)
      .fill(ORANGE).rect(-EW / 2, y, EW * left, EH);

    if (buffer < 1 || this.ticks < POP) return;
    const n = Math.floor(buffer);
    buffer -= n;
    score.value += n;
    this.ticks = 0;
    new ent.Text().text(`+${n}`).size(2).color(ORANGE)
      .xy(W / 2 + EW / 2 - 15, BOT - 10)
      .move(0, -40).duration(0.3);
  }
}

class Player extends ent.Entity {
  constructor() {
    super();
    this.pos.x = W / 2;
    this.pos.y = PY;
    this.bullet = null;
    this.combo = 0;
    this.hitBox(24, 36);
    this.art.size(3, 8, 12).obj(
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
    new ent.Particle().xy(this.pos.x, this.pos.y).color(WHITE)
      .count(80).size(6).speed(20, 50).duration(1.5);
    ent.shake(1);
    dying = DEATH;
  }

  update() {
    const { key, time } = ent.game;
    this.pos.y = Math.max(PY, this.pos.y - RISE * time);

    // Flown from here, not from itself: steer while it climbs and it follows.
    if (this.bullet === null) {
      if (key.b1) {
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

    if (key.left) this.pos.x = Math.max(PX, this.pos.x - WALK * time);
    else if (key.right) this.pos.x = Math.min(W - PX, this.pos.x + WALK * time);
  }
}

class Bullet extends ent.Entity {
  constructor(x) {
    super();
    this.pos.x = x;
    this.pos.y = SHOTY;
    this.hitBox(6, 18);
    this.art.size(3).color(WHITE).rect(0, 0, 2, 6);
  }

  explode(hit) {
    player.combo = hit ? player.combo + 1 : 0;
    if (player.combo > 1) {
      new ent.Text().text(`x${player.combo}`).size(2).color(EMBER)
        .xy(this.pos.x, this.pos.y).move(0, -50).duration(0.5);
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
    this.hitBox(6, 18);
    this.art.size(3).color(BLACK).rect(0, 0, 2, 6);
    new Light(x, y, false);
  }

  update() {
    if (this.hit(player.bullet)) {
      ent.shake(0.1);
      player.bullet.explode(true);
      // Shot down: white, held, and harmless on the way.
      this.clearHits();
      this.art.clear().size(2).color(WHITE).rect(0, 0, 2, 6);
      new ent.Timer().delay(WHITEOUT).run(() => {
        this.remove();
        return false;
      });
      return;
    }

    if (this.hit(player)) player.explode();

    this.pos.y += DOWN * ent.game.time;
    if (this.pos.y >= SINK) this.remove();
  }
}

/*
 * A muzzle flash, at the end of the barrel that fired. One frame is 16ms on one
 * screen and 8 on another, so it holds for LIGHT instead.
 */
class Light extends ent.Entity {
  constructor(x, y, mine) {
    super();
    this.pos.x = x;
    this.pos.y = y;
    this.gfx.fill(mine ? FLASH : BLACK).circle(0, 0, mine ? 12 : 8);
  }

  update() {
    if (this.ticks >= LIGHT) this.remove();
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
    new EnemyBullet(this.pos.x + 2.5, this.pos.y + 12);
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
    new ent.Timer().delay(WHITEOUT).run(() => {
      this.remove();
      this.wave.drop(this);
      new ent.Particle().xy(this.pos.x, this.pos.y).color(WHITE)
        .count(this.sprite.dots).size(6).speed(20, 50).spread(5).duration(0.5);
      return false;
    });
  }
}

/*
 * The formation. It owns its enemies rather than reading them back out of the
 * group, because it moves them itself: an enemy has no velocity of its own,
 * only a place in the pattern.
 */
class Wave extends ent.Entity {
  // Not begin(): the wave is built and pushed off its entry edge in the same
  // breath, and begin() runs a frame later.
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
          add(y, x * gap + (y % 2) * (gap / 2) - 496, 50 + y * dy);
        }
      }
    } else {
      const gap = BANDY / h;
      for (let y = 0; y < h; ++y) {
        for (let x = 0; x < w; ++x) {
          add(y, 15 + x * dx + this.strat.xmove(y, 0), -gap * y);
        }
      }
    }

    // Walked back off the entry edge, so the wave arrives rather than appears.
    if (across) {
      const max = Math.max(...this.all.map((e) => e.pos.x));
      if (max > 0) { for (const e of this.all) e.pos.x -= max + 100; }
    } else {
      const max = Math.max(...this.all.map((e) => e.pos.y));
      if (max > 0) { for (const e of this.all) e.pos.y -= max + 30; }
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
    const steps = 10 + this.ticker(this.ticks);

    // One bullet at a time from the whole wave. Reservoir sampling: each of the
    // n on screen gets the same 1/n chance without counting them first.
    const shoot = Math.random() < shooting * time * 2;
    let shooter = null;
    let seen = 0;

    for (const e of this.all) {
      for (let s = 0; s < steps; ++s) {
        const t = this.ticks + s * time / 10;
        e.pos.x += xmove(e.row, t) * time / 10;
        e.pos.y += ymove(t) * time / 10;
      }

      if (e.pos.x >= WRAPX) e.pos.x -= BANDX;
      if (!across) {
        if (e.pos.x <= -15) e.pos.x += BANDX;
        if (e.pos.y >= WRAPY) e.pos.y -= BANDY;
      }

      if (!shoot || e.pos.y <= 0) continue;
      seen += 1;
      if (shooter === null || Math.random() < 1 / seen) shooter = e;
    }

    this.ticks += this.ticker(this.ticks) * time / 10;
    shooter?.shoot();

    if (this.all.length > 0) return;
    this.remove();
    nextLevel();
  }
}

/*
 * A 5x4 blob, mirrored left to right, rerolled until it has enough lit pixels
 * to read at 30 units across. Every enemy in a wave wears the same one, and
 * the count is how many particles it comes apart into.
 */
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
  new ent.Timer().run(() => {
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
  msg(`WAVE ${waves + 1}`);

  new ent.Timer()
    .run(() => {
      energy = Math.min(100, energy + ent.game.time * 100 / FILL);
      return energy < 100;
    })
    .run(() => {
      wave = new Wave();
      return false;
    });
}

export function init() {
  ent.reset();
  ent.world(W);
  // Update order as much as draw order: ship moves its bullet, wave moves the
  // formation, then an enemy asks what it is touching.
  ent.order([
    Player,
    Wave,
    Enemy,
    EnemyBullet,
    Bullet,
    Light,
    ent.Particle,
    Bar,
    ent.Text,
  ]);

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
  // Entities first, then the scene: entity.js holds a hit by running a frame
  // at dt 0 rather than skipping it, which the drain below only sees by
  // running after.
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
