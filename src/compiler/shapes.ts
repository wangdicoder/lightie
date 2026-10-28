import type {
  CanvasShape,
  DivNode,
  Gradient,
  Keyframe,
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
  rotation,
  roundCorners,
  scaling,
  starPath,
  translation,
} from './geometry';
import type { LottieKeyframe, LottiePathValue, LottieProperty, LottieShape, LottieTransform } from './lottie';
import { easesOf, evaluate, hasExpression, hasKeyframes, type NormKey, type NormProp, normalize } from './property';
import {
  buildKeys,
  fromRoot,
  isConstant,
  type K,
  type KEase,
  offsetOf,
  round,
  sample,
  type TimeMap,
  type TrackContext,
  toKeyframes,
  toTrack,
} from './track';
import { compileTransform, type Issues } from './transform';

interface ShapeRef {
  item: LottieShape;
  chain: (LottieShape | undefined)[];
  trims: LottieShape[];
}

interface StyleOp {
  kind: 'style';
  item: LottieShape;
  depth: number;
  shapes: ShapeRef[];
  mode: 'svg' | 'composite' | 'canvas';
  html: boolean;
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

const isStroke = (style: LottieShape): boolean => style.ty === 'st' || style.ty === 'gs';

function paintMode(style: LottieShape): StyleOp['mode'] {
  const colored = style.ty === 'fl' || style.ty === 'st';
  const animatedPaint = (colored && hasKeyframes(prop(style, 'c'))) || hasKeyframes(prop(style, 'o'));
  if (isStroke(style) && hasKeyframes(prop(style, 'w'))) return 'canvas';
  if (!animatedPaint) return 'svg';
  return style.bm ? 'canvas' : 'composite';
}

const staticOf = (p: LottieProperty | undefined, fallback: number[]): number[] => {
  const n = normalize(p, fallback);
  return n.kind === 'static' ? n.v : n.keys[0]!.v;
};

function expandRepeaters(items: LottieShape[], issues: Issues): LottieShape[] {
  let list = items.map((item) =>
    item.ty === 'gr' && Array.isArray(item.it)
      ? { ...item, it: expandRepeaters(item.it as LottieShape[], issues) }
      : item,
  );
  for (let n = 0; n < list.length; n++) {
    const rp = list[n]!;
    if (rp.ty !== 'rp' || rp.hd) continue;
    const tr = (rp.tr ?? {}) as LottieShape;
    const keys = ['a', 'p', 's', 'r', 'so', 'eo'];
    if ([prop(rp, 'c'), prop(rp, 'o'), ...keys.map((key) => prop(tr, key))].some(hasKeyframes))
      issues.add('animated repeater');
    const copies = Math.max(0, Math.ceil(staticOf(prop(rp, 'c'), [1])[0] ?? 1));
    const offset = staticOf(prop(rp, 'o'), [0])[0] ?? 0;
    const anchor = staticOf(prop(tr, 'a'), [0, 0]);
    const position = staticOf(prop(tr, 'p'), [0, 0]);
    const scale = staticOf(prop(tr, 's'), [100, 100]).map((v) => v / 100);
    const turn = staticOf(prop(tr, 'r'), [0])[0] ?? 0;
    const so = (staticOf(prop(tr, 'so'), [100])[0] ?? 100) / 100;
    const eo = (staticOf(prop(tr, 'eo'), [100])[0] ?? 100) / 100;
    const partial = (perc: number) => scale.map((s) => s + (1 - s) * (1 - perc));
    const whole = offset > 0 ? Math.floor(offset) : Math.ceil(offset);
    const fraction = offset % 1;
    let base = [1, 1];
    for (let w = 0; w < Math.abs(whole); w++) base = base.map((b, d) => (offset > 0 ? b * scale[d]! : b / scale[d]!));
    if (fraction) {
      const step = partial(Math.abs(fraction));
      base = base.map((b, d) => (offset > 0 ? b * step[d]! : b / step[d]!));
    }
    const source = list.slice(0, n);
    const groups: LottieShape[] = [];
    for (let i = 0; i < copies; i++) {
      const j = rp.m === 2 ? copies - 1 - i : i;
      const k = offset + j;
      const sx = (base[0] ?? 1) * (scale[0] ?? 1) ** j;
      const sy = (base[1] ?? 1) * (scale[1] ?? 1) ** j;
      const matrix = multiply(
        translation((position[0] ?? 0) * k + (anchor[0] ?? 0), (position[1] ?? 0) * k + (anchor[1] ?? 0)),
        multiply(scaling(sx, sy), multiply(rotation(turn * k), translation(-(anchor[0] ?? 0), -(anchor[1] ?? 0)))),
      );
      const opacity = copies === 1 ? so : so + ((eo - so) * i) / (copies - 1);
      groups.push({
        ty: 'gr',
        nm: `${rp.nm ?? 'repeater'} ${i}`,
        it: [...structuredClone(source), { ty: 'tr', __m: matrix, o: { a: 0, k: opacity * 100 } }],
      });
    }
    list = [...groups, ...list.slice(n + 1)];
    n = groups.length - 1;
  }
  return list;
}

function staticMatrix(tr: LottieShape): Matrix {
  const preset = (tr as { __m?: Matrix }).__m;
  if (preset) return preset;
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

const isMorphing = (shape: LottieShape): boolean =>
  shape.ty === 'sh'
    ? hasKeyframes(prop(shape, 'ks'))
    : (PARAMS[shape.ty] ?? []).some((key) => hasKeyframes(prop(shape, key)));

function walk(
  items: LottieShape[],
  chain: (LottieShape | undefined)[],
  open: StyleOp[],
  trims: LottieShape[],
  issues: Issues,
): Op[] {
  const ops: Op[] = [];
  const own: StyleOp[] = [];
  const ownTrims: LottieShape[] = [];
  for (let n = items.length - 1; n >= 0; n--) {
    const item = items[n]!;
    if (STYLES.has(item.ty)) {
      if (item.hd) continue;
      const mode = paintMode(item);
      const op: StyleOp = { kind: 'style', item, depth: chain.length, shapes: [], mode, html: mode !== 'svg' };
      own.push(op);
      open.push(op);
      ops.push(op);
    } else if (item.ty === 'gr') {
      const children = Array.isArray(item.it) ? (item.it as LottieShape[]) : [];
      const tr = children.find((child) => child.ty === 'tr');
      const childOps = walk(children, [...chain, tr], open, trims, issues);
      const html = isAnimatedGroup(tr) || childOps.some((child) => child.html);
      ops.push({ kind: 'group', item, tr, ops: childOps, html });
    } else if (GEOMETRY.has(item.ty)) {
      if (item.hd) continue;
      if (trims.filter((mod) => mod.ty === 'tm').length > 1) issues.add('multiple trim paths');
      for (const style of open) style.shapes.push({ item, chain, trims: trims.slice() });
    } else if (item.ty === 'tm' || item.ty === 'rd') {
      if (item.hd) continue;
      ownTrims.push(item);
      trims.push(item);
    } else {
      const modifier = MODIFIERS[item.ty];
      if (modifier) issues.add(modifier);
    }
  }
  for (const style of own) {
    open.splice(open.indexOf(style), 1);
    if (style.shapes.some((ref) => ref.trims.some(needsCanvas) || isMorphing(ref.item))) {
      style.mode = 'canvas';
      style.html = true;
    }
  }
  for (const trim of ownTrims) trims.splice(trims.indexOf(trim), 1);
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
    default:
      return parametric(shape, (key, fallback) => staticGeometryValue(shape, key, fallback, issues));
  }
}

type Values = (key: string, fallback: number[]) => number[];

const PARAMS: Record<string, string[]> = {
  rc: ['p', 's', 'r'],
  el: ['p', 's'],
  sr: ['p', 'r', 'or', 'ir', 'os', 'is', 'pt'],
};
const LINEAR_PARAMS: Record<string, string[]> = { rc: ['p', 's'], el: ['p', 's'], sr: ['p', 'or', 'ir'] };

function parametric(shape: LottieShape, value: Values): PathData | null {
  switch (shape.ty) {
    case 'rc':
      return rectPath(value('p', [0, 0]), value('s', [0, 0]), value('r', [0])[0] ?? 0, shape.d as number | undefined);
    case 'el':
      return ellipsePath(value('p', [0, 0]), value('s', [0, 0]), shape.d as number | undefined);
    case 'sr':
      return starPath({
        star: shape.sy !== 2,
        points: value('pt', [5])[0] ?? 5,
        position: value('p', [0, 0]),
        rotation: value('r', [0])[0] ?? 0,
        outerRadius: value('or', [0])[0] ?? 0,
        outerRoundness: value('os', [0])[0] ?? 0,
        innerRadius: value('ir', [0])[0] ?? 0,
        innerRoundness: value('is', [0])[0] ?? 0,
        direction: shape.d as number | undefined,
      });
    default:
      return null;
  }
}

const roundRadius = (mod: LottieShape, t?: number): number =>
  (t === undefined ? staticOf(prop(mod, 'r'), [0]) : evaluate(normalize(prop(mod, 'r'), [0]), t))[0] ?? 0;

const withRounds = (geo: PathData, ref: ShapeRef, t?: number): PathData =>
  ref.trims.reduce((g, mod) => (mod.ty === 'rd' ? roundCorners(g, roundRadius(mod, t)) : g), geo);

function shapeGeometry(ref: ShapeRef, issues: Issues): PathData | null {
  const geo = geometry(ref.item, issues);
  return geo && withRounds(geo, ref);
}

const needsCanvas = (mod: LottieShape): boolean => mod.ty === 'tm' || hasKeyframes(prop(mod, 'r'));

function parametricMorph(
  ref: ShapeRef,
  m: Matrix,
  map: TimeMap,
  ctx: TrackContext,
  issues: Issues,
): CanvasShape | null {
  const shape = ref.item;
  const animated = (PARAMS[shape.ty] ?? []).filter((key) => hasKeyframes(prop(shape, key)));
  if (animated.includes('pt')) issues.add('animated polystar points');
  const fixedValue: Values = (key, fallback) => staticOf(prop(shape, key), fallback);
  const only = animated.length === 1 ? animated[0]! : undefined;
  const rounded =
    (shape.ty === 'rc' && (fixedValue('r', [0])[0] ?? 0) !== 0) ||
    ref.trims.some((mod) => mod.ty === 'rd' && hasKeyframes(prop(mod, 'r')));
  if (only && LINEAR_PARAMS[shape.ty]?.includes(only) && !rounded && !ref.trims.some((mod) => mod.ty === 'rd')) {
    const norm = normalize(prop(shape, only), [0, 0]);
    if (norm.kind === 'anim' && !norm.keys.some((key) => key.to || key.ti)) {
      const keys: NormKey[] = [];
      for (const key of norm.keys) {
        const geo = parametric(shape, (name, fallback) => (name === only ? key.v : fixedValue(name, fallback)));
        if (geo) keys.push({ t: key.t, hold: key.hold, ease: key.ease, v: flatten(geo, m) });
      }
      const first = keys[0];
      const built = first
        ? buildKeys(
            { kind: 'anim', keys },
            map,
            first.v.map((_, i) => i),
            ctx,
          )
        : null;
      if (built) {
        if (isConstant(built)) return { c: true, v: built[0]!.v };
        ctx.stats.paint++;
        return { c: true, v: toKeyframes(built, (v) => v, 3) };
      }
    }
  }
  return sampled(
    (frame) => {
      const t = fromRoot(map, frame);
      const geo = parametric(shape, (name, fallback) =>
        name === 'pt' ? fixedValue(name, fallback) : evaluate(normalize(prop(shape, name), fallback), t),
      );
      return geo ? flatten(withRounds(geo, ref, t), m) : [];
    },
    true,
    ctx,
  );
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

type Bounds = [number, number, number, number];

function styleD(op: StyleOp, issues: Issues, bounds?: Bounds): string {
  let d = '';
  for (const ref of op.shapes) {
    const between = ref.chain.slice(op.depth);
    if (between.some(isMoving)) {
      issues.add('animated group transform between a style and its shapes');
      continue;
    }
    let m: Matrix = IDENTITY;
    for (const tr of between) if (tr) m = multiply(m, staticMatrix(tr));
    const geo = shapeGeometry(ref, issues);
    if (!geo) continue;
    d += pathToD(geo, m);
    if (bounds) {
      for (const p of [...geo.v, ...geo.i, ...geo.o]) {
        const x = m[0] * (p[0] ?? 0) + m[2] * (p[1] ?? 0) + m[4];
        const y = m[1] * (p[0] ?? 0) + m[3] * (p[1] ?? 0) + m[5];
        bounds[0] = Math.min(bounds[0], x);
        bounds[1] = Math.min(bounds[1], y);
        bounds[2] = Math.max(bounds[2], x);
        bounds[3] = Math.max(bounds[3], y);
      }
    }
  }
  return d;
}

function flatten(path: PathData, m: Matrix): number[] {
  const out: number[] = [];
  const at = (p: number[] | undefined) => {
    const x = p?.[0] ?? 0;
    const y = p?.[1] ?? 0;
    out.push(round(m[0] * x + m[2] * y + m[4], 3), round(m[1] * x + m[3] * y + m[5], 3));
  };
  for (const [n, v] of path.v.entries()) {
    at(v);
    at(path.i[n]);
    at(path.o[n]);
  }
  return out;
}

function sampled(evalAt: (frame: number) => number[], closed: boolean, ctx: TrackContext): CanvasShape {
  const { win } = ctx;
  const keys: K[] = [
    ...sample(evalAt, win.ip, win.op, ctx),
    { o: offsetOf(win, win.op), v: evalAt(win.op), e: 'linear' },
  ];
  ctx.stats.baked++;
  return { c: closed, v: toKeyframes(keys, (v) => v, 3) };
}

function canvasShape(ref: ShapeRef, m: Matrix, map: TimeMap, ctx: TrackContext, issues: Issues): CanvasShape | null {
  if (!isMorphing(ref.item)) {
    const geo = shapeGeometry(ref, issues);
    if (!geo) return null;
    if (!ref.trims.some((mod) => mod.ty === 'rd' && hasKeyframes(prop(mod, 'r'))))
      return { c: geo.c, v: flatten(geo, m) };
    const base = geometry(ref.item, issues);
    return sampled((frame) => (base ? flatten(withRounds(base, ref, fromRoot(map, frame)), m) : []), geo.c, ctx);
  }
  if (ref.item.ty !== 'sh') return parametricMorph(ref, m, map, ctx, issues);
  if (ref.trims.some((mod) => mod.ty === 'rd' && hasKeyframes(prop(mod, 'r'))))
    issues.add('animated rounded corners on a morphing path');
  const frames = prop(ref.item, 'ks')!.k as LottieKeyframe[];
  const keys: NormKey[] = [];
  let closed = true;
  for (const [n, kf] of frames.entries()) {
    const value =
      (kf.s as LottiePathValue[] | undefined)?.[0] ?? (frames[n - 1]?.e as LottiePathValue[] | undefined)?.[0];
    if (!value?.v) continue;
    closed = value.c ?? closed;
    keys.push({
      t: kf.t,
      v: flatten(withRounds(fromLottiePath(value), ref), m),
      hold: kf.h === 1,
      ease: easesOf(kf.o, kf.i),
    });
  }
  const first = keys[0];
  if (!first) return null;
  if (keys.length === 1) return { c: closed, v: first.v };
  const built = buildKeys(
    { kind: 'anim', keys },
    map,
    first.v.map((_, i) => i),
    ctx,
  );
  if (!built) return null;
  if (isConstant(built)) return { c: closed, v: built[0]!.v };
  ctx.stats.paint++;
  return { c: closed, v: toKeyframes(built, (v) => v, 3) };
}

function trimValue(
  p: LottieProperty | undefined,
  fallback: number,
  map: TimeMap,
  ctx: TrackContext,
): number | Keyframe[] {
  const norm = normalize(p, [fallback]);
  const keys = buildKeys(norm, map, [0], ctx);
  if (!keys) return norm.kind === 'static' ? (norm.v[0] ?? fallback) : fallback;
  if (isConstant(keys)) return keys[0]!.v[0] ?? fallback;
  ctx.stats.paint++;
  return toKeyframes(keys, (v) => v);
}

function canvasStyle(op: StyleOp, map: TimeMap, ctx: TrackContext, issues: Issues): SceneNode | null {
  const groups = new Map<LottieShape | undefined, CanvasShape[]>();
  for (const ref of [...op.shapes].reverse()) {
    const between = ref.chain.slice(op.depth);
    if (between.some(isMoving)) {
      issues.add('animated group transform between a style and its shapes');
      continue;
    }
    let m: Matrix = IDENTITY;
    for (const tr of between) if (tr) m = multiply(m, staticMatrix(tr));
    const shape = canvasShape(ref, m, map, ctx, issues);
    if (!shape) continue;
    const trim = ref.trims.filter((mod) => mod.ty === 'tm').at(-1);
    groups.set(trim, [...(groups.get(trim) ?? []), shape]);
  }
  const base = groups.size ? stylePath(op, map, ctx, issues, 'M0 0') : null;
  if (!base) return null;
  delete base.bm;
  const bounds: Bounds = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, -Infinity, -Infinity];
  const paths: SvgPath[] = [];
  for (const [trim, shapes] of groups) {
    const path: SvgPath = { ...base, d: '', shapes };
    if (trim) {
      path.trim = {
        s: trimValue(prop(trim, 's'), 0, map, ctx),
        e: trimValue(prop(trim, 'e'), 100, map, ctx),
        o: trimValue(prop(trim, 'o'), 0, map, ctx),
        m: trim.m === 2 ? 2 : 1,
      };
    }
    paths.push(path);
    for (const shape of shapes) {
      const values =
        shape.v.length && Array.isArray(shape.v[0])
          ? (shape.v as Keyframe[]).map((k) => k[1] as number[])
          : [shape.v as number[]];
      for (const flat of values) {
        for (let n = 0; n + 1 < flat.length; n += 2) {
          bounds[0] = Math.min(bounds[0], flat[n]!);
          bounds[1] = Math.min(bounds[1], flat[n + 1]!);
          bounds[2] = Math.max(bounds[2], flat[n]!);
          bounds[3] = Math.max(bounds[3], flat[n + 1]!);
        }
      }
    }
  }
  if (!Number.isFinite(bounds[0])) return null;
  const widths = [
    base.sw ?? 0,
    ...(base.a ?? []).filter((t) => t.p === 'strokeWidth').flatMap((t) => t.k.map((k) => Number(k[1]))),
  ];
  const reach = base.stroke ? (Math.max(...widths) / 2) * (base.lj === 'miter' ? Math.max(1, base.ml ?? 4) : 1) : 0;
  const pad = reach + 2;
  const x = Math.floor(bounds[0] - pad);
  const y = Math.floor(bounds[1] - pad);
  const node: SceneNode = {
    k: 'canvas',
    box: [x, y, Math.ceil(bounds[2] + pad) - x, Math.ceil(bounds[3] + pad) - y],
    c: paths,
  };
  const bm = blendMode(op.item.bm, issues);
  if (bm) node.bm = bm;
  return node;
}

function stylePath(op: StyleOp, map: TimeMap, ctx: TrackContext, issues: Issues, given?: string): SvgPath | null {
  const d = given ?? styleD(op, issues);
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
      applyOpacity(path, 'strokeOpacity', prop(style, 'o'), map, ctx);
      applyStrokeStyle(path, style, map, ctx, issues);
      break;
    case 'gf':
      path.fill = gradientOf(style, issues);
      applyOpacity(path, 'fillOpacity', prop(style, 'o'), map, ctx);
      if (style.r === 2) path.rule = 'evenodd';
      break;
    case 'gs':
      path.stroke = gradientOf(style, issues);
      applyOpacity(path, 'strokeOpacity', prop(style, 'o'), map, ctx);
      applyStrokeStyle(path, style, map, ctx, issues);
      break;
  }
  return path;
}

