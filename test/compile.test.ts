import { describe, expect, it } from 'vitest';
import { compile } from '../src/compiler/index';
import type { LottieAnimationData, LottieTransform } from '../src/compiler/lottie';
import { evaluate, normalize } from '../src/compiler/property';
import type { DivNode, SceneNode, SvgNode } from '../src/types';
import { findTrack, fixture, trackValue, walkNodes } from './helpers';

const FIXTURES = [
  'basic-transform',
  'parenting',
  'precomp',
  'dots-loader',
  'shapes',
  'group-animation',
  'paint',
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
    expect(report.unsupported.map((u) => u.feature).sort()).toEqual(['animated path', 'expression', 'trim path']);
    expect(report.unsupported.find((u) => u.feature === 'trim path')?.where).toEqual(['trim']);
    expect(animation.unsupported).toHaveLength(3);
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

  it('keeps paint animations on the svg path', () => {
    const { animation, report } = compile(fixture('paint'));
    expect(report.tracks.paint).toBe(4);
    const svg = animation.nodes[0] as SvgNode;
    expect(svg.k).toBe('svg');
  });
});
