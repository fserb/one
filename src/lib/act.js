/*
 * act.js - alma's Act, the tween track one.js advances once a frame and clears
 * when a round starts or ends.
 *
 * Opt-in, like camera.js and sound.js, and for the same reason: Act.js reaches
 * ease.js through a namespace import, so it never tree-shakes and naming it
 * costs 2.5 KB. Six games tween and twenty-one do not.
 *
 * alma's docs are the reference for attr/tween/delay/then/until/waitFor.
 */

import Act from "../alma/src/Act.js";
import { op } from "./one.js";

export const act = new Act();

op.act = act; // how one.js advances it without importing this module
