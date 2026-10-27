import type {
  DivNode,
  Gradient,
  Matrix,
  SceneNode,
  SvgGroup,
  SvgItem,
  SvgNode,
  SvgPath,
  TrackProperty,
} from '../types';
import {
  composeTransform,
  ellipsePath,
  fromLottiePath,
  IDENTITY,
  isIdentity,
  multiply,
  type PathData,
  pathToD,
  rectPath,
  starPath,
} from './geometry';
import type { LottiePathValue, LottieProperty, LottieShape, LottieTransform } from './lottie';
import { hasExpression, hasKeyframes, type NormProp, normalize } from './property';
import { buildKeys, isConstant, round, type TimeMap, type TrackContext, toTrack } from './track';
import { compileTransform, type Issues } from './transform';

interface ShapeRef {
  item: LottieShape;
  chain: (LottieShape | undefined)[];
}

interface StyleOp {
  kind: 'style';
  item: LottieShape;
  depth: number;
  shapes: ShapeRef[];
}

interface GroupOp {
  kind: 'group';
  item: LottieShape;
  tr: LottieShape | undefined;
  ops: Op[];
  html: boolean;
}

type Op = StyleOp | GroupOp;

const STYLES = new Set(['fl', 'st', 'gf', 'gs']);
const GEOMETRY = new Set(['sh', 'rc', 'el', 'sr']);
const MODIFIERS: Record<string, string> = {
  tm: 'trim path',
  rd: 'rounded corners',
  rp: 'repeater',
  pb: 'pucker & bloat',
  zz: 'zig zag',
  op: 'offset path',
  tw: 'twist',
  ms: 'merge shapes',
};
const TRANSFORM_KEYS = ['p', 'a', 's', 'r', 'sk', 'sa'] as const;
const BLEND_MODES = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
];
const CAPS = { 1: 'butt', 2: 'round', 3: 'square' } as const;
const JOINS = { 1: 'miter', 2: 'round', 3: 'bevel' } as const;

const prop = (shape: LottieShape, key: string): LottieProperty | undefined => shape[key] as LottieProperty | undefined;

export function blendMode(bm: number | undefined, issues: Issues): string | undefined {
  if (!bm) return undefined;
  const mode = BLEND_MODES[bm];
  if (!mode) issues.add(`blend mode ${bm}`);
  return mode;
}

const isMoving = (tr: LottieShape | undefined): boolean =>
  !!tr && TRANSFORM_KEYS.some((key) => hasKeyframes(prop(tr, key)) || hasExpression(prop(tr, key)));

const isAnimatedGroup = (tr: LottieShape | undefined): boolean =>
  !!tr && (isMoving(tr) || hasKeyframes(prop(tr, 'o')) || hasExpression(prop(tr, 'o')));

const staticOf = (p: LottieProperty | undefined, fallback: number[]): number[] => {
  const n = normalize(p, fallback);
  return n.kind === 'static' ? n.v : n.keys[0]!.v;
};

function staticMatrix(tr: LottieShape): Matrix {
  return composeTransform({
    anchor: staticOf(prop(tr, 'a'), [0, 0]),
    position: staticOf(prop(tr, 'p'), [0, 0]),
    scale: staticOf(prop(tr, 's'), [100, 100]),
    rotation: staticOf(prop(tr, 'r'), [0])[0] ?? 0,
    skew: staticOf(prop(tr, 'sk'), [0])[0] ?? 0,
    skewAxis: staticOf(prop(tr, 'sa'), [0])[0] ?? 0,
  });
}

const roundMatrix = (m: Matrix): Matrix => m.map((v) => round(v, 6)) as Matrix;

function walk(items: LottieShape[], chain: (LottieShape | undefined)[], open: StyleOp[], issues: Issues): Op[] {
  const ops: Op[] = [];
  const own: StyleOp[] = [];
  for (let n = items.length - 1; n >= 0; n--) {
    const item = items[n]!;
    if (STYLES.has(item.ty)) {
      if (item.hd) continue;
      const op: StyleOp = { kind: 'style', item, depth: chain.length, shapes: [] };
      own.push(op);
      open.push(op);
      ops.push(op);
    } else if (item.ty === 'gr') {
      const children = Array.isArray(item.it) ? (item.it as LottieShape[]) : [];
      const tr = children.find((child) => child.ty === 'tr');
      const childOps = walk(children, [...chain, tr], open, issues);
      const html = isAnimatedGroup(tr) || childOps.some((child) => child.kind === 'group' && child.html);
      ops.push({ kind: 'group', item, tr, ops: childOps, html });
    } else if (GEOMETRY.has(item.ty)) {
      if (item.hd) continue;
      for (const style of open) style.shapes.push({ item, chain });
    } else {
      const modifier = MODIFIERS[item.ty];
      if (modifier) issues.add(modifier);
    }
  }
  for (const style of own) open.splice(open.indexOf(style), 1);
  return ops;
}

