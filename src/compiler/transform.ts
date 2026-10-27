import type { Matrix, NodeBase, Track } from '../types';
import { composeTransform, isIdentity } from './geometry';
import type { LottieProperty, LottieSeparatedPosition, LottieTransform } from './lottie';
import { evaluate, hasExpression, type NormProp, normalize } from './property';
import {
  buildKeys,
  fromRoot,
  isConstant,
  type K,
  offsetOf,
  round,
  sample,
  slice,
  type TimeMap,
  type TrackContext,
  toTrack,
} from './track';

export interface Issues {
  add(feature: string): void;
}

export interface TransformOptions {
  opacity: boolean;
  visibility?: [number, number];
}

const isSeparated = (p: LottieTransform['p']): p is LottieSeparatedPosition =>
  !!p && (p as LottieSeparatedPosition).s === true;

interface Props {
  anchor: NormProp;
  position: NormProp;
  positionX?: NormProp;
  positionY?: NormProp;
  scale: NormProp;
  rotation: NormProp;
  skew: NormProp;
  skewAxis: NormProp;
  opacity: NormProp;
}

function readProps(ks: LottieTransform, issues: Issues): Props {
  const props: LottieProperty[] = [];
  const read = (prop: LottieProperty | undefined, fallback: number[]) => {
    if (prop) props.push(prop);
    return normalize(prop, fallback);
  };
  const out: Props = {
    anchor: read(ks.a, [0, 0, 0]),
    position: { kind: 'static', v: [0, 0, 0] },
    scale: read(ks.s, [100, 100, 100]),
    rotation: read(ks.r ?? ks.rz, [0]),
    skew: read(ks.sk, [0]),
    skewAxis: read(ks.sa, [0]),
    opacity: read(ks.o, [100]),
  };
  if (isSeparated(ks.p)) {
    out.positionX = read(ks.p.x, [0]);
    out.positionY = read(ks.p.y, [0]);
  } else {
    out.position = read(ks.p, [0, 0, 0]);
  }
  if (props.some(hasExpression)) issues.add('expression');
  return out;
}

const isStatic = (p: NormProp | undefined): boolean => !p || p.kind === 'static';

const staticValue = (p: NormProp): number[] => (p.kind === 'static' ? p.v : evaluate(p, 0));

function positionAt(props: Props, t: number): number[] {
  if (props.positionX && props.positionY)
    return [evaluate(props.positionX, t)[0] ?? 0, evaluate(props.positionY, t)[0] ?? 0];
  return evaluate(props.position, t);
}

function matrixAt(props: Props, t: number): Matrix {
  return composeTransform({
    anchor: evaluate(props.anchor, t),
    position: positionAt(props, t),
    scale: evaluate(props.scale, t),
    rotation: evaluate(props.rotation, t)[0] ?? 0,
    skew: evaluate(props.skew, t)[0] ?? 0,
    skewAxis: evaluate(props.skewAxis, t)[0] ?? 0,
  });
}

function mergeSeparated(x: NormProp, y: NormProp): NormProp | null {
  if (x.kind === 'static' && y.kind === 'static') return { kind: 'static', v: [x.v[0] ?? 0, y.v[0] ?? 0] };
  if (x.kind !== 'anim' || y.kind !== 'anim' || x.keys.length !== y.keys.length) return null;
  const keys = [];
  for (let n = 0; n < x.keys.length; n++) {
    const kx = x.keys[n]!;
    const ky = y.keys[n]!;
    const ex = kx.ease[0]!;
    const ey = ky.ease[0]!;
    if (kx.t !== ky.t || kx.hold !== ky.hold || ex.some((v, i) => Math.abs(v - (ey[i] ?? v)) > 1e-6)) return null;
    keys.push({ t: kx.t, v: [kx.v[0] ?? 0, ky.v[0] ?? 0], hold: kx.hold, ease: [ex] });
  }
  return { kind: 'anim', keys };
}

function trackOrStatic(
  prop: NormProp,
  map: TimeMap,
  dims: number[],
  ctx: TrackContext,
): { keys: K[] } | { value: number[] } {
  const keys = buildKeys(prop, map, dims, ctx);
  if (!keys) return { value: dims.map((d) => staticValue(prop)[d] ?? staticValue(prop)[0] ?? 0) };
  if (isConstant(keys)) return { value: keys[0]!.v };
  return { keys };
}

function sampled(evalAt: (frame: number) => number[], ctx: TrackContext): K[] {
  const { win } = ctx;
  ctx.stats.baked++;
  const keys = sample(evalAt, win.ip, win.op, ctx);
  keys.push({ o: 1, v: evalAt(win.op), e: 'linear' });
  return keys;
}

