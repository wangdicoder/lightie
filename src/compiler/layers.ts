import type { DivNode, Keyframe, Matrix, SceneNode, SvgItem, Track } from '../types';
import { fromLottiePath, IDENTITY, invert, isIdentity, multiply, pathToD, transformD } from './geometry';
import type { LottieAsset, LottieLayer, LottieMask, LottiePathValue } from './lottie';
import { evaluate, hasExpression, hasKeyframes, normalize } from './property';
import { blendMode, compileShapes } from './shapes';
import { fromRoot, type K, offsetOf, round, sample, type TimeMap, type TrackContext, toRoot, toTrack } from './track';
import { compileTransform, type Issues, isTransformStatic, transformMatrixAt } from './transform';

export interface LayerContext extends TrackContext {
  assets: Map<string, LottieAsset>;
  issues: (where: string) => Issues;
  depth: number;
}

const isTrivial = (node: DivNode): boolean =>
  !node.t && node.r === undefined && !node.s && !node.m && node.o === undefined && !node.a?.length;

function maskPath(layer: LottieLayer, issues: Issues): string | undefined {
  if (!layer.hasMask || !layer.masksProperties?.length) return undefined;
  const masks = layer.masksProperties.filter((m) => m.mode !== 'n');
  if (!masks.length) return undefined;
  if (masks.length > 1) issues.add('multiple masks');
  const mask = masks[0] as LottieMask;
  if (mask.mode !== 'a' && mask.mode !== undefined) issues.add(`mask mode ${mask.mode}`);
  if (mask.inv) issues.add('inverted mask');
  if (hasKeyframes(mask.pt)) issues.add('animated mask');
  const opacity = normalize(mask.o, [100]);
  if (opacity.kind !== 'static' || opacity.v[0] !== 100) issues.add('mask opacity');
  const expansion = normalize(mask.x, [0]);
  if (expansion.kind !== 'static' || expansion.v[0] !== 0) issues.add('mask expansion');
  const k = mask.pt.k as LottiePathValue | { s?: LottiePathValue[] }[];
  const value = Array.isArray(k) ? k[0]?.s?.[0] : k;
  if (!value?.v) return undefined;
  return pathToD(fromLottiePath(value, mask.cl ?? true));
}

function assetSource(asset: LottieAsset | undefined): string | undefined {
  if (!asset?.p) return undefined;
  const src = asset.e === 1 || asset.p.startsWith('data:') ? asset.p : `${asset.u ?? ''}${asset.p}`;
  if (/^(data:image\/|https?:\/\/|\/|\.{0,2}\/|[\w.-]+(\/|$))/i.test(src) && !/^javascript:/i.test(src)) return src;
  return undefined;
}

function visibleRange(layer: LottieLayer, comp: TimeMap, ctx: LayerContext): [number, number] | null {
  if (!comp.remap) return [toRoot(comp, layer.ip), toRoot(comp, layer.op)];
  const { win, sampleRate } = ctx;
  const step = win.fr / sampleRate;
  const visible = (frame: number) => {
    const t = fromRoot(comp, frame);
    return t >= layer.ip && t < layer.op;
  };
  const edge = (from: number, to: number) => {
    const wanted = visible(to);
    let a = from;
    let b = to;
    for (let i = 0; i < 30; i++) {
      const mid = (a + b) / 2;
      if (visible(mid) === wanted) b = mid;
      else a = mid;
    }
    return b;
  };
  let first = visible(win.ip) ? win.ip : Number.NaN;
  let last = Number.NaN;
  let previous = win.ip;
  for (let frame = win.ip + step; frame < win.op + step; frame += step) {
    const at = Math.min(frame, win.op);
    if (visible(at) !== visible(previous)) {
      const crossing = edge(previous, at);
      if (visible(at) && Number.isNaN(first)) first = crossing;
      if (!visible(at)) last = crossing;
    }
    previous = at;
  }
  if (Number.isNaN(first)) return null;
  return [first, Number.isNaN(last) || last < first ? win.op : last];
}