function staticGeometryValue(shape: LottieShape, key: string, fallback: number[], issues: Issues): number[] {
  const p = prop(shape, key);
  if (hasKeyframes(p))
    issues.add(`animated ${shape.ty === 'rc' ? 'rectangle' : shape.ty === 'el' ? 'ellipse' : 'polystar'}`);
  return staticOf(p, fallback);
}

function geometry(shape: LottieShape, issues: Issues): PathData | null {
  switch (shape.ty) {
    case 'sh': {
      const ks = prop(shape, 'ks');
      if (!ks) return null;
      if (hasKeyframes(ks)) {
        issues.add('animated path');
        const first = (ks.k as { s?: unknown[] }[])[0]?.s?.[0] as LottiePathValue | undefined;
        return first?.v ? fromLottiePath(first) : null;
      }
      const value = (Array.isArray(ks.k) ? ks.k[0] : ks.k) as LottiePathValue | undefined;
      return value?.v ? fromLottiePath(value) : null;
    }
    case 'rc':
      return rectPath(
        staticGeometryValue(shape, 'p', [0, 0], issues),
        staticGeometryValue(shape, 's', [0, 0], issues),
        staticGeometryValue(shape, 'r', [0], issues)[0] ?? 0,
        shape.d as number | undefined,
      );
    case 'el':
      return ellipsePath(
        staticGeometryValue(shape, 'p', [0, 0], issues),
        staticGeometryValue(shape, 's', [0, 0], issues),
        shape.d as number | undefined,
      );
    case 'sr':
      return starPath({
        star: shape.sy !== 2,
        points: staticGeometryValue(shape, 'pt', [5], issues)[0] ?? 5,
        position: staticGeometryValue(shape, 'p', [0, 0], issues),
        rotation: staticGeometryValue(shape, 'r', [0], issues)[0] ?? 0,
        outerRadius: staticGeometryValue(shape, 'or', [0], issues)[0] ?? 0,
        outerRoundness: staticGeometryValue(shape, 'os', [0], issues)[0] ?? 0,
        innerRadius: staticGeometryValue(shape, 'ir', [0], issues)[0] ?? 0,
        innerRoundness: staticGeometryValue(shape, 'is', [0], issues)[0] ?? 0,
        direction: shape.d as number | undefined,
      });
    default:
      return null;
  }
}

const channel = (c: number): string =>
  Math.min(255, Math.max(0, Math.floor(c)))
    .toString(16)
    .padStart(2, '0');

const hex = (rgb: number[]): string => `#${channel(rgb[0] ?? 0)}${channel(rgb[1] ?? 0)}${channel(rgb[2] ?? 0)}`;

function addTrack(
  path: SvgPath,
  p: TrackProperty,
  norm: NormProp,
  map: TimeMap,
  ctx: TrackContext,
  dims: number[],
  convert: (v: number[]) => number[],
): number[] | null {
  const keys = buildKeys(norm, map, dims, ctx);
  if (!keys || isConstant(keys)) return keys ? keys[0]!.v : null;
  path.a = [...(path.a ?? []), toTrack(p, keys, convert, ctx)];
  return null;
}

function applyColor(
  path: SvgPath,
  which: 'fill' | 'stroke',
  p: LottieProperty | undefined,
  map: TimeMap,
  ctx: TrackContext,
) {
  const norm = normalize(p, [0, 0, 0, 1]);
  const toRgb = (v: number[]) => v.slice(0, 3).map((c) => c * 255);
  const constant = addTrack(path, which, norm, map, ctx, [0, 1, 2], toRgb);
  const value = constant ?? (norm.kind === 'static' ? norm.v : norm.keys[0]!.v);
  path[which] = hex(toRgb(value));
}

