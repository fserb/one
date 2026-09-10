/*
 * planck.js - re-vendors src/lib/planck.js from npm, patched for tree-shaking.
 *
 * planck ships one 400KB dist/planck.mjs holding all of Box2D, and a game
 * wants a handful of names out of it. Two things stop esbuild dropping the
 * rest, and each is worth almost nothing without the other, which is why both
 * are here: pureClasses() marks the class IIFEs tsc leaves opaque, and
 * freeJoints() cuts the two module-scope statements that hold the serializer's
 * type table, which names every joint. The patched file's header says the same
 * at more length.
 *
 * Every edit asserts what it expected to find. A planck release that has moved
 * this code should stop here rather than quietly ship an unpatched file, so a
 * failure means read the new dist and fix the anchor, not work around it.
 *
 * Nothing is written until the patched file has run a rigid-body sim to the
 * same nine decimal places as the file it came from, and round-tripped the
 * serializer that the second edit moves. What it saves is what `./task build`
 * prints afterwards; this script does not weigh anything itself.
 *
 *   ./task planck            # the newest planck on npm
 *   ./task planck 1.5.0      # a version
 *   ./task planck ./x.mjs    # a file, for a dist that is not on npm yet
 */

const OUT = new URL("../src/lib/planck.js", import.meta.url);
const CDN = "https://unpkg.com/planck";

/*
 * The two edits. Each returns the new source, and each throws rather than
 * return source it did not change in the way it meant to.
 */

// tsc downlevels a class to `var X = (function() { ... })()`, and esbuild
// cannot prove a call is side-effect free, so every class survives every
// import shape until it is told otherwise. Seven of them ship annotated
// already; this is the rest.
function pureClasses(src) {
  const lines = src.split("\n");
  let n = 0;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i - 1].trim() !== "/** @class */") continue;
    if (!lines[i].startsWith("  (function(")) continue;
    lines[i] = `  /* @__PURE__ */ ${lines[i].slice(2)}`;
    n++;
  }
  const total = src.split("/** @class */").length - 1;
  // planck 1.5 has 68 of these. A dist that annotates a handful has changed
  // shape, and the count is the only thing that says so before the build does.
  if (n < 40) {
    throw new Error(
      `annotated ${n} of ${total} classes: the IIFE shape has changed`,
    );
  }
  return [lines.join("\n"), n, total];
}

// The serializer's deserialize table names all fourteen joint classes, and two
// module-scope statements keep it reachable: the table assigns to `_a`, a
// file-scope tsc temp, and the one Serializer instance is built beside its two
// static assignments. Give the table its own `_a` and move the instance inside
// the Serializer IIFE, and the whole serializer drops when nothing calls it.
function freeJoints(src) {
  const table = src.match(
    /var DESERIALIZE_BY_TYPE_FIELD = (\(_a = \{\},[\s\S]*?_a\));\n/,
  );
  if (table === null) throw new Error("no DESERIALIZE_BY_TYPE_FIELD = (_a = ");
  src = src.replace(
    table[0],
    "var DESERIALIZE_BY_TYPE_FIELD = /* @__PURE__ */ (function() {\n" +
      "  var _a;\n" +
      `  return ${table[1]};\n` +
      "})();\n",
  );

  const from = `    return Serializer2;
  })()
);
var worldSerializer = new Serializer({
  rootClass: World
});
Serializer.fromJson = worldSerializer.fromJson;
Serializer.toJson = worldSerializer.toJson;
`;
  const to = `    var worldSerializer = new Serializer2({
      rootClass: World
    });
    Serializer2.fromJson = worldSerializer.fromJson;
    Serializer2.toJson = worldSerializer.toJson;
    return Serializer2;
  })()
);
`;
  return replaceOnce(src, from, to, "the worldSerializer block");
}

function replaceOnce(src, from, to, what) {
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`found ${what} ${n} times, wanted 1`);
  return src.replace(from, to);
}

/*
 * What the patch has to leave alone: bodies, both shapes, two joints and the
 * AABB query, reported to nine decimals. planck is deterministic, so any drift
 * at all is the patch's doing.
 */
function sim(pl) {
  const world = pl.World({ gravity: pl.Vec2(0, -10) });
  const ground = world.createBody({ type: "static", position: pl.Vec2(0, 0) });
  ground.createFixture(pl.Box(20, 0.5), { friction: 0.4 });

  const bodies = [];
  for (let i = 0; i < 12; i++) {
    const b = world.createBody({
      type: "dynamic",
      position: pl.Vec2(i * 0.4 - 2, 4 + i * 0.9),
    });
    const shape = i % 2 ? pl.Circle(pl.Vec2(0, 0), 0.3) : pl.Box(0.3, 0.3);
    b.createFixture(shape, { density: 1, friction: 0.3, restitution: 0.2 });
    bodies.push(b);
  }
  for (let i = 1; i < bodies.length; i++) {
    world.createJoint(pl.RopeJoint({
      bodyA: bodies[i - 1],
      bodyB: bodies[i],
      localAnchorA: pl.Vec2(0, 0),
      localAnchorB: pl.Vec2(0, 0),
      maxLength: 0.8,
    }));
  }
  world.createJoint(pl.DistanceJoint({
    bodyA: ground,
    bodyB: bodies[0],
    localAnchorA: pl.Vec2(0, 3),
    localAnchorB: pl.Vec2(0, 0),
    length: 2,
  }));

  for (let i = 0; i < 600; i++) world.step(1 / 60, 8, 3);

  let found = 0;
  world.queryAABB(pl.AABB(pl.Vec2(-30, -30), pl.Vec2(30, 30)), () => {
    found++;
    return true;
  });

  // The serializer is what the second edit moves, so it is checked here too.
  const json = pl.Serializer.toJson(world);
  const back = pl.Serializer.fromJson(json);

  return JSON.stringify({
    found,
    json: JSON.stringify(json).length,
    back: back.getBodyList().getPosition().x,
    bodies: bodies.map((b) => [
      b.getPosition().x.toFixed(9),
      b.getPosition().y.toFixed(9),
      b.getAngle().toFixed(9),
    ]),
  });
}