const sameColor = (a: number[], b: number[]): boolean => a.every((c, i) => Math.abs(c - (b[i] ?? c)) < 1e-6);

interface Fade {
  color: number[];
  from: number;
  to: number;
  ease: KEase;
}

function crossFade(keys: K[], copy: (color: number[]) => SvgPath, ctx: TrackContext): SvgNode[] {
  const fades: Fade[] = [{ color: keys[0]!.v, from: 0, to: 0, ease: 'linear' }];
  for (let n = 0; n < keys.length - 1; n++) {
    const a = keys[n]!;
    const b = keys[n + 1]!;
    if (sameColor(a.v, b.v)) continue;
    const instant = a.e === 'hold' || b.o <= a.o;
    fades.push({ color: b.v, from: a.o, to: b.o, ease: instant ? 'hold' : a.e });
  }
  return fades.map((fade, j) => {
    const node: SvgNode = { k: 'svg', c: [copy(fade.color)] };
    const hideAt = fades[j + 1]?.to;
    const frames: K[] = [];
    if (j === 0) {
      if (hideAt === undefined || hideAt >= 1) return node;
      frames.push({ o: 0, v: [1], e: 'hold' });
    } else {
      if (fade.from > 0) frames.push({ o: 0, v: [0], e: 'hold' });
      frames.push({ o: fade.from, v: [0], e: fade.ease });
      frames.push({ o: fade.to, v: [1], e: 'hold' });
    }
    if (hideAt !== undefined && hideAt < 1) {
      frames.push({ o: hideAt, v: [0], e: 'hold' });
      frames.push({ o: 1, v: [0], e: 'linear' });
    } else if (frames[frames.length - 1]!.o < 1) {
      frames.push({ o: 1, v: [1], e: 'linear' });
    }
    node.a = [toTrack('opacity', frames, (v) => v, ctx)];
    return node;
  });
}

