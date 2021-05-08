// extend
/* global globalThis */

if (Math.clamp === undefined) {
  Math.clamp = function(x, lower, upper) {
    return x <= lower ? lower : (x >= upper ? upper : x);
  };
}

if (Math.SQRT3 == undefined) {
  Math.SQRT3 = Math.sqrt(3);
}

if (Math.hash === undefined) {
  Math.hash = function(...v) {
    if (v.length === 0) return 0;
    let h = 0;
    for (const o of v) {
      h = h ^ ((o * 0xdeece66d + 0xb) + 0x9e3779b9 + (h << 6) + (h >> 2));
    }
    return h;
  };
}

if (Math.sum === undefined) {
  Math.sum = function(arr) {
    let acc = 0;
    for (let i = 0; i < arr.length; ++i) acc += arr[i];
    return acc;
  };
}

if (Math.lerp === undefined) {
  Math.lerp = function(a, b, t) {
    return (a * (1.0 - t)) + (b * t);
  };
}

if (Math.log2int === undefined) {
  Math.log2int = function(v) {
    let r = 0xFFFF - v >> 31 & 0x10;
    v >>= r;
    let shift = 0xFF - v >> 31 & 0x8;
    v >>= shift;
    r |= shift;
    shift = 0xF - v >> 31 & 0x4;
    v >>= shift;
    r |= shift;
    shift = 0x3 - v >> 31 & 0x2;
    v >>= shift;
    r |= shift;
    r |= (v >> 1);
    return r;
  };
}

if (String.prototype.strip === undefined) {
  String.prototype.strip = function() {
    return this.replace(/^\s+/, '').replace(/\s+$/, '');
  };
}

if (Array.prototype.shuffle === undefined) {
  Array.prototype.shuffle = function() {
    let counter = this.length;
    // While there are elements in the array
    while (counter-- > 0) {
      // Pick a random index
      const index = Math.floor((Math.random() * counter));
      // And swap the last element with it
      const temp = this[counter];
      this[counter] = this[index];
      this[index] = temp;
    }
    return this;
  };
}

if (Array.prototype.infilter === undefined) {
  Array.prototype.infilter = function(cond) {
    let next = 0;

    for (const v of this) {
      if (cond(v)) this[next++] = v;
    }

    this.splice(next);
  };
}

if (Array.prototype.remove === undefined) {
  Array.prototype.remove = function(element) {
    const idx = this.indexOf(element);
    if (idx == -1) return this;
    this.splice(idx, 1);
    return this;
  };
}

if (ArrayBuffer.prototype.toStr === undefined) {
  ArrayBuffer.prototype.toStr = function() {
    return String.fromCharCode.apply(null, new Uint8Array(this));
  };
}

if (globalThis.log === undefined) {
  globalThis.log = globalThis.console.log.bind(globalThis.console);
}

if (!globalThis.createImageBitmap && globalThis.Image) {
  globalThis.createImageBitmap = function(input) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = _ev => {
        resolve(img);
      };
      img.onerror = ev => { reject(ev); };
      if (input instanceof Blob) {
        img.src = URL.createObjectURL(input);
      } else if (input.toDataURL) {
        img.src = input.toDataURL();
      } else {
        img.src = input;
      }
    });
  };
  // @ts-ignore
  globalThis.ImageBitmap = Image;
}

Promise.sleep = function(time) {
  return new Promise(res => setTimeout(res, time * 1000));
};

Promise.event = function(obj, event) {
  return new Promise(res => {
    obj.addEventListener(event, ev => {
      res(ev);
    });
  });
};

if (globalThis['location'] && !location.protocol.startsWith("http")) {
  /**
   * @param {string} url
   * @param {any} opts
   */
  globalThis.fetch = function(url, opts = {}) {
    const opt = Object.assign({method: "GET", body: null}, opts);
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.addEventListener("load", () => {
        resolve(new Response(xhr.response, {status: 200}));
      });
      xhr.addEventListener("error", () => {
        reject(new TypeError('Local request failed'));
      });
      xhr.responseType = "blob";
      xhr.open(opt.method, url, true);
      xhr.send(opt.body);
    });
  };
}