// One line per paragraph, because a substitution changes the length and the
// header is wrapped after it is filled in. A paragraph opening with "- " gets
// the hanging indent.
const HEADER = [
  "planck.js v{{version}} - Erin Catto's Box2D, ported to JS by Ali Shakiba.",
  "MIT. https://github.com/piqnt/planck.js",
  "",
  "Vendored, not a package: alma has no rigid-body physics. Patched so a bundler can drop what a game does not name, which the dist as shipped makes impossible.",
  "",
  "Do not edit this file. It is dist/planck.mjs from npm, minus the trailing sourceMappingURL comment, with the patch below applied by `./task planck`. Re-run that to upgrade: it re-applies the patch, checks the physics against the file it came from, and writes nothing it could not match.",
  "",
  "Import `* as pl`, never the default. The default export is a frozen namespace object holding every class, so it pins the whole library whatever a game names. Through the namespace esbuild resolves `pl.World` to a direct reference, and a game that builds a world and steps it carries no joint it never built and no serializer at all.",
  "",
  "Two things stop esbuild dropping what a game never names, and neither pays without the other:",
  "",
  "- tsc downlevels every class to `var X = (function() { ... })()`, a call esbuild cannot prove is side-effect free, so it keeps all {{classes}} of them whatever the import shape. {{pure}} of them carry esbuild's @__PURE__ annotation now; the rest shipped with it.",
  "",
  "- the serializer's deserialize table names every joint and shape class, and two module-scope statements hold it. The table is built as a comma expression assigning to `_a`, a file-scope tsc temp, and the one `worldSerializer` is built beside the two static assignments that carry its methods onto `Serializer`. The table now builds in a pure IIFE over a local `_a`, and worldSerializer and its assignments moved inside the Serializer IIFE, where they drop with it. Same order of evaluation, same public API.",
  "",
  "What a world still pulls is reachable from `World` itself, or from the `Contact.addType` calls that register edge and chain collision at module scope. Deleting those four lines would take EdgeShape and ChainShape with them and silently give no collisions to any game that builds one, so they stay.",
  "",
  "Excluded from deno fmt and lint in deno.json, like src/lib/fsfx.",
];

// The 79 columns the rest of src/lib holds to.
const COLS = 79;

function wrap(text, first, rest) {
  const out = [];
  let prefix = first;
  let line = null;
  for (const word of text.split(/\s+/)) {
    if (line === null) {
      line = prefix + word;
      continue;
    }
    if (line.length + 1 + word.length <= COLS) {
      line += ` ${word}`;
      continue;
    }
    out.push(line);
    prefix = rest;
    line = prefix + word;
  }
  return line === null ? out : [...out, line];
}

function comment(paragraphs) {
  const out = ["/*"];
  for (const p of paragraphs) {
    if (p === "") {
      out.push(" *");
      continue;
    }
    const lines = p.startsWith("- ")
      ? wrap(p.slice(2), " * - ", " *   ")
      : wrap(p, " * ", " * ");
    out.push(...lines);
  }
  return `${[...out, " */"].join("\n")}\n`;
}

function fill(paragraphs, vars) {
  return paragraphs.map((p) =>
    p.replace(/\{\{(\w+)\}\}/g, (_, name) => {
      if (!(name in vars)) throw new Error(`template has no ${name}`);
      return vars[name];
    })
  );
}

async function upstream(arg) {
  if (arg !== undefined && !/^\d/.test(arg)) {
    return [await Deno.readTextFile(arg), arg];
  }
  const url = `${CDN}@${arg ?? "latest"}/dist/planck.mjs`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return [await res.text(), res.url];
}

const [raw, from] = await upstream(Deno.args[0]);
console.log(`  ${from}`);

const version = raw.match(/Planck\.js v([\d.]+)/)?.[1];
if (version === undefined) throw new Error("no version banner in the dist");

// The map is not vendored, so the comment pointing at it is noise.
const clean = raw.replace(/\n\/\/# sourceMappingURL=\S*\s*$/, "\n");

const [annotated, pure, classes] = pureClasses(clean);
const patched = freeJoints(annotated);

const dir = await Deno.makeTempDir();
const plain = `${dir}/plain.mjs`;
const fixed = `${dir}/fixed.mjs`;
await Deno.writeTextFile(plain, clean);
await Deno.writeTextFile(fixed, patched);

const before = sim(await import(`file://${plain}`));
const after = sim(await import(`file://${fixed}`));
await Deno.remove(dir, { recursive: true });
if (before !== after) {
  throw new Error(`the patch moved the physics:\n${before}\n${after}`);
}

await Deno.writeTextFile(
  OUT,
  comment(fill(HEADER, { version, classes, pure })) + patched,
);

console.log(`  planck ${version}, ${pure} of ${classes} classes annotated`);
console.log(`  600 steps, both shapes, both joints: identical to 9 decimals`);
console.log(`  wrote src/lib/planck.js. now: ./task rebuild`);
