/*
 * record.js - records a game's gallery clip with random input in place of a
 * player.
 *
 * It serves this directory, opens dev.html?game=<name> in headless Chrome over
 * CDP and calls src/dev/rec.js's rec.auto(). The zip is sent back over CDP and
 * written into ~/Downloads under the name the rec button would have used, so
 * `./task media` reads it without knowing the difference.
 *
 * A name is a file in src/, so an idea records as `_<name>`, and its zip and
 * its media/ directory keep the underscore.
 *
 * src/dev/play.js plays it: random held directions, a travelling pointer and
 * clicks, and no knowledge of the game. A take it never moved, and one whose
 * round ended early, are listed at the end to record by hand.
 */

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const CHROME = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];
// Big enough that the canvas is at least the 1024 box the games draw in, so the
// 512 frames are a downscale and never an upscale.
const WINDOW = 1100;
const TIMEOUT = 90; // seconds one game gets, countdown and take included

const TYPES = {
  html: "text/html",
  js: "text/javascript",
  css: "text/css",
  json: "application/json",
  png: "image/png",
  mp4: "video/mp4",
  svg: "image/svg+xml",
};

const MIME = (path) => TYPES[path.split(".").pop()] ?? "application/octet-stream";

function isFile(path) {
  try {
    return Deno.statSync(path).isFile;
  } catch {
    return false;
  }
}

// dev.html needs a server: it loads the games as ES modules, which file://
// does not allow. Files only, and no listing, since ?game= needs none.
function serve() {
  const server = Deno.serve(
    { port: 0, hostname: "127.0.0.1", onListen: () => {} },
    async (req) => {
      const path = decodeURIComponent(new URL(req.url).pathname);
      if (path.includes("..")) return new Response("no", { status: 403 });
      try {
        const file = await Deno.open(ROOT + (path === "/" ? "/dev.html" : path));
        return new Response(file.readable, {
          headers: { "content-type": MIME(path) },
        });
      } catch {
        return new Response("not found", { status: 404 });
      }
    },
  );
  return { port: server.addr.port, stop: () => server.shutdown() };
}

