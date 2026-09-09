import {biquad, sinc} from "./basic.js";

export class State extends Function {
  constructor(track, params = {}) {
    super();
    this.defaults = {};
    this._track = track;
    this._params = params;
    this.SR = this._track.sampleRate;
    this._updateCallback = null;
    this.out = { SR: this.SR };
    this.__call__(0);

    return this.proxy =  new Proxy(this, {
      apply: (target, that, args) => target.__call__(...args),
      get: (target, prop, receiver) => {
        if (Reflect.has(target, prop)) return Reflect.get(target, prop);
        return target.out[prop];
      },
    });
  }

  call(func, params) {
    return this._track(func, params);
  }

  update(fn) {
    this._updateCallback = fn;
    this._updateCallback(this(0));
  }

  __call__(n) {
    let changed = false;
    for (const p of Object.keys(this._params)) {
      const o = this._params[p];
      if ((typeof o !== "function") || (o instanceof Track)) {
        changed ||= (this.out[p] !== o);
        this.out[p] = o;
      } else {
        const v = o(n / this.SR);
        changed ||= (this.out[p] !== v);
        this.out[p] = v;
      }
    }
    if (this._updateCallback && changed) {
      this._updateCallback(this.out);
    }
    return this.proxy;
  }

  param(name, def) {
    if (this._params[name] === undefined) {
      this._params[name] = def;
      this(0);
    }
  }
}


export class Track extends Function {
  constructor(duration = 1, realSampleRate = 48000, oversampling = 1) {
    super();
    this.realSampleRate = realSampleRate;
    this.oversampling = oversampling;
    this.duration = duration;
    this.sampleRate = realSampleRate * oversampling;

    this.block = new Float32Array(this.sampleRate * this.duration);

    return this.proxy = new Proxy(this, {
      apply: (target, that, args) => target.__call__(...args),
    });
  }

  __call__(func, params = {}, ...args) {
    const start = params.start ?? 0;
    const length = params.length ?? -1;

    const begin = start * this.sampleRate;
    const block = this._subblock ?? this.block;
    const end = length == -1 ? block.length :
      begin + length * this.sampleRate;

    this._subblock = block.subarray(begin, end);
    const state = new State(this.proxy, params);
    func(this._subblock, state, ...args);
    this._subblock = null;
  }

  build() {
    if (this.oversampling > 1) {
      const cutoff = this.realSampleRate / 2;
      this.__call__(sinc, {freq: cutoff, M: 100});

      const newlength = Math.floor(this.block.length / this.oversampling);
      const out = new Float32Array(newlength);
      for (let i = 0; i < newlength; ++i) {
        out[i] = this.block[i * this.oversampling];
      }

      return Object.assign(out, {sampleRate: this.realSampleRate});
    }
    return Object.assign(this.block, {sampleRate: this.realSampleRate});
  }
}
