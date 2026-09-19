# One Tiny Game

This is [One Tiny Game](https://one.fserb.com).

This repo contains the full source code of all games and the shared library.

I spent between 1 and 3 days on each game.

A game is one file. `src/<game>.js` exports `meta`, `init()`, `update(dt)` and
`render(ctx)`, and draws on a 1024x1024 canvas.

`src/lib/` is the shared code: the frame loop, input, the score and the game-over
screen, entities, sound. `src/alma` is a symlink to
[alma](https://github.com/fserb/alma), a JS game library.
