#!/usr/bin/env -S node

const GAME = process.env.GAME ?? "";

import "./src/one/lib/extend.js";
import fs from "fs";
import nunjucks from "nunjucks";
import puppeteer from "puppeteer-core";
import sharp from "sharp";
import lzma from "lzma";

import * as one from "./src/one/one.js";
const x = await import(`./src/${GAME}.js`);

const BASEURL = "https://one.fserb.com";

const data = {
  title: one.name,
  url: `${BASEURL}/${GAME}`,
  ogimage: `${BASEURL}/${GAME}/ogimage.png`,
  twitterimage: `${BASEURL}/${GAME}/twitterimage.png`,
  themecolor: one.C[one.opts.bgColor],
};

const script = fs.readFileSync(`www/${GAME}/bundle.js`);
const lzmad = fs.readFileSync('node_modules/lzma/src/lzma-d-min.js').toString()
  .replace('this.LZMA=this.LZMA_WORKER=e;', '');

const scriptenc = lzma.compress(script, 9);
const scriptb64 = Buffer.from(scriptenc).toString('base64');

const payload = `<script type="module">
const p=window.atob(\`${scriptb64}\`);
${lzmad}
const a = new Uint8Array(new ArrayBuffer(p.length)); for(let i = 0; i < p.length; i++) a[i] = p.charCodeAt(i);
e.decompress(a, res => { const s = document.createElement('script'); s.type = 'module'; s.innerText = res; document.body.appendChild(s); });
</script>`;

const base = fs.readFileSync('index.html').toString()
  .replace('<script type="module">import main from "./bundle.js";main();</script>', payload);

fs.writeFileSync(`www/${GAME}/index.html`, nunjucks.renderString(base, data));

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome"
});

const page = await browser.newPage();

await page.setViewport({width: 800, height: 800, deviceScaleFactor: 2});

const url = `https://dev.metaphora.co/games/one/www/${GAME}/index.html`;

await page.goto(url);
await page.click("#canvas");
await Promise.sleep(0.5);
const png = await page.screenshot({type: "png"});
await browser.close();

async function buildImage(name, width, height) {
  const obj = sharp(png);

  obj.resize(width, height, {
    fit: "contain",
    background: one.C[one.opts.bgColor]}).png().toFile(name);
}

await buildImage(`www/${GAME}/ogimage.png`, 1200, 627);
await buildImage(`www/${GAME}/twitterimage.png`, 1456, 728);