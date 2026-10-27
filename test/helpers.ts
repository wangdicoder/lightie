import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ease } from '../src/compiler/bezier';
import type { Keyframe, SceneNode, Track, TrackProperty } from '../src/types';

export const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(import.meta.dirname, '..', 'fixtures', `${name}.json`), 'utf8'));

export function trackValue(track: Track, offset: number): number[] {
  const k = track.k;
  const vec = (f: Keyframe) => (Array.isArray(f[1]) ? f[1] : [f[1]]);
  const first = k[0]!;
  if (offset <= first[0]) return vec(first);
  for (let n = 0; n < k.length - 1; n++) {
    const a = k[n]!;
    const b = k[n + 1]!;
    if (offset < b[0]) {
      const span = b[0] - a[0];
      const u = span > 0 ? (offset - a[0]) / span : 1;
      const e = a[2];
      const p = e === undefined ? u : e === 1 ? 0 : ease(e, u);
      const va = vec(a);
      const vb = vec(b);
      return va.map((v, i) => v + ((vb[i] ?? v) - v) * p);
    }
  }
  return vec(k[k.length - 1]!);
}

export function findTrack(node: SceneNode, p: TrackProperty): Track | undefined {
  return node.a?.find((t) => t.p === p);
}

export function walkNodes(nodes: SceneNode[], visit: (node: SceneNode, depth: number) => void, depth = 0) {
  for (const node of nodes) {
    visit(node, depth);
    if (node.k === 'div') walkNodes(node.c, visit, depth + 1);
  }
}
