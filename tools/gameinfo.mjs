const GAME = process.argv[2];

// this is the ugliest of the hacks. TS hates it, and so do we.
// We import the actual game, to populate its BG colors.
import {opts} from "../src/one/internal.js";
// @ts-ignore
global.window = new Proxy({}, {get: function() { return function() {} }});
// @ts-ignore
global.Path2D = class Path2D { constructor() { return new Proxy({}, {get: function() { return function() {} }})}};
// @ts-ignore
const x = await import(`../src/${GAME}.js`);

export {GAME, opts};
