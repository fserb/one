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
import { delay } from "./lib/effects.js";
import { shake } from "./lib/camera.js";
import { gameOver, score } from "./lib/one.js";
import * as play from "./lib/sounds.js";

export { render } from "./lib/entity.js";

export const meta = {
  title: "hypermania",
  desc: `
arrows or the mouse move, space or a click shoots
the bar is the clock, and every shot spends it
`,
  bg: "#04a2fc",
  fg: "#024972",
  // The board is light enough that overlay.js would put black over it; white is
  // what the ship and the enemies are drawn in.
  overlay: "#ffffff",
  scoreMax: true,
  date: "2014-04-13",
  release: true,
  dpad: true,
};

const WHITE = 0xffffff;
const BLACK = 0x000000;
// meta.fg is PANEL too.
const PANEL = 0x024972;
const ORANGE = 0xe65205;

// The game's own bar, along the bottom.
const BARH = 105;
const BOT = 1024 - BARH;

// The gauge starts 87 in, where it sat when it was centred in the bar, and ends
// at 896 rather than 937: the panel past it is the total's, not spare room.
const EX = 87;
const EW = 809;
const EH = 26;

// Rests 60 above the bar, drops to 21 on the recoil, climbs back at 215.
const PY = BOT - 60;
// Never closer to a side than this.
const PX = 38;

// A shot leaves from above the ship whatever the recoil is doing.
const SHOTY = PY - 38;

// An enemy leaving one side is already in place at the other, wrapping 11 past
// the foot of the field.
const BANDX = 1024 + 64;
const BANDY = 917;

const COLS = 5;
const ROWS = 4;
const PIXEL = 13;

const WHITEOUT = 0.1;

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

// Extra substeps the formation takes this frame, on top of its ten: 20 is three
// times speed and -2 is four fifths of it.
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
// The ship is steered by the pointer until an arrow key is pressed, and by the
// keys until the pointer moves again. `lastx` is how a move is noticed.
let aiming = false;
let lastx = null;
let dying = 0;

// Score arrives in fractions while the bar is spent, and score.value is whole,
// so the fraction is kept here and only the whole part goes out.
let earned = 0;

function addScore(v) {
  earned += v;
  score.value = Math.floor(earned);
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
    // Frame and gauge in one entity: three rectangles a frame is cheap.
    const y = BOT + (BARH - EH) / 2 - this.pos.y;
    const left = Math.max(0, energy) / 100;
    this.gfx.clear()
      .fill(PANEL).rect(-512, -BARH / 2, 1024, BARH)
      .fill(0x011f30).rect(EX - 512, y, EW, EH)
      .fill(ORANGE).rect(EX - 512, y, EW * left, EH);
  }
}

// The running total, in the panel past the right end of the gauge. It grows
// leftwards off a right edge 24 short of the board's, so the digits already
// drawn do not shift when one is added, and six of them clear the gauge with
// room.
//
// It does not jump to the score: each second it closes twice the distance it is
// behind, and 20 a second when that is slower, so a kill rolls the last digits
// for a moment and a whole bar spent runs them for a couple of seconds after
// the spending stops.
class Total extends ent.Text {
  static screen = true;

  constructor() {
    super({
      text: "0",
      x: 1024 - 24,
      // 2 down: the text sits by its em box, and digits with no descender sit
      // high in it.
      y: BOT + BARH / 2 + 2,
      size: 26,
      color: ORANGE,
      align: "right middle",
    });
    this.visualScore = 0;
  }

  update() {
    const gap = score.value - this.visualScore;
    if (gap > 0) {
      const rate = Math.max(20, gap * 2);
      this.visualScore = Math.min(
        score.value,
        this.visualScore + rate * ent.game.time,
      );
    }
    this.text = String(Math.floor(this.visualScore));
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
    // On 6-unit cells, where an enemy's are 13.
    this.gfx.fill(WHITE).rects([
      [-6, -36, 12, 6],
      [-12, -30, 24, 6],
      [-18, -24, 36, 12],
      [-12, -12, 24, 6],
      [-6, -6, 12, 18],
      [-24, 0, 12, 36],
      [12, 0, 12, 36],
      [-24, 12, 48, 12],
    ]);
  }

  explode() {
    if (this.dead) return;
    this.bullet?.remove();
    this.remove();
    play.lose();
    new ent.Particle({
      x: this.pos.x,
      y: this.pos.y,
      color: WHITE,
      count: 80,
      size: 13,
      speed: [43, 107],
      duration: 1.5,
    });
    shake(1);
    dying = 0.4;
  }

  update() {
    const { input, time } = ent.game;
    this.pos.y = Math.max(PY, this.pos.y - 215 * time);

    // Flown from here, not from itself: steer while it climbs and it follows.
    if (this.bullet === null) {
      if (input.press.act) {
        play.shoot();
        this.bullet = new Bullet(this.pos.x);
        new Light(this.pos.x, SHOTY, true);
        energy -= 100 / 200;
        this.pos.y = BOT - 21;
      }
    } else {
      this.bullet.pos.x = this.pos.x;
      this.bullet.pos.y -= 1177 * time;
      // Its own height past the top edge, so the last of it is off the board.
      if (this.bullet.pos.y < -18) this.bullet.explode(false);
    }

    if (lastx !== null && input.x !== lastx) aiming = true;
    if (input.press.left || input.press.right) aiming = false;
    lastx = input.x;

    const step = 425 * time;
    if (input.press.left) this.pos.x -= step;
    else if (input.press.right) this.pos.x += step;
    else if (aiming) {
      // A place, not a direction: it stops under the pointer, and at the same
      // speed the keys walk it, so the mouse dodges no faster than the keys.
      const d = input.x - this.pos.x;
      this.pos.x += Math.abs(d) <= step ? d : Math.sign(d) * step;
    }
    this.pos.x = Math.min(1024 - PX, Math.max(PX, this.pos.x));
  }
}

