One Tiny Game
=============

This is [One Tiny Game](https://one.fserb.com).

This repo contains the full source code of all games, the supporting library,
and the build tools to generate the final files.

I spend between 1 and 3 days on each game. The code is often hacky, ugly, and
sometimes obscure. I would have a hard time re-reading it, which I seldom do.

Files on `src/one/lib` are completely independent of the framework code,
are of a better quality, and can be easily reused elsewhere.

The release for each game contains a 800x800 screenshot, the base images for
Twitter and OpenGraph, and a single html file that is completely self-sufficient
to run the game.

This html file contains the minified LZMA-compressed base64 bundled code, and an
snippet of code that LZMA decompresses and runs. In theory the compression
is redundant and wasteful, as most static pages are gzip-ed by HTTP, so I may
remove this in the future. Meanwhile, this generates a very small final file
(between 20k and 80k bytes, at the time I'm writing this).
