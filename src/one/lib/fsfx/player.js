// Safari bullshit...
if (globalThis.AudioContext === undefined) {
  globalThis.AudioContext = globalThis.webkitAudioContext;
}

const USEREVENTS = [ "touchstart", "touchend", "mousedown", "mouseup",
  "keydown", "keyup"];

export default class Player {
  samples = {}
  _context = null;
  _gain = null;
  _volume = 1;

  constructor(sampleRate = 48000) {
    this.sampleRate = sampleRate;
  }

  _initEvent() {
    for (const en of USEREVENTS) {
      window.removeEventListener(en, this._evfunc, true);
    }
    delete this._evfunc;
    if (this._context) {
      this._context.resume();
    } else {
      this.context;
    }
  }

  ready() {
    return !!this._context;
  }

  trapEvents() {
    this._evfunc = () => this._initEvent();
    for (const en of USEREVENTS) {
      window.addEventListener(en, this._evfunc, true);
    }
  }

  get context() {
    if (!this._context) {
      this._context = new AudioContext({sampleRate: this.sampleRate});
      this._gain = this._context.createGain();
      this._gain.connect(this._context.destination);
      this._gain.gain.value = this._volume;
    }
    return this._context;
  }

  get volume() {
    return this._volume;
  }

  set volume(v) {
    this._volume = v;
    if (this._gain) {
      this._gain.gain.value = v;
    }
  }

  buffer(block) {
    const buffer = this.context.createBuffer(1, block.length, this.sampleRate);
    const channel = buffer.getChannelData(0);
    channel.set(block);
    return buffer;
  }

  play(buffer, detune = 0, when = 0) {
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    if (source.detune) {
      source.detune.value = detune;
    }
    source.connect(this._gain);
    source.start(when);
  }

  sample(name, block) {
    this.samples[name] = {block};
  }

  sampleBuffer(name) {
    if (this.samples[name]['buffer']) return this.samples[name]['buffer'];
    return this.samples[name]['buffer'] = this.buffer(this.samples[name]['block']);
  }

  samplePlay(name, detune = 0, when = 0) {
    const buffer = this.sampleBuffer(name);
    this.play(buffer, detune, when);
  }
}