async function chrome() {
  const bin = CHROME.find(isFile);
  if (!bin) throw new Error(`no chrome in:\n  ${CHROME.join("\n  ")}`);

  const dir = Deno.makeTempDirSync({ prefix: "one-record-" });
  const proc = new Deno.Command(bin, {
    args: [
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${dir}`,
      `--window-size=${WINDOW},${WINDOW}`,
      "--hide-scrollbars",
      "--mute-audio",
      "--use-mock-keychain",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "about:blank",
    ],
    stdout: "null",
    stderr: "null",
  }).spawn();

  // Port 0 means Chrome picks one and writes it here, once it is listening.
  const portFile = `${dir}/DevToolsActivePort`;
  let port = null;
  for (let i = 0; i < 200 && port === null; i++) {
    await new Promise((r) => setTimeout(r, 50));
    try {
      port = Number(Deno.readTextFileSync(portFile).split("\n")[0]);
    } catch { /* not up yet */ }
  }
  if (!port) throw new Error("chrome never opened a debugging port");

  return {
    port,
    kill: () => {
      try {
        proc.kill("SIGKILL");
      } catch { /* already gone */ }
      // Chrome is still writing its profile out as it exits, and a directory
      // left in /tmp is not worth failing the run over.
      try {
        Deno.removeSync(dir, { recursive: true });
      } catch { /* it goes with the next reboot */ }
    },
  };
}

// The page's CDP socket: send() returns one command's result.
async function connect(port) {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = list.find((t) => t.type === "page");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error("cdp socket refused"));
  });

  let id = 0;
  const open = new Map();
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    const call = open.get(msg.id);
    if (!call) return; // an event nothing here listens for
    open.delete(msg.id);
    if (msg.error) call.rej(new Error(msg.error.message));
    else call.res(msg.result);
  };

  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      open.set(++id, { res, rej });
      ws.send(JSON.stringify({ id, method, params }));
    });

  return { send, close: () => ws.close() };
}

// Any throw inside the page comes back as one here.
async function record(cdp, url, game) {
  await cdp.send("Page.navigate", { url: `${url}/dev.html?game=${game}` });

  const ready = await evaluate(
    cdp,
    `new Promise((res) => {
      const t = setInterval(() => {
        if (!window.rec) return;
        clearInterval(t);
        res("ok");
      }, 50);
      setTimeout(() => res("timeout"), 15000);
    })`,
  );
  if (ready !== "ok") throw new Error("dev.html never loaded the recorder");

  return await evaluate(cdp, "window.rec.auto()", TIMEOUT * 1000);
}

async function evaluate(cdp, expression, timeout = 20000) {
  const call = cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  // Cleared whichever way the race goes: a pending timer is a minute added to a
  // run that has already finished, since Deno drains the event loop first.
  let timer = null;
  const late = new Promise((_, rej) => {
    timer = setTimeout(
      () => rej(new Error("the page did not answer in time")),
      timeout,
    );
  });
  let res;
  try {
    res = await Promise.race([call, late]);
  } finally {
    clearTimeout(timer);
  }
  if (res.exceptionDetails) {
    throw new Error(res.exceptionDetails.exception?.description ?? "page threw");
  }
  return res.result.value;
}

function write(take) {
  const bytes = Uint8Array.from(atob(take.zip), (c) => c.charCodeAt(0));
  const path = `${Deno.env.get("HOME")}/Downloads/${take.file}`;
  Deno.writeFileSync(path, bytes);
  return path;
}

// The name is a file in src/, since dev.html imports src/<name>.js: without
// this the page throws on a module that is not there, window.rec never appears
// and the wait below reports a page that loaded nothing.
function missingSource(game) {
  if (isFile(`${ROOT}/src/${game}.js`)) return null;
  return `no src/${game}.js`;
}

// A card recorded by hand is better than anything this can record, so with no
// game named it never replaces one.
function missing() {
  return [...Deno.readDirSync(`${ROOT}/src`)]
    .filter((e) => e.isFile && e.name.endsWith(".js") && !e.name.startsWith("_"))
    .map((e) => e.name.slice(0, -3))
    .filter((game) => !isFile(`${ROOT}/media/${game}/card.mp4`))
    .sort();
}

const names = Deno.args.length > 0 ? Deno.args : missing();
const web = serve();
const url = `http://127.0.0.1:${web.port}`;
const browser = await chrome();
const cdp = await connect(browser.port);

const idle = []; // nothing moved, with the random input running
const short = []; // the round ended before the take did
let failed = 0;
const out = new TextEncoder();
for (const [i, game] of names.entries()) {
  const count = names.length > 1 ? `[${i + 1}/${names.length}] ` : "";
  // The name goes out before the take, not after it: a take runs twelve
  // seconds, and the rest of its line lands once it is done.
  Deno.stdout.writeSync(out.encode(`${count}${game}`.padEnd(count.length + 12)));
  try {
    const gone = missingSource(game);
    if (gone) throw new Error(gone);
    const take = await record(cdp, url, game);
    if (!take.zip) {
      idle.push(game);
      console.log("nothing moved under the random input");
      continue;
    }
    // A take is short only when the round ended inside it, and what was
    // dropped was the frozen finish screen.
    const secs = take.frames / take.fps;
    if (secs < 1) {
      short.push(game);
      console.log(`${secs.toFixed(1)}s: the round ended at once`);
      continue;
    }
    if (take.frames < take.full) short.push(game);
    const path = write(take);
    const pct = Math.round(take.moved * 100);
    console.log(
      `${secs.toFixed(1)}s` +
        `${pct < 90 ? ` · ${pct}% moving` : ""} · ${path.split("/").pop()}`,
    );
  } catch (err) {
    failed++;
    console.log(err.message.split("\n")[0]);
  }
}

cdp.close();
browser.kill();
await web.stop();

const hand = [...idle, ...short];
if (hand.length > 0) {
  console.log(
    `\nworth a take by hand: ${hand.join(" ")}\n` +
      `  dev.html?game=${hand[0]}, press r, and play it`,
  );
}
if (failed > 0) Deno.exit(1);
