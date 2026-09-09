/*
 * entity_test.js - checks the step order in src/lib/entity.js.
 *
 * entity.js promises that begin() runs at the top of an entity's first frame
 * and before its first update(). The case that broke it is an entity made
 * inside another entity's update(): it lands in a group the step pass may not
 * have reached, so it used to be stepped the same frame with begin() still
 * pending. Which entities hit it is decided by ent.order(), so it is silent
 * and it flips when a game reorders its draw list, which is why it is a test
 * and not a comment.
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

// A game in one line: Maker builds a Late inside its own update(), and Late
// draws after Maker, so Late's group is the one the step pass reaches second.
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

// The sharp end of it: an entity that ends itself in that first update() used
// to get no begin() at all, because it was gone before the next begin() pass.
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

// A lifetime shorter than a frame still paints, once, on the frame it was
// made. This is orbit's Flash: built whole in the constructor, no update() at
// all, and it ends itself in render(). Holding it back from the step pass must
// not hold it back from the screen.
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

// The other half of the same rule, and the reason it is order-independent:
// get(), one() and hitGroup() all hide an entity that has not begun, so for
// one frame a new entity is in no group's way and steps for nobody.
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

// Nothing above depends on the draw order, so the same four hold with the
// groups the other way round, which is the case that used to pass by luck.
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
