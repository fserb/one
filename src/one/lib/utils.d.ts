export function newCanvas(width: int, height: int, context?: string, opts?: object):
[(HTMLCanvasElement | OffscreenCanvas), CanvasRenderingContext];

export function debounce(func: (any?) => any, wait: float, immediate?: boolean): ((any?) => any);

export function uuid(): string;

export function loadImage(name: string): ImageBitmap;

export function rectHit(obj: any, x: float, y: float): boolean;

export function mousepos(obj: any, x: float, y: float): [float, float];

export function unmap(objs: (any)[], target: any): any;

export function unmaps(objs: (any)[], s: float): float;

export function dayOfYear(y: int, m: int, d: int): int;

export function dayOfEpoch(y: int, m: int, d: int): int;