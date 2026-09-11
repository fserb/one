/*
 * entity_test.js - checks the step order and the draw passes in
 * src/lib/entity.js.
 *
 * begin() runs at the top of an entity's first frame, before its first
 * update(). What broke it: an entity made inside another's update() lands in a
 * group the step pass may not have reached, so it used to step the same frame
 * with begin() pending. The draw order decides who hits it, so the bug is silent
 * and flips when a game reorders its draw list. Hence a test, not a comment.
 *
 *   deno run --allow-read tools/entity_test.js     # or ./task test
 */

const noop = () => {};
const ctx = new Proxy({}, {
  get: (_, k) => (k === "canvas" ? { width: 512, height: 512 } : noop),
  set: () => true,
});
globalThis.OffscreenCanvas = class {
  constructor(w, h) {
    this.width = w;
    this.height = h;
  }
  getContext() {
    return ctx;
  }
};

const ent = await import("../src/lib/entity.js");

let fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${name}: ${JSON.stringify(got)}` +
      (ok ? "" : ` want ${JSON.stringify(want)}`),
  );
}

// Maker builds a Late inside its own update(), and Late draws after Maker, so
// the step pass reaches Late's group second.
function run(Late, frames = 3) {
  let made = false;
  class Maker extends ent.Entity {
    update() {
      if (made) return;
      made = true;
      new Late();
    }
  }
  ent.reset([Maker, Late]);
  new Maker();
  for (let f = 0; f < frames; ++f) {
    ent.update(1 / 60);
    ent.render(ctx);
  }
}

// The contract itself.
{
  const log = [];
  run(
    class extends ent.Entity {
      begin() {
        log.push("begin");
      }
      update() {
        log.push("update");
      }
    },
  );
  check("begin() before the first update()", log, ["begin", "update", "update"]);
}

// An entity that ends itself in that first update() used to get no begin() at
// all, being gone before the next begin() pass.
{
  const log = [];
  run(
    class extends ent.Entity {
      begin() {
        log.push("begin");
      }
      update() {
        log.push("update");
        this.remove();
      }
    },
  );
  check("begin() before a self-removing update()", log, ["begin", "update"]);
}

// A lifetime shorter than a frame still paints once. This is orbit's Flash:
// built whole in the constructor, no update(), ends itself in render().
// Holding it back from the step pass must not hold it off the screen.
{
  const draws = [];
  let n = 0;
  const Flash = class extends ent.Entity {
    render() {
      n++;
      this.remove();
    }
  };
  let made = false;
  class Maker extends ent.Entity {
    update() {
      if (made) return;
      made = true;
      new Flash();
    }
  }
  ent.reset([Maker, Flash]);
  new Maker();
  for (let f = 0; f < 3; ++f) {
    ent.update(1 / 60);
    ent.render(ctx);
    draws.push(n);
  }
  check("a sub-frame entity paints once, on its own frame", draws, [1, 1, 1]);
}

// Why the rule is order-independent: get(), one() and hitGroup() all hide an
// entity that has not begun, so for one frame it is in nobody's way.
{
  const seen = [];
  class Late extends ent.Entity {}
  let made = false;
  class Maker extends ent.Entity {
    update() {
      if (!made) {
        made = true;
        new Late();
      }
      seen.push(ent.get(Late).length);
    }
  }
  ent.reset([Maker, Late]);
  new Maker();
  for (let f = 0; f < 3; ++f) {
    ent.update(1 / 60);
    ent.render(ctx);
  }
  check("get() hides it for the frame it was made", seen, [0, 1, 1]);
}

// The same four with the groups the other way round: the case that used to
// pass by luck.
{
  const log = [];
  let made = false;
  class Late extends ent.Entity {
    begin() {
      log.push("begin");
    }
    update() {
      log.push("update");
    }
  }
  class Maker extends ent.Entity {
    update() {
      if (made) return;
      made = true;
      new Late();
    }
  }
  ent.reset([Late, Maker]);
  new Maker();
  for (let f = 0; f < 3; ++f) {
    ent.update(1 / 60);
    ent.render(ctx);
  }
  check("holds with the groups reversed", log, ["begin", "update", "update"]);
}

// A ctx that keeps the translation it is given, so a test can tell what
// transform a render() was called under, and what drew in what order.
function tracer() {
  const log = [];
  const stack = [];
  let tx = 0;
  return new Proxy({}, {
    get(_, k) {
      if (k === "canvas") return { width: 512, height: 512 };
      if (k === "log") return log;
      if (k === "tx") return tx;
      if (k === "save") return () => stack.push(tx);
      if (k === "restore") return () => (tx = stack.pop() ?? 0);
      if (k === "translate") return (x) => (tx += x);
      return noop;
    },
    set: () => true,
  });
}

// A screen class draws after the world whatever its layer says, and outside the
// shake. Top is first in the order list, so by layer alone it would be under
// World. No camera here, so the shake offset is what tells the two passes
// apart, and Math.random is pinned so it is the whole amplitude.
{
  const c = tracer();
  const rand = Math.random;
  Math.random = () => 1;
  class World extends ent.Entity {
    render() {
      c.log.push(`world ${c.tx !== 0}`);
    }
  }
  class Top extends ent.Entity {
    static screen = true;
    render() {
      c.log.push(`top ${c.tx !== 0}`);
    }
  }
  ent.reset([Top, World]);
  new Top();
  new World();
  ent.shake(0.4);
  ent.update(1 / 60);
  ent.render(c);
  Math.random = rand;
  check("a screen class draws last and outside the shake", c.log, [
    "world true",
    "top false",
  ]);
}

console.log(fail === 0 ? "\nall passed" : `\n${fail} failed`);
Deno.exit(fail === 0 ? 0 : 1);