function applyOpacity(
  path: SvgPath,
  which: 'fillOpacity' | 'strokeOpacity',
  p: LottieProperty | undefined,
  map: TimeMap,
  ctx: TrackContext,
) {
  const norm = normalize(p, [100]);
  const constant = addTrack(path, which, norm, map, ctx, [0], (v) => [(v[0] ?? 100) / 100]);
  const value = constant ?? (norm.kind === 'static' ? norm.v : null);
  if (!value) return;
  const o = round((value[0] ?? 100) / 100);
  if (o !== 1) path[which === 'fillOpacity' ? 'fo' : 'so'] = o;
}

function applyStrokeStyle(path: SvgPath, shape: LottieShape, map: TimeMap, ctx: TrackContext, issues: Issues) {
  applyOpacity(path, 'strokeOpacity', prop(shape, 'o'), map, ctx);
  const width = normalize(prop(shape, 'w'), [1]);
  const constant = addTrack(path, 'strokeWidth', width, map, ctx, [0], (v) => v);
  const value = constant ?? (width.kind === 'static' ? width.v : null);
  if (value) path.sw = round(value[0] ?? 1);
  path.lc = CAPS[(shape.lc as 1 | 2 | 3) || 2] ?? 'round';
  path.lj = JOINS[(shape.lj as 1 | 2 | 3) || 2] ?? 'round';
  if (shape.lj === 1 && typeof shape.ml === 'number') path.ml = shape.ml;
  const dashes = Array.isArray(shape.d) ? (shape.d as { n?: string; v?: LottieProperty }[]) : [];
  if (dashes.length) {
    const dash: number[] = [];
    for (const entry of dashes) {
      if (hasKeyframes(entry.v)) issues.add('animated dashes');
      const v = staticOf(entry.v, [0])[0] ?? 0;
      if (entry.n === 'o') path.dashOffset = round(v);
      else dash.push(round(v));
    }
    if (dash.length) path.dash = dash;
  }
}

const interpolate = (stops: number[][], offset: number, from: number): number[] => {
  const first = stops[0]!;
  const last = stops[stops.length - 1]!;
  if (offset <= first[0]!) return first.slice(from);
  if (offset >= last[0]!) return last.slice(from);
  for (let n = 1; n < stops.length; n++) {
    const b = stops[n]!;
    if (offset <= b[0]!) {
      const a = stops[n - 1]!;
      const span = b[0]! - a[0]!;
      const f = span > 0 ? (offset - a[0]!) / span : 0;
      return a.slice(from).map((v, i) => v + ((b[from + i] ?? v) - v) * f);
    }
  }
  return last.slice(from);
};

function gradientOf(shape: LottieShape, issues: Issues): Gradient {
  const g = shape.g as { p?: number; k?: LottieProperty } | undefined;
  const keys = ['s', 'e', 'h', 'a'].map((key) => prop(shape, key));
  if (keys.some(hasKeyframes) || hasKeyframes(g?.k)) issues.add('animated gradient');
  const start = staticOf(prop(shape, 's'), [0, 0]);
  const end = staticOf(prop(shape, 'e'), [0, 0]);
  const raw = staticOf(g?.k, []);
  const count = g?.p ?? 0;
  const colors: number[][] = [];
  for (let n = 0; n < count; n++) {
    const base = n * 4;
    colors.push([
      Math.round((raw[base] ?? 0) * 100) / 100,
      Math.round((raw[base + 1] ?? 0) * 255),
      Math.round((raw[base + 2] ?? 0) * 255),
      Math.round((raw[base + 3] ?? 0) * 255),
    ]);
  }
  const alphas: number[][] = [];
  for (let n = count * 4; n + 1 < raw.length; n += 2)
    alphas.push([Math.round((raw[n] ?? 0) * 100) / 100, raw[n + 1] ?? 1]);
  const offsets = [...new Set([...colors, ...alphas].map((s) => s[0]!))].sort((a, b) => a - b);
  const stops: Gradient['stops'] = colors.length
    ? (alphas.length ? offsets : colors.map((c) => c[0]!)).map((offset) => [
        offset,
        hex(interpolate(colors, offset, 1).map(Math.round)),
        alphas.length ? round(interpolate(alphas, offset, 1)[0] ?? 1) : 1,
      ])
    : [];
  if (shape.t === 2) {
    const r = Math.hypot((end[0] ?? 0) - (start[0] ?? 0), (end[1] ?? 0) - (start[1] ?? 0));
    const angle = Math.atan2((end[1] ?? 0) - (start[1] ?? 0), (end[0] ?? 0) - (start[0] ?? 0));
    const percent = Math.max(-0.99, Math.min(0.99, (staticOf(prop(shape, 'h'), [0])[0] ?? 0) / 100));
    const highlight = angle + ((staticOf(prop(shape, 'a'), [0])[0] ?? 0) * Math.PI) / 180;
    const fx = Math.cos(highlight) * r * percent + (start[0] ?? 0);
    const fy = Math.sin(highlight) * r * percent + (start[1] ?? 0);
    return { type: 'radial', p: [start[0] ?? 0, start[1] ?? 0, r, fx, fy].map((v) => round(v, 3)), stops };
  }
  return { type: 'linear', p: [start[0] ?? 0, start[1] ?? 0, end[0] ?? 0, end[1] ?? 0].map((v) => round(v, 3)), stops };
}

