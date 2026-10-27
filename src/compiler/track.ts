import type { Easing, Keyframe, Track, TrackProperty } from '../types';
import { type Cubic, ease, isLinear, sliceEase } from './bezier';
import { evaluate, type NormKey, type NormProp } from './property';

export interface TimeMap {
  scale: number;
  offset: number;
}

export interface Window {
  ip: number;
  op: number;
  fr: number;
}

export type KEase = Cubic | 'linear' | 'hold';

export interface K {
  o: number;
  v: number[];
  e: KEase;
}

export interface TrackStats {
  composited: number;
  paint: number;
  baked: number;
}

export interface TrackContext {
  win: Window;
  sampleRate: number;
  stats: TrackStats;
}

export const toRoot = (map: TimeMap, t: number): number => t * map.scale + map.offset;

export const fromRoot = (map: TimeMap, frame: number): number => (frame - map.offset) / map.scale;

export const offsetOf = (win: Window, frame: number): number => (frame - win.ip) / (win.op - win.ip);

const frameOf = (win: Window, offset: number): number => win.ip + offset * (win.op - win.ip);

const pickDims = (v: number[], dims: number[]): number[] => dims.map((d) => v[d] ?? v[0] ?? 0);

const sameEase = (a: Cubic, b: Cubic): boolean =>
  Math.abs(a[0] - b[0]) < 1e-6 &&
  Math.abs(a[1] - b[1]) < 1e-6 &&
  Math.abs(a[2] - b[2]) < 1e-6 &&
  Math.abs(a[3] - b[3]) < 1e-6;

function segmentEase(k: NormKey, dims: number[]): Cubic | null {
  const eases = dims.map((d) => k.ease[d] ?? k.ease[0]!);
  const first = eases[0]!;
  return eases.every((e) => sameEase(e, first)) ? first : null;
}

export function sample(evalAt: (frame: number) => number[], from: number, to: number, ctx: TrackContext): K[] {
  const { win, sampleRate } = ctx;
  const seconds = (to - from) / win.fr;
  const n = Math.max(2, Math.ceil(seconds * sampleRate));
  const out: K[] = [];
  for (let j = 0; j < n; j++) {
    const frame = from + ((to - from) * j) / n;
    out.push({ o: offsetOf(win, frame), v: evalAt(frame), e: 'linear' });
  }
  return out;
}

export function valueAt(keys: K[], o: number): number[] {
  const first = keys[0]!;
  const last = keys[keys.length - 1]!;
  if (o <= first.o) return first.v.slice();
  if (o >= last.o) return last.v.slice();
  for (let n = 0; n < keys.length - 1; n++) {
    const k0 = keys[n]!;
    const k1 = keys[n + 1]!;
    if (o < k1.o) {
      const span = k1.o - k0.o;
      const u = span > 0 ? (o - k0.o) / span : 1;
      if (k0.e === 'hold') return k0.v.slice();
      const p = k0.e === 'linear' ? u : ease(k0.e, u);
      return k0.v.map((a, d) => a + ((k1.v[d] ?? a) - a) * p);
    }
  }
  return last.v.slice();
}

