import type { Matrix } from '../types';
import type { LottiePathValue } from './lottie';

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

const KAPPA = 0.5519;

export function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export const translation = (x: number, y: number): Matrix => [1, 0, 0, 1, x, y];

export const scaling = (x: number, y: number): Matrix => [x, 0, 0, y, 0, 0];

export function rotation(deg: number): Matrix {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [c, s, -s, c, 0, 0];
}

export function skewAlongAxis(skewDeg: number, axisDeg: number): Matrix {
  const axis = (axisDeg * Math.PI) / 180;
  const c = Math.cos(axis);
  const s = Math.sin(axis);
  const shear: Matrix = [1, 0, Math.tan((-skewDeg * Math.PI) / 180), 1, 0, 0];
  return multiply(multiply([c, -s, s, c, 0, 0], shear), [c, s, -s, c, 0, 0]);
}

export interface TransformValues {
  anchor: number[];
  position: number[];
  scale: number[];
  rotation: number;
  skew: number;
  skewAxis: number;
}

export function composeTransform(t: TransformValues): Matrix {
  let m = translation(t.position[0] ?? 0, t.position[1] ?? 0);
  if (t.rotation) m = multiply(m, rotation(t.rotation));
  if (t.skew) m = multiply(m, skewAlongAxis(t.skew, t.skewAxis));
  m = multiply(m, scaling((t.scale[0] ?? 100) / 100, (t.scale[1] ?? 100) / 100));
  return multiply(m, translation(-(t.anchor[0] ?? 0), -(t.anchor[1] ?? 0)));
}

export const isIdentity = (m: Matrix): boolean => m.every((v, i) => Math.abs(v - (IDENTITY[i] ?? 0)) < 1e-9);

export function invert(m: Matrix): Matrix {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-12) return IDENTITY;
  return [
    m[3] / det,
    -m[1] / det,
    -m[2] / det,
    m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det,
    (m[1] * m[4] - m[0] * m[5]) / det,
  ];
}

const ROUND_CORNER = 0.5519;

export function roundCorners(path: PathData, round: number): PathData {
  const out: PathData = { v: [], i: [], o: [], c: path.c };
  const n = path.v.length;
  const push = (v: number[], o: number[], i: number[]) => {
    out.v.push(v);
    out.o.push(o);
    out.i.push(i);
  };
  for (let k = 0; k < n; k++) {
    const v = path.v[k]!;
    const o = path.o[k]!;
    const i = path.i[k]!;
    const sharp = v[0] === o[0] && v[1] === o[1] && v[0] === i[0] && v[1] === i[1];
    if (!sharp || round <= 0 || ((k === 0 || k === n - 1) && !path.c)) {
      push(v, o, i);
      continue;
    }
    const toward = (other: number[]) => {
      const d = Math.hypot(v[0]! - other[0]!, v[1]! - other[1]!);
      const f = d ? Math.min(d / 2, round) / d : 0;
      return [v[0]! + (other[0]! - v[0]!) * f, v[1]! + (other[1]! - v[1]!) * f];
    };
    const pull = (p: number[]) => [p[0]! - (p[0]! - v[0]!) * ROUND_CORNER, p[1]! - (p[1]! - v[1]!) * ROUND_CORNER];
    const a = toward(path.v[k === 0 ? n - 1 : k - 1]!);
    push(a, pull(a), a);
    const b = toward(path.v[k === n - 1 ? 0 : k + 1]!);
    push(b, b, pull(b));
  }
  return out;
}

export function transformD(d: string, m: Matrix): string {
  return d.replace(/(-?[\d.]+(?:e-?\d+)?) (-?[\d.]+(?:e-?\d+)?)/g, (_, xs: string, ys: string) => {
    const x = Number(xs);
    const y = Number(ys);
    const fmt = (v: number) => String(Math.round(v * 1000) / 1000);
    return `${fmt(m[0] * x + m[2] * y + m[4])} ${fmt(m[1] * x + m[3] * y + m[5])}`;
  });
}

export interface PathData {
  v: number[][];
  i: number[][];
  o: number[][];
  c: boolean;
}

