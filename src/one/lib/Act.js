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

class Act {
  constructor(host, obj) {
    this.host = host;
    this.object = (obj !== undefined) ? obj : this;
    this.lastDuration = 1.0;
    this.lastEase = easeLinear;
  }

  is() {
    return this.host._actions.some(a => a.object === this.object);
  }

  stop() {
    let next = 0;
    for (const a of this.host._actions) {
      if (a.object !== this.object) {
        this.host._actions[next++] = a;
      }
    }
    this.host._actions.splice(next);
    return this;
  }

  resume() {
    let i = 0;
    while (i < this.host._actions.length) {
      const a = this.host._actions[i++];
      if (a.object == this.object && a.duration < 0 && a.hold == true) {
        this.host._actions.splice(i - 1, 1);
        i--;
      }
    }
    return this;
  }

  pause() {
    this.host._actions.unshift({
      func: function(_t) {},
      time: 0,
      duration: -1,
      object: this.object,
      hold: true
    });
    return this;
  }

  delay(t, v = 0) {
    this.host._actions.push({
      func: function(_t) { return true; },
      time: 0,
      duration: t + v * Math.random(),
      object: this.object,
      hold: true});
    return this;
  }

  attr(attr, value, duration, ease, delay = 0.0) {
    ease = ease || this.lastEase;
    duration = duration === undefined ? this.lastDuration : duration;
    this.lastDuration = duration;
    this.lastEase = ease;
    if (delay + duration == 0) {
      duration = 1.0;
    }
    const wait = delay / (delay + duration);
    const frac = duration / (delay + duration);
    let initial = undefined;
    const obj = this.object;
    const func = function(t) {
      if (initial === undefined) {
        initial = getDeepProperty(obj, attr);
      }
      if (t < wait) return;
      t = (t - wait) / frac;
      setDeepProperty(obj, attr, initial + (value - initial) * ease(t));
    };
    this.host._actions.push({
      func: func,
      time: 0.0,
      duration: duration + delay,
      object: this.object,
      hold: false});
    return this;
  }

  set(attr, value) {
    this.host._actions.push({
      func: function(_t) { setDeepProperty(this.object, attr, value); },
      time: 0,
      duration: 0,
      object: this.object,
      hold: true});
    return this;
  }

  incr(attr, value) {
    this.host._actions.push({
      func: function(_t) {
        const v = getDeepProperty(this.object, attr);
        setDeepProperty(this.object, attr, v + value);
      },
      time: 0,
      duration: 0,
      object: this.object,
      hold: true});
    return this;
  }

  then(func) {
    this.host._actions.push({
      func: function(_t) { if (func != null) func(this); },
      time: 0,
      duration: 0,
      object: this.object,
      hold: true});
    return this;
  }

  tween(func, duration, ease) {
    ease = ease || easeLinear;
    this.host._actions.push({
      func: function(t) { func(ease(t)); },
      time: 0,
      duration: duration,
      object: this.object,
      hold: false});
    return this;
  }
}

export default class SysAct {
  constructor() {
    this._actions = [];
    this._waitAll = [];
    this._reset = false;
  }

  act(obj) {
    return new Act(this, obj);
  }

  isActing() {
    return this._actions.length != 0;
  }

  reset() {
    this._actions.length = 0;
    this._waitAll.length = 0;
    this._reset = true;
  }

  waitAll() {
    return new Promise((acc, _rej) => {
      this._waitAll.push(acc);
    });
  }

  removeAction(idx) {
    if (this._reset) {
      this._reset = false;
      return;
    }
    this._actions.splice(idx - 1, 1);
  }

  _actFrame(dt) {
    const blocked = new WeakMap();

    let i = 0;
    while (i < this._actions.length) {
      const a = this._actions[i++];
      const b = blocked.get(a.object);
      if (b == true) continue;
      blocked.set(a.object, a.hold);
      if (a.hold && b !== undefined) continue;
      if (a.duration == 0.0) {
        a.func(0.0);
        this.removeAction(i);
        i--;
        continue;
      }
      if (a.duration < 0.0) continue;
      a.time = clamp(a.time + dt / a.duration, 0.0, 1.0);
      a.func(a.time);
      if (a.time >= 1.0) {
        this.removeAction(i);
        i--;
      }
    }
    if (this._actions.length == 0) {
      while (this._waitAll.length > 0) {
        (this._waitAll.pop())();
      }
    }
  }
}
