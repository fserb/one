interface Math {
  clamp(float, float, float): float;
  SQRT3: float;
  hash(...any): int;
  log2int(int): int;
  lerp(float, float, float): float;
  sum(arr: float[]): float;
}

interface String {
  strip(): string;
}

interface Array {
  shuffle(): Array;
  infilter(callbackfn: (any) => boolean): void;
  remove(any): Array;
}

interface Window {
  uuid(): string;
  isTouch(): boolean;
  log(...any): void;
  newCanvas(width: int, height: int, context: string, opts?: object):
    [(HTMLCanvasElement | OffscreenCanvas), CanvasRenderingContext];
  debounce(func: (any?) => any, wait: float, immediate?: boolean): ((any?) => any);
  NativeStorage: any;
}

interface Navigator {
  requestMIDIAccess(obj?): Promise;
}

interface ArrayBuffer {
  toStr(): string;
}

interface PromiseConstructor {
  sleep(time): Promise;
  event(obj, string): Promise;
}