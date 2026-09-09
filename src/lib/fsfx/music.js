// music

import {State} from "./synth.js";

export const scales = {
  'major': 'cdefgab',
  'minor': 'cde-fga-b',
  'dorian': 'cde-fgab-',
  'gypsy': 'cd-efga-b-',
  'lydian': 'cdef#gab',
  'pentatonic': 'cdega',
  'pentatonic_minor': 'cde-gb-',
}

const SCALE='c d ef g a bC D EF G A B';

function noteToValue(s) {
  if (!isNaN(s)) {
    return s - 1;
  }
  let note = SCALE.indexOf(s[0]);
  switch (s[1]) {
    case '#': case '+': note++; break;
    case '-': note--; break;
  }
  return note;
}

export function scale(input, dom = null) {
  let myscale = [];
  if (Array.isArray(input)) {
    myscale = input;
  } else if (isNaN(input)) {
    for (let i = 0; i < input.length; ++i) {
      const note = noteToValue(input.substr(i, 2));
      if (note == -1) continue;
      myscale.push(note);
    }
  } else {
    while (input > 0) {
      const x = (input & 0xF) - 1;
      input >>= 4;
      myscale.push(x);
    }
    myscale.reverse();
  }

  let out = dom => {
    const dominant = noteToValue(dom) % 12;
    const octave = Number.parseInt(dom[dom.length - 1]);
    const domdist = octave - 4 + ((dominant - 9 + 12) % 12) / 12;
    return note => {
      const n = noteToValue(note);
      return 440 * Math.pow(2, domdist + (n - 9) / 12);
    };
  };

  if (dom !== null) return out(dom);
  return out;
}

export function music(block, state, inpscale, song, func) {
  state.param("bpm", 120);
  state.param("tempo", 4);
  state.param("meter", 4);

  const cmds = [];
  let octave = 0;
  let length = 4;
  cmds.push(["bpm", state.tempo]);
  for(let i = 0; i < song.length; ++i){
    let note = SCALE.indexOf(song[i]);

    if (note != -1) {
      let more = true;
      while(more){
        switch(song[i + 1]){
          case "#": case "+": i++; note++; break;
          case "-": i++; note--; break;
          default: more = false;
        }
      }
      cmds.push(["note", 12 * octave + note, length]);
      continue;
    }

    if (song[i] == '>') octave++;
    else if (song[i] == '<') octave--;
    else if (song[i] == '[') length--;
    else if (song[i] == ']') length++;
    else if (song[i] == '_') {
      cmds.push(["pause", 0, length]);
    } else if ("NOLPT".indexOf(song[i])) {
      let j = i+1;
      while (!isNaN(song[j])) j++;
      const number = Number.parseInt(song.substr(i, j));
      switch(song[i]) {
        case "N": cmds.push(["note", number, length]); break;
        case "O": octave = number; break;
        case "L": length = number; break;
        case "P": cmds.push(["pause", length]); break;
        case "T": cmds.push(["tempo", number]);; break;
      }
    }
  }

  const musicscale = inpscale ?? scale("cdefgab", "C4");

  let tempo = 60 / (state.meter * state.bpm);
  let time = 0;
  for (const c of cmds) {
    if (c[0] == "tempo") {
      tempo = 60 / (state.meter * c[1]);
      continue;
    }
    if (c[0] == "pause") {
      time += tempo * c[2] / state.tempo;
      continue;
    }
    if (c[0] != "note") {
      continue;
    }

    const f = musicscale(c[1]);
    const t = tempo * c[2] / state.tempo;

    func(f, t, (func, params={}, ...args) => {
      const start = params.start ?? 0;
      const length = params.length ?? -1;

      const begin = (time + start) * state.SR;
      const end = length == -1 ? block.length :
        begin + length * state.SR;

      const st = new State(state._track, params);
      return func(block.subarray(begin, end), st, ...args);
    });
    time += t;
  }
}