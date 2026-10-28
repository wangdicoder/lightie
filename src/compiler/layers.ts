import type { DivNode, SceneNode } from '../types';
import { fromLottiePath, pathToD } from './geometry';
import type { LottieAsset, LottieLayer, LottieMask, LottiePathValue } from './lottie';
import { hasExpression, hasKeyframes, normalize } from './property';
import { blendMode, compileShapes } from './shapes';
import { type TimeMap, type TrackContext, toRoot } from './track';
import { compileTransform, type Issues } from './transform';

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

function compileLayer(layer: LottieLayer, comp: TimeMap, ctx: LayerContext, where: string): SceneNode | null {
  const issues = ctx.issues(where);
  const map = comp;
  const visibility: [number, number] = [toRoot(comp, layer.ip), toRoot(comp, layer.op)];
  if (visibility[1] <= ctx.win.ip || visibility[0] >= ctx.win.op) return null;
  if (layer.ddd) issues.add('3D layer');
  if (layer.ao && hasKeyframes(layer.ks.p as never)) issues.add('auto-orient');
  if (layer.ef?.some((effect) => effect.en !== 0)) issues.add('layer effects');
  if (layer.tt) issues.add('track matte');

  let node: SceneNode;
  switch (layer.ty) {
    case 0: {
      const asset = layer.refId ? ctx.assets.get(layer.refId) : undefined;
      if (!asset?.layers) return null;
      if (layer.tm) issues.add(hasExpression(layer.tm) ? 'expression' : 'time remap');
      if (ctx.depth > 32) {
        issues.add('precomp nesting too deep');
        return null;
      }
      const child: TimeMap = {
        scale: comp.scale * (layer.sr ?? 1),
        offset: (layer.st ?? 0) * comp.scale + comp.offset,
      };
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
    out.push(node);
  }
  return out;
}
