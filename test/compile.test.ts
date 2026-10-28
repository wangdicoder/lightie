import { describe, expect, it } from 'vitest';
import { compile } from '../src/compiler/index';
import type { LottieAnimationData, LottieTransform } from '../src/compiler/lottie';
import { evaluate, normalize } from '../src/compiler/property';
import type { DivNode, Keyframe, SceneNode, SvgNode, SvgPath } from '../src/types';
import { findTrack, fixture, trackValue, walkNodes } from './helpers';

const FIXTURES = [
  'basic-transform',
  'parenting',
  'precomp',
  'dots-loader',
  'shapes',
  'group-animation',
  'paint',
  'stroke-width',
  'trim',
  'morph',
  'shape-params',
  'modifiers',
  'time-remap',
  'matte',
  'mask',
  'spatial',
  'unsupported',
];

describe('compile', () => {
  it.each(FIXTURES)('compiles %s', (name) => {
    const { animation, report } = compile(fixture(name));
    expect(animation.lightie).toBe(1);
    expect(animation.nodes.length).toBeGreaterThan(0);
    expect(report.supported).toBe(name !== 'unsupported');
  });

  it('rejects input that is not a Lottie animation', () => {
    expect(() => compile({ hello: 'world' })).toThrow(TypeError);
  });

  it('reports the features that need the fallback renderer', () => {
    const { animation, report } = compile(fixture('unsupported'), { source: 'embed' });
    expect(report.unsupported.map((u) => u.feature)).toEqual(['expression']);
    expect(report.unsupported[0]?.where).toEqual(['expression']);
    expect(animation.unsupported).toHaveLength(1);
    expect(animation.source).toBeTypeOf('object');
  });

  it('maps keyframe easing exactly onto the compiled tracks', () => {
    const data = fixture('basic-transform') as LottieAnimationData;
    const { animation } = compile(data);
    const card = animation.nodes[0]!;
    const source = data.layers[1]!.ks as LottieTransform;
    const position = normalize(source.p as never, [0, 0, 0]);
    const rotation = normalize(source.r, [0]);
    const scale = normalize(source.s, [100, 100, 100]);
    for (let frame = 0; frame < 60; frame += 0.75) {
      const offset = frame / 60;
      const p = evaluate(position, frame);
      expect(trackValue(findTrack(card, 'translate')!, offset)[0]).toBeCloseTo(p[0]!, 2);
      expect(trackValue(findTrack(card, 'translate')!, offset)[1]).toBeCloseTo(p[1]!, 2);
      expect(trackValue(findTrack(card, 'rotate')!, offset)[0]).toBeCloseTo(evaluate(rotation, frame)[0]!, 2);
      expect(trackValue(findTrack(card, 'scale')!, offset)[1]).toBeCloseTo(evaluate(scale, frame)[1]! / 100, 4);
    }
  });

  it('turns hold keyframes into step easing', () => {
    const { animation } = compile(fixture('basic-transform'));
    const card = animation.nodes[0]!;
    const opacity = findTrack(card, 'opacity')!;
    expect(opacity.k[0]).toEqual([0, 1, 1]);
    expect(trackValue(opacity, 10 / 60)[0]).toBe(1);
    expect(trackValue(opacity, 45 / 60)[0]).toBeCloseTo(0.3, 6);
  });

  it('keeps parent opacity out of the parenting chain', () => {
    const { animation } = compile(fixture('parenting'));
    expect(animation.nodes).toHaveLength(3);
    const grandchild = animation.nodes[2] as DivNode;
    let depth = 0;
    let node: SceneNode = grandchild;
    while (node.k === 'div' && node.c.length === 1 && node.o === undefined && !findTrack(node, 'opacity')) {
      depth++;
      node = node.c[0]!;
    }
    expect(depth).toBe(2);
    expect(node.o).toBe(0.8);
  });

  it('flattens precomp time into root time with clipping and visibility', () => {
    const { animation } = compile(fixture('precomp'));
    const stretched = animation.nodes[animation.nodes.length - 1] as DivNode;
    expect(stretched.clip).toEqual([100, 100]);
    const rotation = findTrack(stretched, 'rotate')!;
    expect(trackValue(rotation, 10 / 90)[0]).toBeCloseTo(-10, 4);
    expect(trackValue(rotation, 45 / 90)[0]).toBeCloseTo(0, 4);
    expect(trackValue(rotation, 80 / 90)[0]).toBeCloseTo(10, 4);
    const visibility = findTrack(stretched, 'opacity')!;
    expect(trackValue(visibility, 5 / 90)[0]).toBe(0);
    expect(trackValue(visibility, 40 / 90)[0]).toBe(1);
    expect(trackValue(visibility, 85 / 90)[0]).toBe(0);
    const ball = (stretched.c.find((n) => n.k === 'svg' && findTrack(n, 'translate')) ?? stretched.c[1]) as SvgNode;
    const bounce = findTrack(ball, 'translate')!;
    const atFrame = (frame: number) => trackValue(bounce, frame / 90)[1]!;
    expect(atFrame(15)).toBeCloseTo(20, 4);
    expect(atFrame(15 + 30)).toBeCloseTo(80, 4);
    expect(atFrame(15 + 60)).toBeCloseTo(20, 4);
  });

  it('compiles animated shape groups to composited divs and static groups to svg', () => {
    const { animation, report } = compile(fixture('group-animation'));
    const kinds: string[] = [];
    walkNodes(animation.nodes, (node, depth) => kinds.push(`${depth}:${node.k}`));
    expect(kinds.filter((k) => k.endsWith('div')).length).toBeGreaterThanOrEqual(4);
    expect(report.tracks.paint).toBe(0);
    expect(report.tracks.composited).toBeGreaterThan(0);
  });

  it('bakes spatial and per-axis motion into linear keyframes', () => {
    const { report } = compile(fixture('spatial'));
    expect(report.tracks.baked).toBeGreaterThanOrEqual(3);
  });

  it('composites colour and opacity animations by cross-fading opaque copies', () => {
    const data = fixture('paint') as LottieAnimationData;
    const { animation, report } = compile(data);
    expect(report.tracks.paint).toBe(0);
    const layer = animation.nodes[0] as DivNode;
    const [stroke, fill] = layer.c as DivNode[];
    const shapes = (data.layers[0]!.shapes ?? []) as unknown as { it: Record<string, unknown>[] }[];
    const sources = [shapes[1]!.it[1]!, shapes[0]!.it[1]!];
    for (const [i, wrapper] of [stroke!, fill!].entries()) {
      const copies = wrapper.c as SvgNode[];
      const paint = (copy: SvgNode) => {
        const path = copy.c[0] as SvgPath;
        return (path.fill ?? path.stroke) as string;
      };
      const color = normalize(sources[i]!.c as never, [0, 0, 0, 1]);
      const opacity = normalize(sources[i]!.o as never, [100]);
      for (let frame = 0; frame < 60; frame += 2.5) {
        const offset = frame / 60;
        let mixed = [255, 255, 255];
        for (const copy of copies) {
          const a = copy.a ? trackValue(copy.a[0]!, offset)[0]! : 1;
          const rgb = [1, 3, 5].map((n) => Number.parseInt(paint(copy).slice(n, n + 2), 16));
          mixed = mixed.map((v, c) => v * (1 - a) + rgb[c]! * a);
        }
        const expected = evaluate(color, frame).map((c) => c * 255);
        for (let c = 0; c < 3; c++) expect(Math.abs(mixed[c]! - expected[c]!)).toBeLessThan(1.5);
        expect(trackValue(wrapper.a![0]!, offset)[0]).toBeCloseTo(evaluate(opacity, frame)[0]! / 100, 4);
      }
    }
  });

  it.each(['modifiers', 'shape-params', 'morph'])(
    'never interpolates between different path topologies in %s',
    (name) => {
      const { animation } = compile(fixture(name));
      const shapes: Keyframe[][] = [];
      walkNodes(animation.nodes, (node) => {
        if (node.k !== 'canvas') return;
        for (const path of node.c)
          for (const shape of path.shapes ?? []) if (Array.isArray(shape.v[0])) shapes.push(shape.v as Keyframe[]);
      });
      expect(shapes.length).toBeGreaterThan(0);
      for (const keys of shapes) {
        for (let i = 0; i < keys.length - 1; i++) {
          const a = keys[i]!;
          const b = keys[i + 1]!;
          if ((a[1] as number[]).length !== (b[1] as number[]).length) expect(a[2]).toBe(1);
        }
      }
    },
  );

  const minimal = (v: string, ks: Record<string, unknown>, color = [1, 0, 0, 1]) => ({
    v,
    fr: 30,
    ip: 0,
    op: 30,
    w: 100,
    h: 100,
    layers: [
      {
        ty: 4,
        ind: 1,
        ip: 0,
        op: 30,
        st: 0,
        ks: {
          o: { a: 0, k: 100 },
          a: { a: 0, k: [0, 0, 0] },
          p: { a: 0, k: [50, 50, 0] },
          s: { a: 0, k: [100, 100, 100] },
          ...ks,
        },
        shapes: [
          { ty: 'rc', d: 1, p: { a: 0, k: [0, 0] }, s: { a: 0, k: [20, 20] }, r: { a: 0, k: 0 } },
          { ty: 'fl', c: { a: 0, k: color }, o: { a: 0, k: 100 } },
        ],
      },
    ],
  });

  it('migrates 0-255 colours from Bodymovin files older than 4.1.9, like lottie-web', () => {
    const fill = (v: string, color: number[]) => {
      const node = compile(minimal(v, { r: { a: 0, k: 0 } }, color)).animation.nodes[0] as SvgNode;
      return (node.c[0] as SvgPath).fill;
    };
    expect(fill('4.0.0', [255, 0, 0, 255])).toBe('#ff0000');
    expect(fill('5.7.0', [1, 0, 0, 1])).toBe('#ff0000');
  });

  it('flattens rx/ry rotation into 2D like lottie-web and ignores rz without rx', () => {
    const tilted = compile(
      minimal('5.7.0', { rx: { a: 0, k: 60 }, ry: { a: 0, k: 0 }, rz: { a: 0, k: 0 }, or: { a: 0, k: [0, 0, 0] } }),
    );
    const m = (tilted.animation.nodes[0] as SvgNode).m!;
    for (const [i, v] of [1, 0, 0, 0.5, 50, 50].entries()) expect(m[i]).toBeCloseTo(v, 5);
    const rzOnly = compile(minimal('5.7.0', { rz: { a: 0, k: 45 } })).animation.nodes[0] as SvgNode;
    expect(rzOnly.r).toBeUndefined();
    expect(rzOnly.m).toBeUndefined();
  });

  it('moves stroke width animations to a canvas painted off the main thread', () => {
    const { animation, report } = compile(fixture('stroke-width'));
    expect(report.tracks).toEqual({ composited: 0, paint: 1, baked: 0 });
    const node = animation.nodes[0]!;
    expect(node.k).toBe('canvas');
    if (node.k !== 'canvas') return;
    const [x, y, w, h] = node.box;
    expect(x).toBeLessThanOrEqual(45 - 11);
    expect(y).toBeLessThanOrEqual(45 - 11);
    expect(x + w).toBeGreaterThanOrEqual(155 + 11);
    expect(y + h).toBeGreaterThanOrEqual(155 + 11);
    expect(node.c[0]!.a?.map((t) => t.p)).toEqual(['strokeWidth']);
  });
});
