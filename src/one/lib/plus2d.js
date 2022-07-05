/* eslint-disable no-invalid-this */

function roundRect(x, y, width, height, radius) {
  if (!radius.length) {
    radius = [radius, radius, radius, radius];
  }
  this.moveTo(x + radius[0], y);
  this.lineTo(x + width - radius[1], y);
  this.arcTo(x + width, y, x + width, y + radius[1], radius[1]);
  this.lineTo(x + width, y + height - radius[2]);
  this.arcTo(x + width, y + height,
    x + width - radius[2], y + height, radius[2]);
  this.lineTo(x + radius[3], y + height);
  this.arcTo(x, y + height, x, y + height - radius[3], radius[3]);
  this.lineTo(x, y + radius[0]);
  this.arcTo(x, y, x + radius[0], y, radius[0]);
  this.closePath();
}

function strokeRoundRect(x, y, width, height, radius = 0) {
  this.beginPath();
  this.roundRect(x, y, width, height, radius);
  this.stroke();
}

function fillRoundRect(x, y, width, height, radius = 0) {
  this.beginPath();
  this.roundRect(x, y, width, height, radius);
  this.fill();
}

function mtext(txt, size, opts) {
  opts = Object.assign({ weight: "bold", align: "center", valign: "middle"}, opts);
  this.font = opts.weight + " " + size + "px Verdana";
  this.textAlign = opts.align;
  this.textBaseline = opts.valign;
  // @ts-ignore
  return this.measureText(txt);
}

function text(txt, x, y, size, opts) {
  // @ts-ignore
  this.save();
  if (size < 10) {
    const r = size / 10;
    size = 10;
    // @ts-ignore
    this.scale(r, r);
    x /= r;
    y /= r;
  }

  opts = Object.assign({ weight: "bold", align: "center", valign: "middle"}, opts);
  this.font = opts.weight + " " + size + "px Verdana";
  this.textAlign = opts.align;
  this.textBaseline = opts.valign;

  // @ts-ignore
  this.fillText(txt, x, y);

  // @ts-ignore
  this.restore();
}

function strokeLine(ax, ay, bx, by) {
  this.beginPath();
  this.moveTo(ax, ay);
  this.lineTo(bx, by);
  this.stroke();
}

function fillCircle(x, y, r) {
  this.beginPath();
  this.arc(x, y, r, 0, 2 * Math.PI);
  this.fill();
}

function strokeCircle(x, y, r) {
  this.beginPath();
  this.arc(x, y, r, 0, 2 * Math.PI);
  this.stroke();
}

function reset() {
  /* eslint-disable-next-line no-self-assign */
  this.canvas.width = this.canvas.width;
}

const MAP = {
  'reset': reset,
  'roundRect': roundRect,
  'strokeRoundRect': strokeRoundRect,
  'fillRoundRect': fillRoundRect,
  'text': text,
  'mtext': mtext,
  'strokeLine': strokeLine,
  'fillCircle': fillCircle,
  'strokCircle': strokeCircle };

export default function(obj) {
  const target = obj.getContext ? obj.getContext("2d") : obj;

  for (const name of Object.keys(MAP)) {
    if (target[name] !== undefined) {
      console.log("ALREADY EXISTS", name);
      continue;
    }
    target[name] = MAP[name].bind(target);
  }
  return obj;
}
