/*
 * entity_test.js - checks the step order in src/lib/entity.js.
 *
 * begin() runs at the top of an entity's first frame, before its first
 * update(). What broke it: an entity made inside another's update() lands in a
 * group the step pass may not have reached, so it used to step the same frame
 * with begin() pending. ent.order() decides who hits it, so the bug is silent
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
  ent.reset();
  let made = false;
  class Maker extends ent.Entity {
    update() {
      if (made) return;
      made = true;
      new Late();
    }
  }
  ent.order([Maker, Late]);
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
  ent.reset();
  let made = false;
  class Maker extends ent.Entity {
    update() {
      if (made) return;
      made = true;
      new Flash();
    }
  }
  ent.order([Maker, Flash]);
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
  ent.reset();
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
  ent.order([Maker, Late]);
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
  ent.reset();
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
  ent.order([Late, Maker]);
  new Maker();
  for (let f = 0; f < 3; ++f) {
    ent.update(1 / 60);
    ent.render(ctx);
  }
  check("holds with the groups reversed", log, ["begin", "update", "update"]);
}

console.log(fail === 0 ? "\nall passed" : `\n${fail} failed`);
Deno.exit(fail === 0 ? 0 : 1);
