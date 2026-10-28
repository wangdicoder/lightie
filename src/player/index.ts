import type { Easing, Gradient, LightieAnimation, SceneNode, SvgItem, SvgPath, Track, TrackProperty } from '../types';
import type { Clock, Painter, Surface } from './painter';

export type Fit = 'contain' | 'cover' | 'fill' | 'none';

export interface FallbackHandle {
  play(): void;
  pause(): void;
  stop(): void;
  seek(frame: number): void;
  setSpeed(speed: number): void;
  setDirection?(direction: 1 | -1): void;
  destroy(): void;
}

export interface FallbackOptions {
  loop: boolean | number;
  autoplay: boolean;
  speed: number;
}

export type FallbackRenderer = (
  container: HTMLElement,
  source: unknown,
  options: FallbackOptions,
) => FallbackHandle | Promise<FallbackHandle>;

export interface PlayerOptions {
  loop?: boolean | number;
  autoplay?: boolean;
  speed?: number;
  direction?: 1 | -1;
  fit?: Fit;
  pauseWhenHidden?: boolean;
  reducedMotion?: 'respect' | 'ignore';
  posterFrame?: number;
  fallback?: FallbackRenderer;
  onComplete?: () => void;
}

export interface Player {
  readonly root: HTMLElement;
  readonly totalFrames: number;
  readonly duration: number;
  readonly isPlaying: boolean;
  readonly usingFallback: boolean;
  play(): void;
  pause(): void;
  stop(): void;
  seek(frame: number): void;
  setSpeed(speed: number): void;
  setDirection(direction: 1 | -1): void;
  painted(): Promise<void>;
  destroy(): void;
}

const SVG = 'http://www.w3.org/2000/svg';
const REVERSE_HEADROOM = 1e6;
let instances = 0;

const css = (p: TrackProperty, v: number | number[]): string => {
  const a = Array.isArray(v) ? v : [v];
  switch (p) {
    case 'translate':
      return `${a[0]}px ${a[1]}px`;
    case 'rotate':
      return `${a[0]}deg`;
    case 'scale':
      return `${a[0]} ${a[1]}`;
    case 'transform':
      return `matrix(${a.join(',')})`;
    case 'fill':
    case 'stroke':
      return `rgb(${a.map((c) => Math.round(c)).join(',')})`;
    case 'strokeWidth':
      return `${a[0]}px`;
    default:
      return `${a[0]}`;
  }
};

const easing = (e: Easing | undefined): string =>
  e === undefined ? 'linear' : e === 1 ? 'step-end' : `cubic-bezier(${e.join(',')})`;

