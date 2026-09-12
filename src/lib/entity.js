/*
 * entity.js - the entity model the micro-games are written against. An entity
 * registers itself when constructed, and update() walks the groups in draw
 * order once a frame.
 *
 * A game imports this and never the two files behind it:
 *
 *   core.js   the groups, the frame, and Entity
 *   props.js  Text, Particle and the two clocks
 *
 * update(dt) and render(ctx) already have one.js's signatures, so a game that
 * adds nothing of its own re-exports them rather than wrapping them.
 */

export * from "./core.js";
export * from "./props.js";
