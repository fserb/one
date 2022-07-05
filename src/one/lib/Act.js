// act
// ---

import {clamp} from "./extra.js";
import {linear as easeLinear} from "./ease.js";

function getDeepProperty(obj, name) {
  const p = name.indexOf(".");
  if (p == -1) {
    return obj[name];
  }
  return getDeepProperty(obj[name.substr(0, p)], name.substr(p + 1));
}

function setDeepProperty(obj, name, value) {
  const p = name.indexOf(".");
  if (p == -1) {
    obj[name] = value;
  } else {
    setDeepProperty(obj[name.substr(0, p)], name.substr(p + 1), value);
  }
}

class Track {
  constructor(host, obj) {
    this.host = host;
    this.object = obj;
    this._actions = [[]];
  }

  #addPass(f) {
    let t = 0;
    this._actions[this._actions.length - 1].push(dt => f(t += dt));
    return this;
  }

  #addHold(f) {
    let t = 0;
    this._actions.push([dt => f(t += dt)]);
    this._actions.push([]);
    return this;
  }

  is() {
    return this._actions.length > 1 || this._actions[0].length > 0;
  }

  reset() {
    this._actions.length = 0;
    this._actions.push([]);
    return this;
  }

  delay(t, v = 0) {
    const duration = t + v * Math.random();
    return this.#addHold(t => t < duration);
  }

  attr(attr, value, duration, ease = easeLinear, delay = 0.0) {
    let initial = undefined;
    return this.#addPass(t => {
      if (initial === undefined) {
        initial = getDeepProperty(this.object, attr);
      }
      if (t < delay) return true;
      const rt = clamp((t - delay) / duration, 0.0, 1.0);
      setDeepProperty(this.object, attr,
        initial + (value - initial) * ease(rt));
      return rt < 1.0;
    });
  }

  set(attr, value) {
    return this.#addHold(_t => {
      setDeepProperty(this.object, attr, value);
      return false;
    });
  }

  incr(attr, value) {
    return this.#addHold(_t => {
      const v = getDeepProperty(this.object, attr);
      setDeepProperty(this.object, attr, v + value);
      return false;
    });
  }

  then(func) {
    return this.#addHold(_t => {
      if (func !== undefined) func();
      return false;
    });
  }

  tween(func, duration, ease = easeLinear) {
    return this.#addPass(t => {
      func(ease(clamp(t / duration, 0.0, 1.0)));
      return t < duration;
    });
  }
}

export default class Act extends Function {
  constructor() {
    super();
    this._tracks = new Map();
    this._waitAll = [];

    // eslint-disable-next-line
    return this.proxy = new Proxy(this, {
      apply: (target, _that, args) => target.__call__(...args)
    });
  }

  __call__(obj) {
    let t = this._tracks.get(obj);
    if (!t) {
      t = new Track(this, obj);
      this._tracks.set(obj, t);
    }
    return t;
  }

  is() {
    for (const [_obj, track] of this._tracks) {
      if (track.is()) return true;
    }
    return false;
  }

  reset() {
    this._tracks.clear();
    this._waitAll.length = 0;
  }

  wait() {
    return new Promise((acc, _rej) => {
      this._waitAll.push(acc);
    });
  }

  _frame(dt) {
    for (const [obj, track] of this._tracks) {
      const actions = track._actions;
      for (const epoch of actions) {
        if (epoch.length == 0) continue;
        let i = 0;
        while (i < epoch.length) {
          if (!epoch[i++](dt)) {
            epoch.splice(i - 1, 1);
          }
        }
        break;
      }
      let next = 0;
      for (let i = 0; i < actions.length - 1; ++i) {
        if (actions[i].length != 0) actions[next++] = actions[i];
      }
      actions[next++] = actions[actions.length - 1];
      actions.splice(next);
      if (actions.length == 1 && actions[0].length == 0) {
        this._tracks.delete(obj);
      }
    }
    if (this._tracks.size == 0) {
      while (this._waitAll.length > 0) {
        (this._waitAll.pop())();
      }
    }
  }
}
