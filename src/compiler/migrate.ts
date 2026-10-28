import type { LottieAnimationData, LottieLayer, LottieShape } from './lottie';

type Loose = Record<string, unknown> & { k?: unknown };

const older = (version: string | undefined, minimum: number[]): boolean => {
  if (!version) return false;
  const parts = version.split('.').map(Number);
  for (let i = 0; i < minimum.length; i++) {
    const a = parts[i] ?? 0;
    const b = minimum[i]!;
    if (a !== b) return a < b;
  }
  return false;
};

const divide = (value: unknown) => {
  if (!Array.isArray(value)) return;
  for (let i = 0; i < 4 && i < value.length; i++) if (typeof value[i] === 'number') value[i] /= 255;
};

function scaleColor(color: Loose | undefined) {
  const k = color?.k;
  if (!Array.isArray(k)) return;
  if (typeof k[0] === 'object' && k[0] !== null && 'i' in k[0]) {
    for (const key of k as Loose[]) {
      divide(key.s);
      divide(key.e);
    }
  } else divide(k);
}

function closeShape(shape: LottieShape) {
  const ks = shape.ks as Loose | undefined;
  const k = ks?.k as Loose | Loose[] | undefined;
  if (!k) return;
  if (!Array.isArray(k)) {
    if ('i' in k) k.c = shape.closed;
    return;
  }
  for (const key of k) {
    for (const end of [key.s, key.e]) {
      const path = Array.isArray(end) ? (end[0] as Loose | undefined) : undefined;
      if (path) path.c = shape.closed;
    }
  }
}

export function migrate(data: LottieAnimationData): LottieAnimationData {
  const colors = older(data.v, [4, 1, 9]);
  const closing = older(data.v, [4, 4, 18]);
  if (!colors && !closing) return data;
  const out = structuredClone(data);
  const shapes = (items: LottieShape[] | undefined) => {
    for (const item of items ?? []) {
      if (item.ty === 'gr') shapes(item.it as LottieShape[] | undefined);
      else if (colors && (item.ty === 'fl' || item.ty === 'st')) scaleColor(item.c as Loose | undefined);
      else if (closing && item.ty === 'sh') closeShape(item);
    }
  };
  const layers = (list: LottieLayer[] | undefined) => {
    for (const layer of list ?? []) if (layer.ty === 4) shapes(layer.shapes);
  };
  layers(out.layers);
  for (const asset of out.assets ?? []) layers(asset.layers);
  return out;
}