export function fromLottiePath(value: LottiePathValue, closed?: boolean): PathData {
  const v = value.v ?? [];
  return {
    v: v.map((p) => [p[0] ?? 0, p[1] ?? 0]),
    i: v.map((p, n) => [(p[0] ?? 0) + (value.i?.[n]?.[0] ?? 0), (p[1] ?? 0) + (value.i?.[n]?.[1] ?? 0)]),
    o: v.map((p, n) => [(p[0] ?? 0) + (value.o?.[n]?.[0] ?? 0), (p[1] ?? 0) + (value.o?.[n]?.[1] ?? 0)]),
    c: value.c ?? closed ?? false,
  };
}

function builder(closed: boolean) {
  const path: PathData = { v: [], i: [], o: [], c: closed };
  const add = (vx: number, vy: number, ox: number, oy: number, ix: number, iy: number) => {
    path.v.push([vx, vy]);
    path.o.push([ox, oy]);
    path.i.push([ix, iy]);
  };
  return { path, add };
}

export function rectPath(p: number[], s: number[], r: number, d: number | undefined): PathData {
  const p0 = p[0] ?? 0;
  const p1 = p[1] ?? 0;
  const v0 = (s[0] ?? 0) / 2;
  const v1 = (s[1] ?? 0) / 2;
  const round = Math.min(v0, v1, r);
  const cp = round * (1 - KAPPA);
  const { path, add } = builder(true);
  if (d === 2 || d === 1) {
    add(p0 + v0, p1 - v1 + round, p0 + v0, p1 - v1 + round, p0 + v0, p1 - v1 + cp);
    add(p0 + v0, p1 + v1 - round, p0 + v0, p1 + v1 - cp, p0 + v0, p1 + v1 - round);
    if (round !== 0) {
      add(p0 + v0 - round, p1 + v1, p0 + v0 - round, p1 + v1, p0 + v0 - cp, p1 + v1);
      add(p0 - v0 + round, p1 + v1, p0 - v0 + cp, p1 + v1, p0 - v0 + round, p1 + v1);
      add(p0 - v0, p1 + v1 - round, p0 - v0, p1 + v1 - round, p0 - v0, p1 + v1 - cp);
      add(p0 - v0, p1 - v1 + round, p0 - v0, p1 - v1 + cp, p0 - v0, p1 - v1 + round);
      add(p0 - v0 + round, p1 - v1, p0 - v0 + round, p1 - v1, p0 - v0 + cp, p1 - v1);
      add(p0 + v0 - round, p1 - v1, p0 + v0 - cp, p1 - v1, p0 + v0 - round, p1 - v1);
    } else {
      add(p0 - v0, p1 + v1, p0 - v0 + cp, p1 + v1, p0 - v0, p1 + v1);
      add(p0 - v0, p1 - v1, p0 - v0, p1 - v1 + cp, p0 - v0, p1 - v1);
    }
  } else {
    add(p0 + v0, p1 - v1 + round, p0 + v0, p1 - v1 + cp, p0 + v0, p1 - v1 + round);
    if (round !== 0) {
      add(p0 + v0 - round, p1 - v1, p0 + v0 - round, p1 - v1, p0 + v0 - cp, p1 - v1);
      add(p0 - v0 + round, p1 - v1, p0 - v0 + cp, p1 - v1, p0 - v0 + round, p1 - v1);
      add(p0 - v0, p1 - v1 + round, p0 - v0, p1 - v1 + round, p0 - v0, p1 - v1 + cp);
      add(p0 - v0, p1 + v1 - round, p0 - v0, p1 + v1 - cp, p0 - v0, p1 + v1 - round);
      add(p0 - v0 + round, p1 + v1, p0 - v0 + round, p1 + v1, p0 - v0 + cp, p1 + v1);
      add(p0 + v0 - round, p1 + v1, p0 + v0 - cp, p1 + v1, p0 + v0 - round, p1 + v1);
      add(p0 + v0, p1 + v1 - round, p0 + v0, p1 + v1 - round, p0 + v0, p1 + v1 - cp);
    } else {
      add(p0 - v0, p1 - v1, p0 - v0 + cp, p1 - v1, p0 - v0, p1 - v1);
      add(p0 - v0, p1 + v1, p0 - v0, p1 + v1 - cp, p0 - v0, p1 + v1);
      add(p0 + v0, p1 + v1, p0 + v0 - cp, p1 + v1, p0 + v0, p1 + v1);
    }
  }
  return path;
}

