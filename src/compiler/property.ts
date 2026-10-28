import { type Cubic, ease } from './bezier';
import type { LottieBezier, LottieKeyframe, LottieProperty } from './lottie';

export interface NormKey {
  t: number;
  v: number[];
  hold: boolean;
  ease: Cubic[];
  to?: number[];
  ti?: number[];
}

export type NormProp = { kind: 'static'; v: number[] } | { kind: 'anim'; keys: NormKey[] };

const LINEAR: Cubic = [0, 0, 1, 1];

export function toVec(value: unknown): number[] | undefined {
  if (typeof value === 'number') return [value];
  if (Array.isArray(value) && value.every((n) => typeof n === 'number')) return value.slice();
  return undefined;
}

function isKeyframes(k: unknown): k is LottieKeyframe[] {
  return Array.isArray(k) && k.length > 0 && typeof k[0] === 'object' && k[0] !== null && 't' in k[0];
}

export function hasKeyframes(prop: LottieProperty | undefined): boolean {
  return !!prop && isKeyframes(prop.k);
}

export function hasExpression(prop: LottieProperty | undefined): boolean {
  return !!prop && typeof prop.x === 'string' && prop.x.trim() !== '';
}

const pick = (v: number | number[], d: number): number => (Array.isArray(v) ? (v[d] ?? v[0] ?? 0) : v);

export function easesOf(o: LottieBezier | undefined, i: LottieBezier | undefined): Cubic[] {
  if (!o || !i) return [LINEAR];
  const dims = Math.max(...[o.x, o.y, i.x, i.y].map((v) => (Array.isArray(v) ? v.length : 1)), 1);
  const out: Cubic[] = [];
  for (let d = 0; d < dims; d++) out.push([pick(o.x, d), pick(o.y, d), pick(i.x, d), pick(i.y, d)]);
  return out;
}

const nonZero = (v: number[] | undefined): boolean => !!v && v.some((n) => Math.abs(n) > 1e-9);

export function normalize(prop: LottieProperty | undefined, fallback: number[]): NormProp {
  if (!prop) return { kind: 'static', v: fallback.slice() };
  const k = prop.k;
  if (!isKeyframes(k)) return { kind: 'static', v: toVec(k) ?? fallback.slice() };
  const keys: NormKey[] = [];
  for (let n = 0; n < k.length; n++) {
    const kf = k[n] as LottieKeyframe;
    const prev = k[n - 1];
    const v = toVec(kf.s) ?? (prev ? toVec(prev.e) : undefined) ?? keys[keys.length - 1]?.v ?? fallback.slice();
    const key: NormKey = { t: kf.t, v, hold: kf.h === 1, ease: easesOf(kf.o, kf.i) };
    if (nonZero(kf.to) || nonZero(kf.ti)) {
      key.to = kf.to ?? [0, 0, 0];
      key.ti = kf.ti ?? [0, 0, 0];
    }
    keys.push(key);
  }
  if (keys.length === 1) return { kind: 'static', v: keys[0]!.v };
  return { kind: 'anim', keys };
}

const ARC_SAMPLES = 150;

interface Arc {
  points: number[][];
  lengths: number[];
  total: number;
}

const arcCache = new WeakMap<NormKey, Arc>();

function arcOf(k0: NormKey, k1: NormKey): Arc {
  const cached = arcCache.get(k0);
  if (cached) return cached;
  const p0 = k0.v;
  const p3 = k1.v;
  const to = k0.to ?? [];
  const ti = k0.ti ?? [];
  const dims = Math.min(p0.length, p3.length);
  const points: number[][] = [];
  const lengths: number[] = [];
  let total = 0;
  for (let s = 0; s < ARC_SAMPLES; s++) {
    const t = s / (ARC_SAMPLES - 1);
    const mt = 1 - t;
    const point: number[] = [];
    for (let d = 0; d < dims; d++) {
      const a = p0[d] ?? 0;
      const b = p3[d] ?? 0;
      point.push(
        mt * mt * mt * a + 3 * mt * mt * t * (a + (to[d] ?? 0)) + 3 * mt * t * t * (b + (ti[d] ?? 0)) + t * t * t * b,
      );
    }
    if (s > 0) {
      const last = points[s - 1]!;
      let dist = 0;
      for (let d = 0; d < dims; d++) dist += ((point[d] ?? 0) - (last[d] ?? 0)) ** 2;
      total += Math.sqrt(dist);
    }
    points.push(point);
    lengths.push(total);
  }
  const arc = { points, lengths, total };
  arcCache.set(k0, arc);
  return arc;
}

function pointAtLength(arc: Arc, distance: number): number[] {
  const { points, lengths } = arc;
  if (distance <= 0) return points[0]!.slice();
  for (let s = 1; s < points.length; s++) {
    const end = lengths[s]!;
    if (distance < end || s === points.length - 1) {
      const start = lengths[s - 1]!;
      const span = end - start;
      const f = span > 0 ? Math.min(1, (distance - start) / span) : 0;
      const a = points[s - 1]!;
      const b = points[s]!;
      return a.map((n, d) => n + ((b[d] ?? n) - n) * f);
    }
  }
  return points[points.length - 1]!.slice();
}

export function segmentValue(k0: NormKey, k1: NormKey, u: number): number[] {
  if (k0.hold) return k0.v.slice();
  if (k0.to) {
    const arc = arcOf(k0, k1);
    return pointAtLength(arc, arc.total * ease(k0.ease[0] ?? LINEAR, u));
  }
  return k0.v.map((a, d) => {
    const b = k1.v[d] ?? a;
    return a + (b - a) * ease(k0.ease[d] ?? k0.ease[0] ?? LINEAR, u);
  });
}

export function evaluate(prop: NormProp, t: number): number[] {
  if (prop.kind === 'static') return prop.v.slice();
  const { keys } = prop;
  const first = keys[0]!;
  const last = keys[keys.length - 1]!;
  if (t < first.t) return first.v.slice();
  if (t >= last.t) return last.v.slice();
  for (let n = 0; n < keys.length - 1; n++) {
    const k0 = keys[n]!;
    const k1 = keys[n + 1]!;
    if (t < k1.t) {
      const span = k1.t - k0.t;
      return segmentValue(k0, k1, span > 0 ? (t - k0.t) / span : 1);
    }
  }
  return last.v.slice();
}
