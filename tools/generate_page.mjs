import "../src/one/lib/extend.js";
import fs from "fs";
import nunjucks from "nunjucks";

import {GAME, opts, C} from "./gameinfo.mjs";

const BASEURL = "https://one.fserb.com";

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
  const payload = `<script type="module">${script}</script>`;

  data['payload'] = payload;
  fs.writeFileSync(`www/${GAME}/index.html`, nunjucks.render('index.html', data));
}

generatePage(GAME);