function stylePath(op: StyleOp, map: TimeMap, ctx: TrackContext, issues: Issues): SvgPath | null {
  let d = '';
  for (const ref of op.shapes) {
    const between = ref.chain.slice(op.depth);
    if (between.some(isMoving)) {
      issues.add('animated group transform between a style and its shapes');
      continue;
    }
    let m: Matrix = IDENTITY;
    for (const tr of between) if (tr) m = multiply(m, staticMatrix(tr));
    const geo = geometry(ref.item, issues);
    if (geo) d += pathToD(geo, m);
  }
  if (!d) return null;
  const style = op.item;
  const path: SvgPath = { d };
  const bm = blendMode(style.bm, issues);
  if (bm) path.bm = bm;
  switch (style.ty) {
    case 'fl':
      applyColor(path, 'fill', prop(style, 'c'), map, ctx);
      applyOpacity(path, 'fillOpacity', prop(style, 'o'), map, ctx);
      if (style.r === 2) path.rule = 'evenodd';
      break;
    case 'st':
      applyColor(path, 'stroke', prop(style, 'c'), map, ctx);
      applyStrokeStyle(path, style, map, ctx, issues);
      break;
    case 'gf':
      path.fill = gradientOf(style, issues);
      applyOpacity(path, 'fillOpacity', prop(style, 'o'), map, ctx);
      if (style.r === 2) path.rule = 'evenodd';
      break;
    case 'gs':
      path.stroke = gradientOf(style, issues);
      applyStrokeStyle(path, style, map, ctx, issues);
      break;
  }
  return path;
}

function svgGroup(op: GroupOp, map: TimeMap, ctx: TrackContext, issues: Issues): SvgItem | null {
  const group: SvgGroup = { g: [] };
  if (op.tr) {
    const m = staticMatrix(op.tr);
    if (!isIdentity(m)) group.m = roundMatrix(m);
    const o = (staticOf(prop(op.tr, 'o'), [100])[0] ?? 100) / 100;
    if (o !== 1) group.o = round(o);
  }
  const bm = blendMode(op.item.bm, issues);
  if (bm) group.bm = bm;
  for (const child of op.ops) {
    const item = child.kind === 'style' ? stylePath(child, map, ctx, issues) : svgGroup(child, map, ctx, issues);
    if (item) group.g.push(item);
  }
  if (!group.g.length) return null;
  if (!group.m && group.o === undefined && !group.bm && group.g.length === 1) return group.g[0]!;
  return group;
}

function emit(ops: Op[], target: SceneNode[], map: TimeMap, ctx: TrackContext, issues: Issues) {
  let svg: SvgNode | null = null;
  const into = (item: SvgItem) => {
    if (!svg) {
      svg = { k: 'svg', c: [] };
      target.push(svg);
    }
    svg.c.push(item);
  };
  for (const op of ops) {
    if (op.kind === 'style') {
      const path = stylePath(op, map, ctx, issues);
      if (path) into(path);
    } else if (!op.html) {
      const group = svgGroup(op, map, ctx, issues);
      if (group) into(group);
    } else {
      svg = null;
      const div: DivNode = {
        k: 'div',
        c: [],
        ...(op.tr ? compileTransform(op.tr as LottieTransform, map, ctx, issues, { opacity: true }) : {}),
      };
      const bm = blendMode(op.item.bm, issues);
      if (bm) div.bm = bm;
      emit(op.ops, div.c, map, ctx, issues);
      if (div.c.length) target.push(div);
    }
  }
}

export function compileShapes(shapes: LottieShape[], map: TimeMap, ctx: TrackContext, issues: Issues): SceneNode[] {
  const out: SceneNode[] = [];
  emit(walk(shapes, [], [], issues), out, map, ctx, issues);
  return out;
}