export function ellipsePath(p: number[], s: number[], d: number | undefined): PathData {
  const p0 = p[0] ?? 0;
  const p1 = p[1] ?? 0;
  const s0 = (s[0] ?? 0) / 2;
  const s1 = (s[1] ?? 0) / 2;
  const cw = d !== 3;
  const sx = cw ? 1 : -1;
  return {
    v: [
      [p0, p1 - s1],
      [p0 + sx * s0, p1],
      [p0, p1 + s1],
      [p0 - sx * s0, p1],
    ],
    i: [
      [p0 - sx * s0 * KAPPA, p1 - s1],
      [p0 + sx * s0, p1 - s1 * KAPPA],
      [p0 + sx * s0 * KAPPA, p1 + s1],
      [p0 - sx * s0, p1 + s1 * KAPPA],
    ],
    o: [
      [p0 + sx * s0 * KAPPA, p1 - s1],
      [p0 + sx * s0, p1 + s1 * KAPPA],
      [p0 - sx * s0 * KAPPA, p1 + s1],
      [p0 - sx * s0, p1 - s1 * KAPPA],
    ],
    c: true,
  };
}

export interface StarParams {
  star: boolean;
  points: number;
  position: number[];
  rotation: number;
  outerRadius: number;
  outerRoundness: number;
  innerRadius: number;
  innerRoundness: number;
  direction: number | undefined;
}

export function starPath(params: StarParams): PathData {
  const { path, add } = builder(true);
  const dir = params.direction === 3 ? -1 : 1;
  const px = params.position[0] ?? 0;
  const py = params.position[1] ?? 0;
  const count = params.star ? Math.floor(params.points) * 2 : Math.floor(params.points);
  if (count <= 0) return path;
  const angle = (Math.PI * 2) / count;
  let current = -Math.PI / 2 + (params.rotation * Math.PI) / 180;
  const outerSegment = params.star
    ? (2 * Math.PI * params.outerRadius) / (count * 2)
    : (2 * Math.PI * params.outerRadius) / (count * 4);
  const innerSegment = (2 * Math.PI * params.innerRadius) / (count * 2);
  let outer = true;
  for (let n = 0; n < count; n++) {
    const radius = outer ? params.outerRadius : params.innerRadius;
    const roundness = (outer ? params.outerRoundness : params.innerRoundness) / 100;
    const segment = outer ? outerSegment : innerSegment;
    let x = radius * Math.cos(current);
    let y = radius * Math.sin(current);
    const len = Math.sqrt(x * x + y * y);
    const ox = len === 0 ? 0 : y / len;
    const oy = len === 0 ? 0 : -x / len;
    x += px;
    y += py;
    const k = segment * roundness * dir;
    add(x, y, x - ox * k, y - oy * k, x + ox * k, y + oy * k);
    if (params.star) outer = !outer;
    current += angle * dir;
  }
  return path;
}

export const fmt = (n: number): string => {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};

const point = (m: Matrix | undefined, p: number[]): string => {
  const x = p[0] ?? 0;
  const y = p[1] ?? 0;
  if (!m) return `${fmt(x)} ${fmt(y)}`;
  return `${fmt(m[0] * x + m[2] * y + m[4])} ${fmt(m[1] * x + m[3] * y + m[5])}`;
};

export function pathToD(path: PathData, m?: Matrix): string {
  const n = path.v.length;
  if (n === 0) return '';
  const mat = m && !isIdentity(m) ? m : undefined;
  let d = `M${point(mat, path.v[0]!)}`;
  const segment = (from: number, to: number) => {
    d += `C${point(mat, path.o[from]!)} ${point(mat, path.i[to]!)} ${point(mat, path.v[to]!)}`;
  };
  for (let k = 1; k < n; k++) segment(k - 1, k);
  if (path.c) {
    segment(n - 1, 0);
    d += 'Z';
  }
  return d;
}
