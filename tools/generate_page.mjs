import fs from "fs";
import nunjucks from "nunjucks";

import {GAME, opts} from "./gameinfo.mjs";

const BASEURL = "https://one.fserb.com";

function generatePage(game) {
  const data = {
    title: opts.name,
    url: `${BASEURL}/${game}`,
    ogimage: `${BASEURL}/${game}/ogimage.png`,
    twitterimage: `${BASEURL}/${game}/twitterimage.png`,
    themecolor: opts.bgColor,
    head: ``,
  };

  const script = fs.readFileSync(`www/${game}/bundle.js`);
  const payload = `<script type="module">${script}</script>`;

  data['payload'] = payload;
  fs.writeFileSync(`www/${GAME}/index.html`, nunjucks.render('index.html', data));
}

generatePage(GAME);
