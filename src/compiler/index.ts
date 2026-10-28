import type { LightieAnimation } from '../types';
import { compileComp } from './layers';
import { isLottieAnimationData, type LottieAnimationData } from './lottie';
import { migrate } from './migrate';
import type { TrackStats } from './track';

export interface CompileOptions {
  sampleRate?: number;
  source?: 'embed' | 'omit' | { url: string };
}

export interface UnsupportedFeature {
  feature: string;
  where: string[];
}

export interface CompileReport {
  supported: boolean;
  unsupported: UnsupportedFeature[];
  tracks: TrackStats;
}

export interface CompileResult {
  animation: LightieAnimation;
  report: CompileReport;
}

export function compile(input: unknown, options: CompileOptions = {}): CompileResult {
  const data = typeof input === 'string' ? (JSON.parse(input) as unknown) : input;
  if (!isLottieAnimationData(data)) throw new TypeError('lightie: input is not a Lottie animation');
  const lottie = migrate(data as LottieAnimationData);
  if (!(lottie.op > lottie.ip) || !(lottie.fr > 0)) throw new TypeError('lightie: animation has no duration');

  const found = new Map<string, Set<string>>();
  const stats: TrackStats = { composited: 0, paint: 0, baked: 0 };
  const nodes = compileComp(
    lottie.layers,
    { scale: 1, offset: 0 },
    {
      win: { ip: lottie.ip, op: lottie.op, fr: lottie.fr },
      sampleRate: options.sampleRate ?? 60,
      stats,
      assets: new Map((lottie.assets ?? []).map((asset) => [asset.id, asset])),
      depth: 0,
      issues: (where) => ({
        add(feature) {
          const places = found.get(feature) ?? new Set<string>();
          places.add(where);
          found.set(feature, places);
        },
      }),
    },
  );

  const unsupported = [...found].map(([feature, where]) => ({ feature, where: [...where] }));
  const animation: LightieAnimation = {
    lightie: 1,
    w: lottie.w,
    h: lottie.h,
    fr: lottie.fr,
    ip: lottie.ip,
    op: lottie.op,
    nodes,
  };
  if (lottie.markers?.length) {
    animation.markers = lottie.markers.map((m) => ({ name: m.cm, frame: m.tm, duration: m.dr }));
  }
  if (unsupported.length) {
    animation.unsupported = unsupported.map((u) => u.feature);
    const source = options.source ?? 'omit';
    if (source === 'embed') animation.source = data;
    else if (typeof source === 'object') animation.source = source.url;
  }
  return { animation, report: { supported: unsupported.length === 0, unsupported, tracks: stats } };
}

export type { LottieAnimationData } from './lottie';
export { isLottieAnimationData } from './lottie';