export function createPlayer(container: HTMLElement, animation: LightieAnimation, options: PlayerOptions = {}): Player {
  const doc = container.ownerDocument;
  const { w, h, fr, ip, op } = animation;
  const totalFrames = op - ip;
  const duration = (totalFrames / fr) * 1000;
  const loop = options.loop ?? true;
  const iterations = loop === true ? Number.POSITIVE_INFINITY : loop === false ? 1 : Math.max(1, loop);
  const reduce =
    options.reducedMotion !== 'ignore' &&
    typeof matchMedia === 'function' &&
    matchMedia('(prefers-reduced-motion: reduce)').matches;
  const autoplay = (options.autoplay ?? true) && !reduce;
  let speed = options.speed ?? 1;
  let direction = options.direction ?? 1;

  const root = doc.createElement('div');
  root.style.cssText = 'position:relative;width:100%;height:100%;overflow:hidden';
  container.append(root);

  if (animation.unsupported?.length && options.fallback && animation.source !== undefined) {
    return fallbackPlayer(root, animation, options, { loop, autoplay, speed }, totalFrames, duration);
  }

  const id = `lightie${++instances}`;
  let gradients = 0;
  const animations: Animation[] = [];
  const timing: KeyframeEffectOptions = { duration, iterations, fill: 'both' };

  const position = (el: HTMLElement | SVGElement) => {
    el.style.position = 'absolute';
    el.style.left = '0';
    el.style.top = '0';
    el.style.transformOrigin = '0 0';
  };

  const animate = (el: Element, tracks: Track[] | undefined) => {
    if (!tracks) return;
    for (const track of tracks) {
      const frames = track.k.map(([offset, value, e]) => ({
        offset,
        [track.p]: css(track.p, value),
        easing: easing(e),
      }));
      const a = el.animate(frames, timing);
      a.pause();
      animations.push(a);
    }
  };

  const paint = (defs: SVGDefsElement, gradient: Gradient): string => {
    const g = doc.createElementNS(SVG, gradient.type === 'linear' ? 'linearGradient' : 'radialGradient');
    const gid = `${id}g${++gradients}`;
    g.setAttribute('id', gid);
    g.setAttribute('gradientUnits', 'userSpaceOnUse');
    const names = gradient.type === 'linear' ? ['x1', 'y1', 'x2', 'y2'] : ['cx', 'cy', 'r', 'fx', 'fy'];
    for (const [i, name] of names.entries()) g.setAttribute(name, String(gradient.p[i] ?? 0));
    for (const [offset, color, opacity] of gradient.stops) {
      const stop = doc.createElementNS(SVG, 'stop');
      stop.setAttribute('offset', String(offset));
      stop.setAttribute('stop-color', color);
      if (opacity !== 1) stop.setAttribute('stop-opacity', String(opacity));
      g.append(stop);
    }
    defs.append(g);
    return `url(#${gid})`;
  };

  const svgItems = (items: SvgItem[], parent: SVGElement, defs: SVGDefsElement) => {
    for (const item of items) {
      if ('g' in item) {
        const g = doc.createElementNS(SVG, 'g');
        if (item.m) g.setAttribute('transform', `matrix(${item.m.join(',')})`);
        if (item.o !== undefined) g.setAttribute('opacity', String(item.o));
        if (item.bm) g.style.mixBlendMode = item.bm;
        svgItems(item.g, g, defs);
        parent.append(g);
        continue;
      }
      const p: SvgPath = item;
      const path = doc.createElementNS(SVG, 'path');
      const set = (name: string, value: string | number | undefined) => {
        if (value !== undefined) path.setAttribute(name, String(value));
      };
      set('d', p.d);
      set('fill', p.fill === undefined ? 'none' : typeof p.fill === 'string' ? p.fill : paint(defs, p.fill));
      if (p.stroke !== undefined) set('stroke', typeof p.stroke === 'string' ? p.stroke : paint(defs, p.stroke));
      set('fill-opacity', p.fo);
      set('stroke-opacity', p.so);
      set('stroke-width', p.sw);
      set('stroke-linecap', p.lc);
      set('stroke-linejoin', p.lj);
      set('stroke-miterlimit', p.ml);
      set('stroke-dasharray', p.dash?.join(' '));
      set('stroke-dashoffset', p.dashOffset);
      set('fill-rule', p.rule);
      if (p.bm) path.style.mixBlendMode = p.bm;
      animate(path, p.a);
      parent.append(path);
    }
  };

  const build = (nodes: SceneNode[], parent: Element) => {
    for (const node of nodes) {
      const el = doc.createElement('div');
      el.style.width = el.style.height = '1px';
      if (node.k === 'svg') {
        const svg = doc.createElementNS(SVG, 'svg');
        svg.setAttribute('width', String(w));
        svg.setAttribute('height', String(h));
        svg.style.cssText = 'position:absolute;left:0;top:0;overflow:visible';
        const defs = doc.createElementNS(SVG, 'defs');
        svg.append(defs);
        svgItems(node.c, svg, defs);
        if (!defs.childNodes.length) defs.remove();
        el.append(svg);
      } else if (node.k === 'img') {
        const img = doc.createElement('img');
        img.src = node.src;
        img.alt = '';
        img.style.cssText = `position:absolute;left:0;top:0;width:${node.w}px;height:${node.h}px;max-width:none`;
        el.append(img);
      } else if (node.k === 'solid') {
        el.style.width = `${node.w}px`;
        el.style.height = `${node.h}px`;
        el.style.background = node.color;
      } else if (node.k === 'canvas') {
        const canvas = doc.createElement('canvas');
        const [x, y, cw, ch] = node.box;
        canvas.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${cw}px;height:${ch}px`;
        el.append(canvas);
        surfaces.push({ canvas, node });
      } else {
        build(node.c, el);
      }
      position(el);
      const s = el.style;
      if (node.t) s.translate = `${node.t[0]}px ${node.t[1]}px`;
      if (node.r !== undefined) s.rotate = `${node.r}deg`;
      if (node.s) s.scale = `${node.s[0]} ${node.s[1]}`;
      if (node.m) s.transform = `matrix(${node.m.join(',')})`;
      if (node.o !== undefined) s.opacity = String(node.o);
      if (node.clip) {
        s.width = `${node.clip[0]}px`;
        s.height = `${node.clip[1]}px`;
        s.overflow = 'hidden';
      }
      if (node.mask) s.clipPath = `path('${node.mask}')`;
      if (node.bm) s.mixBlendMode = node.bm;
      animate(el, node.a);
      parent.append(el);
    }
  };

  const surfaces: Surface[] = [];
  const stage = doc.createElement('div');
  stage.style.cssText = `position:absolute;left:0;top:0;width:${w}px;height:${h}px;overflow:hidden;transform-origin:0 0`;
  build(animation.nodes, stage);
  root.append(stage);

  let playing = false;
  let resumeWhenVisible = false;
  let origin = 0;
  let held = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let painter: Painter | undefined;
  let painterReady: Promise<void> = Promise.resolve();
  let destroyed = false;
  let stageScale = 1;

  const total = Number.isFinite(iterations) ? duration * iterations : Number.POSITIVE_INFINITY;
  const timeOrigin = (doc.defaultView ?? globalThis).performance.timeOrigin;
  const now = (): number => Number(doc.timeline.currentTime ?? 0);
  const rate = () => speed * direction;
  const position0 = (): number => (playing ? (now() - origin) * rate() : held);
  const clock = (): Clock => ({
    origin: timeOrigin + origin,
    rate: rate(),
    held: playing ? null : held,
    duration,
    iterations,
  });

  const hold = (time: number) => {
    clearTimeout(timer);
    held = time;
    for (const a of animations) {
      a.pause();
      a.playbackRate = rate();
      a.currentTime = time;
    }
    playing = false;
    painter?.sync(clock());
  };

  const run = (time: number) => {
    const r = rate();
    origin = now() - time / r;
    for (const a of animations) {
      a.playbackRate = r;
      a.startTime = origin;
    }
    playing = true;
    painter?.sync(clock());
    clearTimeout(timer);
    if (Number.isFinite(total)) {
      const remaining = direction > 0 ? total - time : time;
      timer = setTimeout(
        () => {
          hold(direction > 0 ? total : 0);
          options.onComplete?.();
        },
        Math.max(0, remaining / speed),
      );
    }
  };

  const clampTime = (time: number) => {
    if (direction < 0 && iterations === Number.POSITIVE_INFINITY && time <= duration) {
      return time + duration * REVERSE_HEADROOM;
    }
    return time;
  };

  const player: Player = {
    root,
    totalFrames,
    duration,
    usingFallback: false,
    get isPlaying() {
      return playing;
    },
    play() {
      let time = position0();
      if (Number.isFinite(total) && direction > 0 && time >= total) time = 0;
      if (Number.isFinite(total) && direction < 0 && time <= 0) time = total;
      run(clampTime(time));
    },
    pause() {
      hold(position0());
    },
    stop() {
      resumeWhenVisible = false;
      hold(0);
    },
    seek(frame: number) {
      const time = clampTime(Math.min(duration, Math.max(0, (frame / fr) * 1000)));
      if (playing) run(time);
      else hold(time);
    },
    setSpeed(value: number) {
      if (!(value > 0)) return;
      speed = value;
      if (playing) run(position0());
      else hold(position0());
    },
    setDirection(value: 1 | -1) {
      direction = value;
      if (playing) run(clampTime(position0()));
      else hold(position0());
    },
    async painted() {
      await painterReady;
      await painter?.painted();
    },
    destroy() {
      destroyed = true;
      clearTimeout(timer);
      for (const a of animations) a.cancel();
      painter?.destroy();
      resize?.disconnect();
      visibility?.disconnect();
      root.remove();
    },
  };

  const fit = options.fit ?? 'contain';
  const layout = () => {
    const cw = root.clientWidth;
    const ch = root.clientHeight;
    if (!cw || !ch) return;
    let sx = cw / w;
    let sy = ch / h;
    if (fit === 'contain') sx = sy = Math.min(sx, sy);
    else if (fit === 'cover') sx = sy = Math.max(sx, sy);
    else if (fit === 'none') sx = sy = 1;
    stage.style.transform = `translate(${(cw - w * sx) / 2}px,${(ch - h * sy) / 2}px) scale(${sx},${sy})`;
    stageScale = Math.max(sx, sy);
    painter?.resize(stageScale);
  };
  const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(layout) : undefined;
  resize?.observe(root);
  layout();

  const visibility =
    options.pauseWhenHidden !== false && typeof IntersectionObserver === 'function'
      ? new IntersectionObserver((entries) => {
          const visible = entries[entries.length - 1]?.isIntersecting ?? true;
          if (!visible && playing) {
            resumeWhenVisible = true;
            player.pause();
          } else if (visible && resumeWhenVisible) {
            resumeWhenVisible = false;
            player.play();
          }
        })
      : undefined;
  visibility?.observe(root);

  if (autoplay) player.play();
  else player.seek(reduce ? (options.posterFrame ?? 0) : 0);
  if (surfaces.length) {
    painterReady = import('./painter')
      .then(({ attach }) => attach(surfaces, clock(), stageScale))
      .then((attached) => {
        if (destroyed) attached.destroy();
        else painter = attached;
      });
  }
  return player;
}

function fallbackPlayer(
  root: HTMLElement,
  animation: LightieAnimation,
  options: PlayerOptions,
  init: FallbackOptions,
  totalFrames: number,
  duration: number,
): Player {
  let handle: FallbackHandle | undefined;
  let destroyed = false;
  let playing = init.autoplay;
  const call = (fn: (h: FallbackHandle) => void) => {
    if (handle) fn(handle);
  };
  const load = async () => {
    const source =
      typeof animation.source === 'string' ? await (await fetch(animation.source)).json() : animation.source;
    const created = await options.fallback?.(root, source, init);
    if (destroyed) created?.destroy();
    else handle = created;
  };
  load().catch((error: unknown) => {
    root.dispatchEvent(new CustomEvent('lightie-error', { detail: error, bubbles: true, composed: true }));
  });
  return {
    root,
    totalFrames,
    duration,
    usingFallback: true,
    get isPlaying() {
      return playing;
    },
    play: () => {
      playing = true;
      call((h) => h.play());
    },
    pause: () => {
      playing = false;
      call((h) => h.pause());
    },
    stop: () => {
      playing = false;
      call((h) => h.stop());
    },
    seek: (frame) => call((h) => h.seek(frame)),
    setSpeed: (speed) => call((h) => h.setSpeed(speed)),
    setDirection: (direction) => call((h) => h.setDirection?.(direction)),
    painted: () => Promise.resolve(),
    destroy: () => {
      destroyed = true;
      handle?.destroy();
      root.remove();
    },
  };
}
