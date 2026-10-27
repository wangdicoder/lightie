import { describe, expect, it } from 'vitest';
import { type Cubic, ease, sliceEase } from '../src/compiler/bezier';

const curves: Cubic[] = [
  [0.42, 0, 0.58, 1],
  [0.16, 1, 0.3, 1],
  [0.3, 0, 0.2, 1.6],
  [1, 0, 0.317, 1],
  [0.821, 0, 0.268, 1],
  [0.7, -0.4, 0.4, 1.4],
];

describe('ease', () => {
  it('pins the end points and keeps linear curves linear', () => {
    for (const c of curves) {
      expect(ease(c, 0)).toBe(0);
      expect(ease(c, 1)).toBe(1);
    }
    expect(ease([0.25, 0.25, 0.75, 0.75], 0.3)).toBe(0.3);
  });

  it('is symmetric for the standard ease-in-out', () => {
    expect(ease([0.42, 0, 0.58, 1], 0.5)).toBeCloseTo(0.5, 9);
    expect(ease([0.42, 0, 0.58, 1], 0.25) + ease([0.42, 0, 0.58, 1], 0.75)).toBeCloseTo(1, 9);
  });
});

describe('sliceEase', () => {
  it('reproduces the original curve on any sub-range', () => {
    const ranges: [number, number][] = [
      [0, 0.4],
      [0.25, 0.8],
      [0.6, 1],
      [0.1, 0.15],
    ];
    for (const c of curves) {
      for (const [u0, u1] of ranges) {
        const cut = sliceEase(c, u0, u1);
        for (let s = 0; s <= 20; s++) {
          const local = s / 20;
          const sub = cut.c ? ease(cut.c, local) : local;
          const viaSlice = cut.y0 + (cut.y1 - cut.y0) * sub;
          expect(viaSlice).toBeCloseTo(ease(c, u0 + (u1 - u0) * local), 6);
        }
        for (const v of cut.c ?? []) expect(Number.isFinite(v)).toBe(true);
      }
    }
  });
});
