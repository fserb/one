import {promiseSleep} from "../src/one/lib/extra.js";
import puppeteer from "puppeteer-core";
import sharp from "sharp";
import {GAME, opts} from "./gameinfo.mjs";

async function takeScreenshots(game) {
  const browser = await puppeteer.launch({
    executablePath: "/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome"
  });

  const page = await browser.newPage();

  await page.setViewport({width: 800, height: 800, deviceScaleFactor: 2});

  const url = `https://dev.metaphora.co/games/one/www/${game}/index.html`;

  await page.goto(url);
  await page.click("#canvas");
  await promiseSleep(1.5);
  const png = await page.screenshot({type: "png"});
  await browser.close();

  async function buildImage(name, width, height) {
    // @ts-ignore
    const obj = sharp(png);

    obj.resize(width, height, {
      fit: "contain",
      background: opts.bgColor}).png().toFile(name);
  }

  await buildImage(`www/${game}/ogimage.png`, 1200, 627);
  await buildImage(`www/${game}/twitterimage.png`, 1456, 728);
  await buildImage(`www/${game}/base.png`, 800, 800);
}

takeScreenshots(GAME);