export function slice(keys: K[], a: number, b: number): K[] {
  const out: K[] = [];
  const first = keys[0]!;
  const last = keys[keys.length - 1]!;
  if (a < first.o) out.push({ o: a, v: first.v.slice(), e: 'linear' });
  for (let n = 0; n < keys.length - 1; n++) {
    const k0 = keys[n]!;
    const k1 = keys[n + 1]!;
    const span = k1.o - k0.o;
    if (span <= 0) {
      if (k0.o > a && k0.o < b) out.push({ o: k0.o, v: k0.v.slice(), e: 'linear' });
      continue;
    }
    if (k1.o <= a || k0.o >= b) continue;
    const s0 = Math.max(k0.o, a);
    const s1 = Math.min(k1.o, b);
    const u0 = (s0 - k0.o) / span;
    const u1 = (s1 - k0.o) / span;
    if (k0.e === 'hold') {
      out.push({ o: s0, v: k0.v.slice(), e: 'hold' });
    } else if (k0.e === 'linear') {
      out.push({ o: s0, v: k0.v.map((x, d) => x + ((k1.v[d] ?? x) - x) * u0), e: 'linear' });
    } else if (u0 === 0 && u1 === 1) {
      out.push({ o: s0, v: k0.v.slice(), e: k0.e });
    } else {
      const cut = sliceEase(k0.e, u0, u1);
      out.push({
        o: s0,
        v: k0.v.map((x, d) => x + ((k1.v[d] ?? x) - x) * cut.y0),
        e: cut.c ?? 'linear',
      });
    }
  }
  if (b > last.o && last.o >= a) out.push({ o: Math.max(a, last.o), v: last.v.slice(), e: 'linear' });
  if (out.length === 0 || out[0]!.o > a) out.unshift({ o: a, v: valueAt(keys, a), e: 'linear' });
  const end = valueAt(keys, b);
  const tail = out[out.length - 1]!;
  if (tail.o < b) out.push({ o: b, v: end, e: 'linear' });
  else tail.v = end;
  return out;
}

const equal = (a: number[], b: number[]): boolean =>
  a.length === b.length && a.every((n, d) => Math.abs(n - (b[d] ?? n)) < 1e-6);

export function isConstant(keys: K[]): boolean {
  const v = keys[0]!.v;
  return keys.every((k) => equal(k.v, v));
}

export function buildKeys(norm: NormProp, map: TimeMap, dims: number[], ctx: TrackContext): K[] | null {
  if (norm.kind === 'static') return null;
  const { win } = ctx;
  const keys = norm.keys;
  const raw: K[] = [];
  let baked = false;
  for (let n = 0; n < keys.length - 1; n++) {
    const k0 = keys[n]!;
    const k1 = keys[n + 1]!;
    const f0 = toRoot(map, k0.t);
    const f1 = toRoot(map, k1.t);
    const v0 = pickDims(k0.v, dims);
    if (k0.hold) {
      raw.push({ o: offsetOf(win, f0), v: v0, e: 'hold' });
      continue;
    }
    const shared = segmentEase(k0, dims);
    if (k0.to || !shared) {
      baked = true;
      const evalAt = (frame: number) => pickDims(evaluate(norm, fromRoot(map, frame)), dims);
      raw.push(...sample(evalAt, f0, f1, ctx));
      continue;
    }
    raw.push({ o: offsetOf(win, f0), v: v0, e: isLinear(shared) ? 'linear' : shared });
  }
  const lastKey = keys[keys.length - 1]!;
  raw.push({ o: offsetOf(win, toRoot(map, lastKey.t)), v: pickDims(lastKey.v, dims), e: 'linear' });
  if (baked) ctx.stats.baked++;
  return slice(raw, 0, 1);
}

const round = (n: number, digits = 4): number => {
  const f = 10 ** digits;
  const r = Math.round(n * f) / f;
  return Object.is(r, -0) ? 0 : r;
};

function easingOf(e: KEase): Easing | undefined {
  if (e === 'linear') return undefined;
  if (e === 'hold') return 1;
  return [round(e[0], 5), round(e[1], 5), round(e[2], 5), round(e[3], 5)];
}

const PAINT: ReadonlySet<TrackProperty> = new Set(['fill', 'stroke', 'fillOpacity', 'strokeOpacity', 'strokeWidth']);

export function toTrack(p: TrackProperty, keys: K[], convert: (v: number[]) => number[], ctx: TrackContext): Track {
  if (PAINT.has(p)) ctx.stats.paint++;
  else ctx.stats.composited++;
  const k: Keyframe[] = keys.map((key) => {
    const v = convert(key.v).map((n) => round(n));
    const frame: Keyframe = [round(key.o, 6), v.length === 1 ? v[0]! : v];
    const e = easingOf(key.e);
    if (e !== undefined) frame.push(e);
    return frame;
  });
  return { p, k };
}

export function frameAtOffset(win: Window, offset: number): number {
  return frameOf(win, offset);
}

export { round };
