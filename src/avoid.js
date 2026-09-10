/*
 * avoid - a port of ~/prj/vault/games/sketch/src/Avoid.hx.
 * Based on Aba Games' Satellite Catch.
 *
 * The Haxe never cleared an entity's art before redrawing, so a shrinking enemy
 * left its old outline behind and the list grew without bound. This clears
 * first.
 */

import * as ent from "./lib/entity.js";
import { gameOver, hint, score } from "./lib/one.js";

export const meta = {
  title: "avoid",
  desc: `
graze the red to score
touching it costs you size
`,
  bg: "#464248",
  fg: "#E1B81F",
  scoreMax: true,
  date: "2014-03-30",
};

const GOLD = 0xe1b81f;
const GOLD_DARK = 0xa37d1d;
const RED = 0xe11c57;
const RED_DARK = 0x861034;

class Enemy extends ent.Entity {
  begin() {
    this.size = 7 + Math.random() * 15;
    this.tv = 0;
    this.tads = 0;
    this.art.size(5).color(RED, RED_DARK, 23);
    this.draw();
    this.pos.x = 480 * Math.random();
    this.pos.y = 480 * Math.random();
  }

  draw() {
    const r = this.size / 5;
    this.art.clear().circle(r, r, r);
  }

  update() {
    this.tv += ent.game.time;

    const player = ent.one(Player);
    if (player === null) return;

    // Towards the player, harder the longer the round has run and the bigger
    // either of them is.
    const dx = player.pos.x - this.pos.x;
    const dy = player.pos.y - this.pos.y;
    const d = Math.hypot(dx, dy);
    if (d > 0) {
      const k = Math.sqrt(ent.game.totalTime * 0.00002) * this.size *
        Math.min(1, this.tv) * player.size * 7 / d;
      this.vel.x += dx * k;
      this.vel.y += dy * k;
    }
    this.vel.x *= 0.95;
    this.vel.y *= 0.95;

    // Points accrue while close without touching, so a near miss pays.
    const gap = d - this.size - player.size;
    const ads = Math.trunc((this.size + player.size) * 2 / (gap + 0.1));
    if (ads > 0) this.tads += ads;
    else this.cash();

    const s = 100;
    if (
      this.pos.x < -s || this.pos.y < -s ||
      this.pos.x > 480 + s || this.pos.y > 480 + s
    ) {
      this.cash();
      this.remove();
      return;
    }

    if (d < this.size + player.size) {
      this.cash();
      player.chit(this.size);
      this.remove();
      burst(RED, this.pos, Math.hypot(this.vel.x, this.vel.y) / 10);
      return;
    }

    // The bigger of two touching enemies eats the smaller and its points.
    for (const e of ent.get(Enemy)) {
      if (e === this || e.dead) continue;
      if (
        Math.hypot(this.pos.x - e.pos.x, this.pos.y - e.pos.y) > this.size + e.size
      ) continue;

      if (this.size > e.size) {
        burst(RED, e.pos, Math.hypot(e.vel.x, e.vel.y) / 3);
        this.size -= e.size;
        this.tads += e.tads;
        this.draw();
        e.remove();
      } else {
        burst(RED, this.pos, Math.hypot(this.vel.x, this.vel.y) / 3);
        e.size -= this.size;
        e.tads += this.tads;
        e.draw();
        this.remove();
        return;
      }
    }
  }

  cash() {
    if (this.tads <= 0) return;
    new ent.Text()
      .text(`+${this.tads}`)
      .duration(1)
      .xy(this.pos.x, this.pos.y)
      .move(0, -20);
    score.value += this.tads;
    this.tads = 0;
  }
}

class Player extends ent.Entity {
  begin() {
    this.size = 25;
    this.pos.x = this.pos.y = 240;
    this.art.size(3).color(GOLD, GOLD_DARK, 32);
    this.draw();
  }

  draw() {
    const r = this.size / 3;
    this.art.clear().circle(r, r, r);
  }

  update() {
    this.pos.x = ent.game.mouse.x;
    this.pos.y = ent.game.mouse.y;
    this.size += ent.game.time;
    this.draw();
  }

  chit(s) {
    this.size -= s;
    if (this.size > 0) return;
    new ent.Particle()
      .color(GOLD)
      .xy(this.pos.x, this.pos.y)
      .count(150)
      .size(5, 9)
      .delay(0)
      .duration(5)
      .speed(Math.hypot(this.vel.x, this.vel.y) / 10, 50);
    gameOver({ score: true });
  }
}

function burst(color, pos, speed) {
  new ent.Particle()
    .color(color)
    .xy(pos.x, pos.y)
    .count(100, 20)
    .size(7, 5)
    .delay(0)
    .duration(0.5)
    .speed(speed, 100);
}

export function init() {
  hint(meta.desc);
  ent.reset();
  ent.world(480);
  ent.order([Enemy, Player, ent.Particle, ent.Text]);

  new Player();
  new ent.Timer().every(1.5).run(() => {
    new Enemy();
    return true;
  });
}

export function update(dt) {
  ent.update(dt);
}

export function render(ctx) {
  ent.render(ctx);
}
