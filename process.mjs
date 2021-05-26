#!/usr/bin/env -S node

import "./src/one/lib/extend.js";
import fs from "fs";
import nunjucks from "nunjucks";
import puppeteer from "puppeteer-core";
import sharp from "sharp";
import lzma from "lzma";

const GAME = process.env.GAME ?? "";

// this is the ugliest of the hacks. TS hates it, and so do it.
// We import the actual game, to populate its BG colors.
import {opts, C} from "./src/one/internal.js";
// @ts-ignore
global.window = new Proxy({}, {get: function() { return function() {} }});
// @ts-ignore
global.Path2D = class Path2D { constructor() { return new Proxy({}, {get: function() { return function() {} }})}};
// @ts-ignore
const x = await import(`./src/${GAME}.js`);

const BASEURL = "https://one.fserb.com";

async function takeScreenshots(game) {
  const browser = await puppeteer.launch({
    executablePath: "/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome"
  });

  const page = await browser.newPage();

  await page.setViewport({width: 800, height: 800, deviceScaleFactor: 2});

  const url = `https://dev.metaphora.co/games/one/www/${game}/index.html`;

  await page.goto(url);
  await page.click("#canvas");
  await Promise.sleep(1.5);
  const png = await page.screenshot({type: "png"});
  await browser.close();

  async function buildImage(name, width, height) {
    // @ts-ignore
    const obj = sharp(png);

    obj.resize(width, height, {
      fit: "contain",
      background: C[opts.bgColor]}).png().toFile(name);
  }

  await buildImage(`www/${game}/ogimage.png`, 1200, 627);
  await buildImage(`www/${game}/twitterimage.png`, 1456, 728);
  await buildImage(`www/${game}/base.png`, 800, 800);
}

function generatePage(game) {
  const data = {
    title: opts.name,
    url: `${BASEURL}/${game}`,
    ogimage: `${BASEURL}/${game}/ogimage.png`,
    twitterimage: `${BASEURL}/${game}/twitterimage.png`,
    themecolor: C[opts.bgColor],
    head: `
    <script>window.goatcounter = { path: function(p) { return location.host + p } };</script>
    <script data-goatcounter="https://stats.metaphora.co/count" async src="//stats.metaphora.co/count.js"></script>
  `,
  };

  const script = fs.readFileSync(`www/${game}/bundle.js`);
  const lzmad = fs.readFileSync('node_modules/lzma/src/lzma-d-min.js').toString()
    .replace('this.LZMA=this.LZMA_WORKER=e;', '');

  const scriptenc = lzma.compress(script, 9);
  const scriptb64 = Buffer.from(scriptenc).toString('base64');
  const payload = `<script type="module">
  const p=window.atob("${scriptb64}");
  ${lzmad}
  const a = new Uint8Array(new ArrayBuffer(p.length)); for(let i = 0; i < p.length; i++) a[i] = p.charCodeAt(i);
  e.decompress(a, res => { const s = document.createElement('script'); s.type = 'module'; s.innerText = res; document.body.appendChild(s); });
  </script>`;
  // const payload = `<script type="module">${script}</script>`;

  data['payload'] = payload;
  fs.writeFileSync(`www/${GAME}/index.html`, nunjucks.render('index.html', data));
}

generatePage(GAME);
takeScreenshots(GAME);