function compileLayer(layer: LottieLayer, comp: TimeMap, ctx: LayerContext, where: string): SceneNode | null {
  const issues = ctx.issues(where);
  const map = comp;
  const visibility = visibleRange(layer, comp, ctx);
  if (!visibility || visibility[1] <= ctx.win.ip || visibility[0] >= ctx.win.op) return null;
  if (layer.ddd) issues.add('3D layer');
  if (layer.ao && hasKeyframes(layer.ks.p as never)) issues.add('auto-orient');
  if (layer.ef?.some((effect) => effect.en !== 0)) issues.add('layer effects');

  let node: SceneNode;
  switch (layer.ty) {
    case 0: {
      const asset = layer.refId ? ctx.assets.get(layer.refId) : undefined;
      if (!asset?.layers) return null;
      if (layer.tm && hasExpression(layer.tm)) issues.add('expression');
      if (ctx.depth > 32) {
        issues.add('precomp nesting too deep');
        return null;
      }
      const st = layer.st ?? 0;
      const sr = layer.sr ?? 1;
      const child: TimeMap = { scale: comp.scale * sr, offset: st * comp.scale + comp.offset };
      if (layer.tm) {
        const remap = normalize(layer.tm, [0]);
        child.remap = (frame) => (evaluate(remap, fromRoot(comp, frame))[0] ?? 0) * ctx.win.fr;
      } else if (comp.remap) {
        child.remap = (frame) => (fromRoot(comp, frame) - st) / sr;
      }
      ctx.depth++;
      const c = compileComp(asset.layers, child, ctx, `${where} › `);
      ctx.depth--;
      node = { k: 'div', c, clip: [layer.w ?? asset.w ?? 0, layer.h ?? asset.h ?? 0] };
      break;
    }
    case 1:
      node = { k: 'solid', color: layer.sc ?? '#000000', w: layer.sw ?? 0, h: layer.sh ?? 0 };
      break;
    case 2: {
      const asset = layer.refId ? ctx.assets.get(layer.refId) : undefined;
      const src = assetSource(asset);
      if (!src) {
        issues.add('image source');
        return null;
      }
      node = { k: 'img', src, w: asset?.w ?? 0, h: asset?.h ?? 0 };
      break;
    }
    case 4: {
      const children = compileShapes(layer.shapes ?? [], map, ctx, issues);
      if (!children.length) return null;
      const only = children.length === 1 ? children[0]! : undefined;
      const bare = only && (only.k === 'svg' || only.k === 'canvas') && !only.a && !only.bm && only.o === undefined;
      node = bare ? only : { k: 'div', c: children };
      break;
    }
    case 5:
      issues.add('text layer');
      return null;
    default:
      return null;
  }

  Object.assign(node, compileTransform(layer.ks, map, ctx, issues, { opacity: true, visibility }));
  const mask = maskPath(layer, issues);
  if (mask) node.mask = mask;
  const bm = blendMode(layer.bm, issues);
  if (bm) node.bm = bm;
  return node;
}

function matteClip(matte: LottieLayer, comp: TimeMap, ctx: LayerContext): string | null {
  if (matte.ty !== 4 || matte.hasMask || matte.ef?.length || matte.tt) return null;
  const opacity = normalize(matte.ks.o, [100]);
  if (opacity.kind !== 'static' || opacity.v[0] !== 100) return null;
  const problems: string[] = [];
  const quiet = { ...ctx, stats: { composited: 0, paint: 0, baked: 0 } };
  const nodes = compileShapes(matte.shapes ?? [], comp, quiet, { add: (feature) => problems.push(feature) });
  if (problems.length) return null;
  let d = '';
  const visit = (items: SvgItem[], m: Matrix): boolean =>
    items.every((item) => {
      if ('g' in item) return item.o === undefined && !item.bm && visit(item.g, item.m ? multiply(m, item.m) : m);
      if (
        typeof item.fill !== 'string' ||
        item.stroke !== undefined ||
        item.fo !== undefined ||
        item.a?.length ||
        item.bm
      )
        return false;
      d += transformD(item.d, m);
      return true;
    });
  for (const node of nodes) {
    if (
      node.k !== 'svg' ||
      node.a?.length ||
      node.o !== undefined ||
      node.t ||
      node.r !== undefined ||
      node.s ||
      node.m
    )
      return null;
    if (!visit(node.c, IDENTITY)) return null;
  }
  return d || null;
}

