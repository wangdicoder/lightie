export interface LottieBezier {
  x: number | number[];
  y: number | number[];
}

export interface LottieKeyframe {
  t: number;
  s?: unknown;
  e?: unknown;
  o?: LottieBezier;
  i?: LottieBezier;
  h?: number;
  to?: number[];
  ti?: number[];
}

export interface LottieProperty {
  a?: number;
  k: unknown;
  x?: unknown;
  ix?: number;
}

export interface LottieSeparatedPosition {
  s: true;
  x: LottieProperty;
  y: LottieProperty;
  z?: LottieProperty;
}

export interface LottieTransform {
  a?: LottieProperty;
  p?: LottieProperty | LottieSeparatedPosition;
  s?: LottieProperty;
  r?: LottieProperty;
  rx?: LottieProperty;
  ry?: LottieProperty;
  rz?: LottieProperty;
  or?: LottieProperty;
  o?: LottieProperty;
  sk?: LottieProperty;
  sa?: LottieProperty;
}

export interface LottiePathValue {
  v: number[][];
  i: number[][];
  o: number[][];
  c?: boolean;
}

export interface LottieMask {
  mode?: string;
  pt: LottieProperty;
  o?: LottieProperty;
  x?: LottieProperty;
  inv?: boolean;
  cl?: boolean;
  nm?: string;
}

export interface LottieShape {
  ty: string;
  nm?: string;
  hd?: boolean;
  bm?: number;
  [key: string]: unknown;
}

export interface LottieLayer {
  ty: number;
  nm?: string;
  ind?: number;
  parent?: number;
  ip: number;
  op: number;
  st?: number;
  sr?: number;
  ks: LottieTransform;
  ao?: number;
  ddd?: number;
  hd?: boolean;
  bm?: number;
  hasMask?: boolean;
  masksProperties?: LottieMask[];
  tt?: number;
  tp?: number;
  td?: number;
  tm?: LottieProperty;
  ef?: { en?: number }[];
  refId?: string;
  w?: number;
  h?: number;
  shapes?: LottieShape[];
  sc?: string;
  sw?: number;
  sh?: number;
}

export interface LottieAsset {
  id: string;
  layers?: LottieLayer[];
  w?: number;
  h?: number;
  u?: string;
  p?: string;
  e?: number;
}

export interface LottieMarker {
  tm: number;
  cm: string;
  dr: number;
}

export interface LottieAnimationData {
  v?: string;
  nm?: string;
  fr: number;
  ip: number;
  op: number;
  w: number;
  h: number;
  ddd?: number;
  assets?: LottieAsset[];
  layers: LottieLayer[];
  markers?: LottieMarker[];
}

export function isLottieAnimationData(value: unknown): value is LottieAnimationData {
  if (typeof value !== 'object' || value === null) return false;
  const data = value as Record<string, unknown>;
  return (
    Array.isArray(data.layers) &&
    typeof data.w === 'number' &&
    typeof data.h === 'number' &&
    typeof data.fr === 'number' &&
    typeof data.ip === 'number' &&
    typeof data.op === 'number'
  );
}