class Bullet extends ent.Entity {
  constructor(x) {
    super();
    this.pos.x = x;
    this.pos.y = SHOTY;
    this.hitBox(12, 36);
    this.gfx.fill(WHITE).rect(-6, -18, 12, 36);
  }

  explode(hit) {
    player.combo = hit ? player.combo + 1 : 0;
    if (player.combo > 1) {
      new ent.Text({
        text: `x${player.combo}`,
        x: this.pos.x,
        y: this.pos.y,
        size: 40,
        color: ORANGE,
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
    this.gfx.fill(BLACK).rect(-6, -18, 12, 36);
    new Light(x, y, false);
  }

  update() {
    if (this.hit(player.bullet)) {
      shake(0.1);
      player.bullet.explode(true);
      // Shot down: white, held, and harmless on the way.
      this.clearHits();
      this.gfx.clear().fill(WHITE).rect(-4, -12, 8, 24);
      ent.after(WHITEOUT, () => this.remove());
      return;
    }

    if (this.hit(player)) player.explode();

    this.pos.y += 850 * ent.game.time;
    if (this.pos.y >= BOT + 21) this.remove();
  }
}

// One frame is 16ms on one screen and 8 on another, so it holds for 0.05s.
class Light extends ent.Entity {
  constructor(x, y, mine) {
    super();
    this.pos.x = x;
    this.pos.y = y;
    this.gfx.fill(mine ? 0xffffcc : BLACK).circle(0, 0, mine ? 26 : 17);
  }

  update() {
    if (this.age >= 0.05) this.remove();
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

  // One shape, since two cells filled separately leave a line along the join.
  draw(c) {
    const cells = [];
    for (let y = 0; y < ROWS; ++y) {
      for (let x = 0; x < COLS; ++x) {
        if (!this.sprite.pat[x + y * COLS]) continue;
        cells.push([
          (x - COLS / 2) * PIXEL,
          (y - ROWS / 2) * PIXEL,
          PIXEL,
          PIXEL,
        ]);
      }
    }
    this.gfx.clear().size(COLS * PIXEL, ROWS * PIXEL).fill(c).rects(cells);
  }

  shoot() {
    new EnemyBullet(this.pos.x + 5, this.pos.y + 26);
    play.shoot({ detune: -500 });
  }

  update() {
    if (this.exploding) return;

    if (this.hit(player)) {
      this.exploding = true;
      player.explode();
      this.remove();
      this.wave.drop(this);
      play.explode();
      return;
    }

    if (!this.hit(player.bullet)) return;

    this.exploding = true;
    this.draw(WHITE);
    play.explode();
    shake(0.2);
    delay(0.01);
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

// It owns its enemies rather than reading them back out of the group: an enemy
// has no velocity, only a place in the pattern.
class Wave extends ent.Entity {
  // Not begin(): the wave is built and pushed off its entry edge in one call.
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

    // Reservoir sampling: the same 1/n chance without counting them first.
    const shoot = Math.random() < shooting * time * 2;
    let shooter = null;
    let seen = 0;

    for (const e of this.all) {
      for (let s = 0; s < steps; ++s) {
        const t = this.age + s * time / 10;
        e.pos.x += xmove(e.row, t) * time / 10;
        e.pos.y += ymove(t) * time / 10;
      }

      if (e.pos.x >= 1024 + 32) e.pos.x -= BANDX;
      if (!across) {
        if (e.pos.x <= -32) e.pos.x += BANDX;
        if (e.pos.y >= BOT + 11) e.pos.y -= BANDY;
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
// legible at 65 across. The count is how many particles it comes apart into.
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

// Spend what is left of the bar, over 1.5s for a full one.
function nextLevel() {
  if (wave === null) return;
  waves += 1;
  wave = null;

  let beat = 0;
  ent.every(0, () => {
    const was = energy;
    energy = Math.max(1, energy - ent.game.time * 100 / 1.5);
    addScore(waves * 2 * (was - energy));

    beat -= ent.game.time;
    if (beat <= 0) {
      play.blip();
      beat += 0.1;
    }

    if (energy > 1) return true;
    beginLevel();
    return false;
  });
}

function beginLevel() {
  if (energy <= 0) energy = 1;
  play.power();

  ent.every(0, () => {
    energy = Math.min(100, energy + ent.game.time * 100 / 0.75);
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
  earned = 0;
  dying = 0;
  aiming = false;
  lastx = null;

  new Bar();
  new Total();
  player = new Player();
  beginLevel();
}

export function update(dt) {
  // Entities first: entity.js holds a hit by running a frame at dt 0, which
  // the drain below only sees by running after.
  ent.update(dt);

  if (dying > 0) {
    dying -= dt;
    if (dying <= 0) gameOver({ score: true });
    return;
  }

  // Between waves the bar is being spent or refilled, and the drain is off.
  if (wave === null) return;

  energy -= ent.game.time * 100 / 120; // a full bar is two minutes unspent
  if (energy <= 0) player.explode();
}
