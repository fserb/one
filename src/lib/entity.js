/*
 * entity.js - the entity model the vault micro-games are written against.
 *
 * ~/prj/vault/games/sketch/src is 20 single-file games on `ugl`, a
 * retained-mode framework. This is the same model over one.js's immediate
 * mode: an entity registers itself when constructed, and update() walks the
 * groups in draw order once a frame.
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
 * export function init() { ent.reset(); new Enemy(); }
 * export function update(dt) { ent.update(dt); }
 * export function render(ctx) { ent.render(ctx); }
 * ```
 *
 * This file is two `export *` lines. Behind them:
 *
 *   core.js   the groups, the frame, and Entity
 *   hit.js    the overlap tests, which read only `pos` and `angle`
 *   props.js  Text, Particle and Timer, the entities that come with the model
 */

export * from "./core.js";
export * from "./props.js";
