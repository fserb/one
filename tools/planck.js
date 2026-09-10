/*
 * planck.js - re-vendors src/lib/planck.js from npm, patched for tree-shaking.
 *
 * The dist pins all of Box2D whatever a game names: tsc's class IIFEs are
 * opaque to esbuild, and the serializer's type table holds every joint. Both
 * edits below are needed, either alone buys nothing, and a game has to import
 * `* as pl` rather than the default, which is a namespace object holding the
 * lot. Nothing here is written down in the vendored file itself.
 *
 * Every edit asserts its anchor: a planck that has moved this code stops here
 * rather than quietly writing an unpatched file.
 *
 *   ./task planck            # the newest planck on npm
 *   ./task planck 1.5.0      # a version
 *   ./task planck ./x.mjs    # a local dist
 */

const OUT = new URL("../src/lib/planck.js", import.meta.url);
const CDN = "https://unpkg.com/planck";

// `var X = (function() { ... })()` is a call esbuild cannot prove pure, so
// every class survives every import shape until it is told otherwise.
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
  // planck 1.5 has 68 of these; a handful means the dist has changed shape.
  if (n < 40) {
    throw new Error(
      `annotated ${n} of ${total} classes: the IIFE shape has changed`,
    );
  }
  return [lines.join("\n"), n, total];
}

// The deserialize table names every joint class, and two module-scope
// statements keep it reachable: it assigns to `_a`, a file-scope tsc temp, and
// the one Serializer instance sits beside its two static assignments.
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

const clean = raw.replace(/\n\/\/# sourceMappingURL=\S*\s*$/, "\n");
const [annotated, pure, classes] = pureClasses(clean);
await Deno.writeTextFile(OUT, freeJoints(annotated));

console.log(`  planck ${version}, ${pure} of ${classes} classes annotated`);
console.log(`  wrote src/lib/planck.js. now: ./task rebuild`);