function compositedStyle(op: StyleOp, map: TimeMap, ctx: TrackContext, issues: Issues): SceneNode | null {
  const d = styleD(op, issues);
  if (!d) return null;
  const style = op.item;
  const which = isStroke(style) ? 'stroke' : 'fill';
  const base: SvgPath = { d };
  if (which === 'fill' && style.r === 2) base.rule = 'evenodd';
  if (which === 'stroke') applyStrokeStyle(base, style, map, ctx, issues);

  const node: DivNode = { k: 'div', c: [] };
  const opacity = normalize(prop(style, 'o'), [100]);
  const opacityKeys = buildKeys(opacity, map, [0], ctx);
  const toOpacity = (v: number[]) => [(v[0] ?? 100) / 100];
  if (opacityKeys && !isConstant(opacityKeys)) node.a = [toTrack('opacity', opacityKeys, toOpacity, ctx)];
  else {
    const o = round(toOpacity(opacityKeys ? opacityKeys[0]!.v : staticOf(prop(style, 'o'), [100]))[0]!);
    if (o !== 1) node.o = o;
  }

  if (style.ty === 'gf' || style.ty === 'gs') {
    node.c.push({ k: 'svg', c: [{ ...base, [which]: gradientOf(style, issues) }] });
  } else {
    const color = normalize(prop(style, 'c'), [0, 0, 0, 1]);
    const colorKeys = buildKeys(color, map, [0, 1, 2], ctx);
    const paint = (rgb: number[]): SvgPath => ({ ...base, [which]: hex(rgb.slice(0, 3).map((c) => c * 255)) });
    if (colorKeys && !isConstant(colorKeys)) node.c.push(...crossFade(colorKeys, paint, ctx));
    else node.c.push({ k: 'svg', c: [paint(colorKeys ? colorKeys[0]!.v : staticOf(prop(style, 'c'), [0, 0, 0]))] });
  }

  const only = node.c[0];
  if (node.c.length === 1 && only && !only.a && only.o === undefined) {
    if (node.a) only.a = node.a;
    if (node.o !== undefined) only.o = node.o;
    return only;
  }
  return node;
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
    if (op.kind === 'style' && op.html) {
      const node = op.mode === 'canvas' ? canvasStyle(op, map, ctx, issues) : compositedStyle(op, map, ctx, issues);
      if (node) {
        svg = null;
        target.push(node);
      }
    } else if (op.kind === 'style') {
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
      const plain = !div.t && div.r === undefined && !div.s && !div.m && div.o === undefined && !div.a && !div.bm;
      if (plain) target.push(...div.c);
      else if (div.c.length) target.push(div);
    }
  }
}

export function compileShapes(shapes: LottieShape[], map: TimeMap, ctx: TrackContext, issues: Issues): SceneNode[] {
  const out: SceneNode[] = [];
  emit(walk(expandRepeaters(shapes, issues), [], [], [], issues), out, map, ctx, issues);
  return out;
}
