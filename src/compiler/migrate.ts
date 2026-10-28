import type { LottieAnimationData, LottieLayer, LottieShape } from './lottie';

type Loose = Record<string, unknown> & { k?: unknown };

const older = (version: string | undefined, minimum: number[]): boolean => {
  if (!version) return false;
  const parts = version.split('.').map(Number);
  for (let i = 0; i < minimum.length; i++) {
    const a = parts[i] ?? 0;
    const b = minimum[i]!;
    if (a !== b) return a < b;
  }
  return false;
};

const divide = (value: unknown) => {
  if (!Array.isArray(value)) return;
  for (let i = 0; i < 4 && i < value.length; i++) if (typeof value[i] === 'number') value[i] /= 255;
};

function scaleColor(color: Loose | undefined) {
  const k = color?.k;
  if (!Array.isArray(k)) return;
  if (typeof k[0] === 'object' && k[0] !== null && 'i' in k[0]) {
    for (const key of k as Loose[]) {
      divide(key.s);
      divide(key.e);
    }
  } else divide(k);
}

function closeShape(shape: LottieShape) {
  const ks = shape.ks as Loose | undefined;
  const k = ks?.k as Loose | Loose[] | undefined;
  if (!k) return;
  if (!Array.isArray(k)) {
    if ('i' in k) k.c = shape.closed;
    return;
  }
  for (const key of k) {
    for (const end of [key.s, key.e]) {
      const path = Array.isArray(end) ? (end[0] as Loose | undefined) : undefined;
      if (path) path.c = shape.closed;
    }
  }
}

const LOOP =
  /^\s*(?:var\s+\$bm_rt\s*;\s*)?(?:\$bm_rt\s*=\s*)?loop(Out|In)\(\s*(?:(['"])(cycle|pingpong|offset)\2\s*(?:,\s*0\s*)?)?\)\s*;?\s*$/i;
const MAX_CYCLES = 500;

interface RawKey {
  t: number;
  s?: unknown;
  e?: unknown;
  h?: number;
  i?: Record<string, unknown>;
  o?: Record<string, unknown>;
  to?: unknown;
  ti?: unknown;
}

const vector = (v: unknown): number[] | undefined =>
  Array.isArray(v) && v.every((n) => typeof n === 'number') ? (v as number[]) : typeof v === 'number' ? [v] : undefined;

const flipEase = (from?: Record<string, unknown>, to?: Record<string, unknown>) => {
  const flip = (v: unknown) => (Array.isArray(v) ? v.map((n) => 1 - n) : typeof v === 'number' ? 1 - v : v);
  return {
    o: to ? { x: flip(to.x), y: flip(to.y) } : undefined,
    i: from ? { x: flip(from.x), y: flip(from.y) } : undefined,
  };
};

function unroll(keys: RawKey[], direction: 'Out' | 'In', mode: string, range: [number, number]): RawKey[] | null {
  const values = keys.map((key, n) => key.s ?? keys[n - 1]?.e);
  const first = keys[0];
  const last = keys[keys.length - 1];
  if (!first || !last || keys.length < 2 || values.some((v) => v === undefined)) return null;
  const period = last.t - first.t;
  if (!(period > 0)) return null;
  if (mode === 'pingpong' && keys.some((key) => key.h === 1 || key.to || key.ti)) return null;
  const delta =
    mode === 'offset' ? vector(values[values.length - 1])?.map((v, d) => v - (vector(values[0])?.[d] ?? 0)) : undefined;
  if (mode === 'offset' && !delta) return null;
  const copy = (cycle: number): RawKey[] => {
    const reversed = mode === 'pingpong' && Math.abs(cycle) % 2 === 1;
    return keys.map((_, n) => {
      const j = reversed ? keys.length - 1 - n : n;
      const key = keys[j]!;
      const t = reversed ? first.t + (last.t - key.t) : key.t;
      let s = values[j];
      if (delta) s = vector(s)!.map((v, d) => v + (delta[d] ?? 0) * cycle);
      const out: RawKey = { t: t + cycle * period, s, h: key.h };
      if (reversed) {
        const ease = flipEase(keys[j - 1]?.o, keys[j - 1]?.i);
        if (j > 0) Object.assign(out, ease);
      } else {
        if (key.i) out.i = key.i;
        if (key.o) out.o = key.o;
        if (key.to) out.to = key.to;
        if (key.ti) out.ti = key.ti;
      }
      return out;
    });
  };
  const out: RawKey[] = [...copy(0)];
  if (direction === 'Out') {
    for (let cycle = 1; cycle < MAX_CYCLES && first.t + cycle * period < range[1]; cycle++) out.push(...copy(cycle));
  } else {
    for (let cycle = -1; cycle > -MAX_CYCLES && last.t + cycle * period > range[0]; cycle--)
      out.unshift(...copy(cycle));
  }
  return out;
}

function expandLoops(node: unknown, range: [number, number]) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) expandLoops(item, range);
    return;
  }
  const record = node as Loose & { x?: unknown; layers?: unknown };
  if (typeof record.x === 'string' && Array.isArray(record.k) && typeof record.k[0] === 'object') {
    const match = LOOP.exec(record.x);
    if (match) {
      const keys = unroll(
        record.k as RawKey[],
        match[1] === 'In' || match[1] === 'in' ? 'In' : 'Out',
        (match[3] ?? 'cycle').toLowerCase(),
        range,
      );
      if (keys) {
        record.k = keys;
        delete record.x;
      }
    }
  }
  for (const [key, value] of Object.entries(record)) if (key !== 'layers') expandLoops(value, range);
}

const hasLoops = (data: unknown): boolean => JSON.stringify(data).includes('loop');

export function migrate(data: LottieAnimationData): LottieAnimationData {
  const colors = older(data.v, [4, 1, 9]);
  const closing = older(data.v, [4, 4, 18]);
  const loops = hasLoops(data);
  if (!colors && !closing && !loops) return data;
  const out = structuredClone(data);
  if (loops) {
    const visit = (list: LottieLayer[] | undefined) => {
      for (const layer of list ?? []) expandLoops(layer, [layer.ip, layer.op]);
    };
    visit(out.layers);
    for (const asset of out.assets ?? []) visit(asset.layers);
  }
  const shapes = (items: LottieShape[] | undefined) => {
    for (const item of items ?? []) {
      if (item.ty === 'gr') shapes(item.it as LottieShape[] | undefined);
      else if (colors && (item.ty === 'fl' || item.ty === 'st')) scaleColor(item.c as Loose | undefined);
      else if (closing && item.ty === 'sh') closeShape(item);
    }
  };
  const layers = (list: LottieLayer[] | undefined) => {
    for (const layer of list ?? []) if (layer.ty === 4) shapes(layer.shapes);
  };
  layers(out.layers);
  for (const asset of out.assets ?? []) layers(asset.layers);
  return out;
}