export function compileTransform(
  ks: LottieTransform,
  map: TimeMap,
  ctx: TrackContext,
  issues: Issues,
  options: TransformOptions,
): NodeBase {
  const props = readProps(ks, issues);
  const node: NodeBase = {};
  const tracks: Track[] = [];
  const skewed = !(isStatic(props.skew) && (staticValue(props.skew)[0] ?? 0) === 0);
  const motion = [props.anchor, props.position, props.positionX, props.positionY, props.scale, props.rotation];

  if (skewed) {
    if (motion.every(isStatic) && isStatic(props.skewAxis) && isStatic(props.skew)) {
      const m = matrixAt(props, 0);
      if (!isIdentity(m)) node.m = m.map((v) => round(v, 6)) as Matrix;
    } else {
      const keys = sampled((frame) => matrixAt(props, fromRoot(map, frame)), ctx);
      tracks.push(toTrack('transform', keys, (v) => v, ctx));
    }
  } else {
    let position = props.position;
    if (props.positionX && props.positionY) {
      const merged = mergeSeparated(props.positionX, props.positionY);
      if (merged) position = merged;
      else {
        const keys = sampled((frame) => positionAt(props, fromRoot(map, frame)).slice(0, 2), ctx);
        tracks.push(toTrack('translate', keys, (v) => v, ctx));
        position = { kind: 'static', v: [0, 0] };
      }
    }
    const pos = trackOrStatic(position, map, [0, 1], ctx);
    if ('keys' in pos) tracks.push(toTrack('translate', pos.keys, (v) => v, ctx));
    else if (pos.value.some((v) => v !== 0)) node.t = [round(pos.value[0]!), round(pos.value[1]!)];

    const rot = trackOrStatic(props.rotation, map, [0], ctx);
    if ('keys' in rot) tracks.push(toTrack('rotate', rot.keys, (v) => v, ctx));
    else if (rot.value[0]) node.r = round(rot.value[0]);

    const scl = trackOrStatic(props.scale, map, [0, 1], ctx);
    const toScale = (v: number[]) => v.map((n) => n / 100);
    if ('keys' in scl) tracks.push(toTrack('scale', scl.keys, toScale, ctx));
    else if (scl.value[0] !== 100 || scl.value[1] !== 100)
      node.s = toScale(scl.value).map((n) => round(n, 6)) as [number, number];

    const anc = trackOrStatic(props.anchor, map, [0, 1], ctx);
    const toAnchor = (v: number[]) => [1, 0, 0, 1, -(v[0] ?? 0), -(v[1] ?? 0)];
    if ('keys' in anc) tracks.push(toTrack('transform', anc.keys, toAnchor, ctx));
    else if (anc.value[0] || anc.value[1]) node.m = toAnchor(anc.value).map((n) => round(n)) as Matrix;
  }

  if (options.opacity) {
    const opacity = compileOpacity(props.opacity, map, ctx, options.visibility);
    if ('keys' in opacity) tracks.push(toTrack('opacity', opacity.keys, (v) => v, ctx));
    else if (opacity.value !== 1) node.o = round(opacity.value);
  }

  if (tracks.length) node.a = tracks;
  return node;
}

function compileOpacity(
  prop: NormProp,
  map: TimeMap,
  ctx: TrackContext,
  visibility: [number, number] | undefined,
): { keys: K[] } | { value: number } {
  const base = trackOrStatic(prop, map, [0], ctx);
  const scaled: { keys: K[] } | { value: number } =
    'keys' in base
      ? { keys: base.keys.map((k) => ({ ...k, v: [(k.v[0] ?? 0) / 100] })) }
      : { value: (base.value[0] ?? 100) / 100 };
  if (!visibility) return scaled;
  const a = offsetOf(ctx.win, visibility[0]);
  const b = offsetOf(ctx.win, visibility[1]);
  if (a <= 0 && b >= 1) return scaled;
  const full: K[] =
    'keys' in scaled
      ? scaled.keys
      : [
          { o: 0, v: [scaled.value], e: 'linear' },
          { o: 1, v: [scaled.value], e: 'linear' },
        ];
  const from = Math.max(0, a);
  const to = Math.min(1, b);
  const inside = slice(full, from, to);
  const keys: K[] = [];
  if (from > 0) keys.push({ o: 0, v: [0], e: 'hold' });
  keys.push(...inside);
  if (to < 1) {
    keys.push({ o: to, v: [0], e: 'linear' });
    keys.push({ o: 1, v: [0], e: 'linear' });
  }
  return { keys };
}
