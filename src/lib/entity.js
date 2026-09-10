/*
 * entity.js - the entity model the micro-games are written against.
 *
 * A retained-mode model over one.js's immediate mode: an entity registers
 * itself when constructed, and update() walks the groups in draw order once a
 * frame.
 *
 * A game wires it into the three exports one.js calls:
 *
 * ```js
 * import * as ent from "./lib/entity.js";
 *
 * class Enemy extends ent.Entity {
 *   begin() { this.pos.x = 100; this.art.size(5).color(0xe11c57).circle(3, 3, 3); }
 *   update() { this.vel.y += 10 * ent.game.time; }
 * }
 *
 * export function init() { ent.reset([Enemy, ent.Particle]); new Enemy(); }
 * export { render, update } from "./lib/entity.js";
 * ```
 *
 * reset() takes the draw order, bottom first, and starts the round: it clears
 * the last one's entities and its clock and sets the 480 box back.
 *
 * update(dt) and render(ctx) here already have one.js's signatures, so a game
 * that adds nothing of its own re-exports them rather than wrapping them.
 *
 * This file is two `export *` lines. Behind them:
 *
 *   core.js   the groups, the frame, and Entity
 *   props.js  Text, Particle and the two clocks, the props that come with it
 */

export * from "./core.js";
export * from "./props.js";