function matted(
  node: SceneNode,
  matte: LottieLayer,
  clip: string,
  inverted: boolean,
  byIndex: Map<number, LottieLayer>,
  comp: TimeMap,
  ctx: LayerContext,
  issues: Issues,
): SceneNode {
  const chain: LottieLayer[] = [matte];
  for (
    let p = byIndex.get(matte.parent ?? Number.NaN);
    p && !chain.includes(p);
    p = byIndex.get(p.parent ?? Number.NaN)
  )
    chain.unshift(p);
  const at = (t: number): Matrix =>
    chain.reduce<Matrix>((m, layer) => multiply(m, transformMatrixAt(layer.ks, t, issues)), IDENTITY);
  const exact = (m: Matrix) => m.map((v) => round(v, 6)) as Matrix;
  const mask = inverted ? `M-100000 -100000H100000V100000H-100000Z${clip}` : clip;
  const inner: DivNode = { k: 'div', c: [node] };
  const outer: DivNode = { k: 'div', c: [inner], mask };
  if (inverted) outer.maskRule = 'evenodd';
  const wrappers = chain.map(
    (layer): DivNode => ({ k: 'div', c: [], ...compileTransform(layer.ks, comp, ctx, issues, { opacity: false }) }),
  );
  const animated = !chain.every((layer) => isTransformStatic(layer.ks, issues));
  if (animated && !wrappers.some((w) => w.a?.some((track) => track.p === 'transform'))) {
    const negate = (track: Track): Track => ({
      p: track.p,
      k: track.k.map(([o, v, e]): Keyframe => {
        const value = Array.isArray(v) ? v.map((n) => -n) : -v;
        return e === undefined ? [o, value] : [o, value, e];
      }),
    });
    const inverse = (w: DivNode, layer: LottieLayer): DivNode[] => {
      const out: DivNode[] = [];
      if (w.m) out.push({ k: 'div', c: [], m: exact(invert(w.m)) });
      const scale = w.a?.find((track) => track.p === 'scale');
      if (scale) {
        const norm = normalize(layer.ks.s, [100, 100, 100]);
        const reciprocal = (frame: number) =>
          evaluate(norm, fromRoot(comp, frame))
            .slice(0, 2)
            .map((v) => (Math.abs(v) < 1e-4 ? 1e4 : 100 / v));
        const { win } = ctx;
        const keys: K[] = [
          ...sample(reciprocal, win.ip, win.op, ctx),
          { o: offsetOf(win, win.op), v: reciprocal(win.op), e: 'linear' },
        ];
        out.push({ k: 'div', c: [], a: [toTrack('scale', keys, (v) => v, ctx)] });
        ctx.stats.baked++;
      } else if (w.s) out.push({ k: 'div', c: [], s: w.s.map((v) => round(1 / v, 6)) as [number, number] });
      const rotate = w.a?.find((track) => track.p === 'rotate');
      if (rotate) out.push({ k: 'div', c: [], a: [negate(rotate)] });
      else if (w.r) out.push({ k: 'div', c: [], r: -w.r });
      const translate = w.a?.find((track) => track.p === 'translate');
      if (translate) out.push({ k: 'div', c: [], a: [negate(translate)] });
      else if (w.t) out.push({ k: 'div', c: [], t: [-w.t[0], -w.t[1]] });
      ctx.stats.composited += (rotate ? 1 : 0) + (translate ? 1 : 0);
      return out;
    };
    const masked = wrappers[wrappers.length - 1]!;
    masked.mask = mask;
    if (inverted) masked.maskRule = 'evenodd';
    const nest = [
      ...wrappers,
      ...chain
        .map((layer, i) => inverse(wrappers[i]!, layer))
        .reverse()
        .flat(),
    ];
    let current: SceneNode = node;
    for (let i = nest.length - 1; i >= 0; i--) {
      const div = nest[i]!;
      if (div !== masked && isTrivial(div)) continue;
      div.c = [current];
      current = div;
    }
    return current;
  }
  if (!animated) {
    const m = at(0);
    if (!isIdentity(m)) {
      outer.m = exact(m);
      inner.m = exact(invert(m));
    }
    return outer;
  }
  const { win } = ctx;
  const evalAt = (frame: number) => at(fromRoot(comp, frame));
  const keys: K[] = [
    ...sample(evalAt, win.ip, win.op, ctx),
    { o: offsetOf(win, win.op), v: evalAt(win.op), e: 'linear' },
  ];
  outer.a = [toTrack('transform', keys, (v) => v, ctx)];
  inner.a = [toTrack('transform', keys, (v) => invert(v as Matrix), ctx)];
  ctx.stats.baked += 2;
  return outer;
}

export function compileComp(layers: LottieLayer[], comp: TimeMap, ctx: LayerContext, prefix = ''): SceneNode[] {
  const byIndex = new Map<number, LottieLayer>();
  for (const layer of layers) if (layer.ind !== undefined) byIndex.set(layer.ind, layer);
  const out: SceneNode[] = [];
  for (let n = layers.length - 1; n >= 0; n--) {
    const layer = layers[n]!;
    if (layer.hd || layer.td) continue;
    const where = `${prefix}${layer.nm ?? `layer ${layer.ind ?? n}`}`;
    let node = compileLayer(layer, comp, ctx, where);
    if (!node) continue;
    const seen = new Set<LottieLayer>([layer]);
    for (
      let parent = byIndex.get(layer.parent ?? Number.NaN);
      parent;
      parent = byIndex.get(parent.parent ?? Number.NaN)
    ) {
      if (seen.has(parent)) break;
      seen.add(parent);
      const wrapper: DivNode = {
        k: 'div',
        c: [node],
        ...compileTransform(parent.ks, comp, ctx, ctx.issues(where), { opacity: false }),
      };
      if (!isTrivial(wrapper)) node = wrapper;
    }
    if (layer.tt) {
      const issues = ctx.issues(where);
      const matte = layer.tp !== undefined ? byIndex.get(layer.tp) : layers[n - 1];
      const clip = matte?.td && (layer.tt === 1 || layer.tt === 2) ? matteClip(matte, comp, ctx) : null;
      if (!matte || !clip) issues.add(layer.tt > 2 ? 'luma matte' : 'track matte');
      else node = matted(node, matte, clip, layer.tt === 2, byIndex, comp, ctx, issues);
    }
    out.push(node);
  }
  return out;
}
