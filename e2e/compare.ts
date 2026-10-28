import pixelmatch from 'pixelmatch';
import type { PNG } from 'pngjs';

const TOLERANCE = 48;

const close = (a: Uint8Array, i: number, b: Uint8Array, j: number) =>
  Math.abs(a[i]! - b[j]!) <= TOLERANCE &&
  Math.abs(a[i + 1]! - b[j + 1]!) <= TOLERANCE &&
  Math.abs(a[i + 2]! - b[j + 2]!) <= TOLERANCE;

export function compare(a: PNG, b: PNG, diff: PNG): number {
  const { width, height } = a;
  pixelmatch(a.data, b.data, diff.data, width, height, { threshold: 0.1 });
  const nearby = (source: Uint8Array, x: number, y: number, other: Uint8Array) => {
    const i = (y * width + x) * 4;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (close(source, i, other, (ny * width + nx) * 4)) return true;
      }
    }
    return false;
  };
  let mismatched = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (diff.data[i] !== 255 || diff.data[i + 1]! > 100 || diff.data[i + 2]! > 100) continue;
      if (nearby(a.data, x, y, b.data) && nearby(b.data, x, y, a.data)) {
        diff.data[i + 1] = 180;
        continue;
      }
      mismatched++;
    }
  }
  return mismatched;
}
