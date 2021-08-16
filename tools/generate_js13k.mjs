import fs from "fs";
import nunjucks from "nunjucks";
import lzma from "lzma";

import {GAME, opts} from "./gameinfo.mjs";

const BASEURL = "https://one.fserb.com";

function generatePage(game) {
  const data = {
    title: opts.name,
    url: `${BASEURL}/${game}`,
    themecolor: opts.bgColor,
  };

  const script = fs.readFileSync(`www/${game}/js13k.js`);
  // const lzmad = fs.readFileSync('node_modules/lzma/src/lzma-d-min.js').toString()
  //   .replace('this.LZMA=this.LZMA_WORKER=e;', '');

  // const scriptenc = lzma.compress(script, 9);
  // const scriptb64 = Buffer.from(scriptenc).toString('base64');
  // const payload = `<script type="module">
  // const p=window.atob("${scriptb64}");
  // ${lzmad}
  // const a = new Uint8Array(new ArrayBuffer(p.length)); for(let i = 0; i < p.length; i++) a[i] = p.charCodeAt(i);
  // e.decompress(a, res => { const s = document.createElement('script'); s.type = 'module'; s.innerText = res; document.body.appendChild(s); });
  // </script>`;
  const payload = `<script type=module>${script}</script>`;

  data['payload'] = payload;
  fs.writeFileSync(`www/${GAME}/index.html`, nunjucks.render('js13k.html', data));
}

generatePage(GAME);
