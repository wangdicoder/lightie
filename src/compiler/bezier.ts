export type Cubic = [number, number, number, number];

type Point = [number, number];

const curve = (a1: number, a2: number, t: number): number =>
  ((1 - 3 * a2 + 3 * a1) * t + (3 * a2 - 6 * a1)) * t * t + 3 * a1 * t;

const slope = (a1: number, a2: number, t: number): number =>
  3 * (1 - 3 * a2 + 3 * a1) * t * t + 2 * (3 * a2 - 6 * a1) * t + 3 * a1;

export const isLinear = (c: Cubic): boolean => c[0] === c[1] && c[2] === c[3];

export function solveT(x1: number, x2: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  let t = x;
  for (let i = 0; i < 8; i++) {
    const err = curve(x1, x2, t) - x;
    if (Math.abs(err) < 1e-9) return t;
    const d = slope(x1, x2, t);
    if (Math.abs(d) < 1e-7) break;
    t -= err / d;
  }
  let lo = 0;
  let hi = 1;
  t = x;
  for (let i = 0; i < 64; i++) {
    const v = curve(x1, x2, t);
    if (Math.abs(v - x) < 1e-9) break;
    if (v < x) lo = t;
    else hi = t;
    t = (lo + hi) / 2;
  }
  return t;
}

export function ease(c: Cubic, x: number): number {
  if (isLinear(c)) return x;
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return curve(c[1], c[3], solveT(c[0], c[2], x));
}

const lerp = (a: Point, b: Point, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

function split(p: Point[], t: number): [Point[], Point[]] {
  const [p0, p1, p2, p3] = p as [Point, Point, Point, Point];
  const p01 = lerp(p0, p1, t);
  const p12 = lerp(p1, p2, t);
  const p23 = lerp(p2, p3, t);
  const p012 = lerp(p01, p12, t);
  const p123 = lerp(p12, p23, t);
  const mid = lerp(p012, p123, t);
  return [
    [p0, p01, p012, mid],
    [mid, p123, p23, p3],
  ];
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

export interface EaseSlice {
  c: Cubic | null;
  y0: number;
  y1: number;
}

export function sliceEase(c: Cubic, u0: number, u1: number): EaseSlice {
  if (isLinear(c)) return { c: null, y0: u0, y1: u1 };
  const t0 = solveT(c[0], c[2], u0);
  const t1 = solveT(c[0], c[2], u1);
  const full: Point[] = [
    [0, 0],
    [c[0], c[1]],
    [c[2], c[3]],
    [1, 1],
  ];
  const left = t1 >= 1 ? full : split(full, t1)[0];
  const sub = t0 <= 0 ? left : split(left, t1 > 0 ? t0 / t1 : 0)[1];
  const [q0, q1, q2, q3] = sub as [Point, Point, Point, Point];
  const dx = q3[0] - q0[0];
  const dy = q3[1] - q0[1];
  if (dx <= 1e-12 || Math.abs(dy) <= 1e-12) return { c: null, y0: q0[1], y1: q3[1] };
  return {
    c: [clamp01((q1[0] - q0[0]) / dx), (q1[1] - q0[1]) / dy, clamp01((q2[0] - q0[0]) / dx), (q2[1] - q0[1]) / dy],
    y0: q0[1],
    y1: q3[1],
  };
}
