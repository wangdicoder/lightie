import type { CanvasNode, Gradient, Keyframe, SvgPath } from '../types';

export interface Clock {
  origin: number;
  rate: number;
  held: number | null;
  duration: number;
  iterations: number;
}

export interface Surface {
  canvas: HTMLCanvasElement;
  node: CanvasNode;
}

export interface Painter {
  sync(clock: Clock): void;
  resize(stageScale: number): void;
  painted(): Promise<void>;
  destroy(): void;
}

interface Spec {
  box: number[];
  paths: SvgPath[];
  width: number;
  height: number;
  scale: number;
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type Target = HTMLCanvasElement | OffscreenCanvas;

export function renderer() {
  interface Item {
    ctx: Ctx;
    canvas: Target;
    spec: Spec;
    clock: Clock;
    shapes: (Path2D | undefined)[];
    fills: (string | CanvasGradient | undefined)[];
    strokes: (string | CanvasGradient | undefined)[];
    last: number;
  }
  const items = new Map<number, Item>();
  const curve = (a: number, b: number, t: number) => ((1 - 3 * b + 3 * a) * t + (3 * b - 6 * a)) * t * t + 3 * a * t;
  const ease = (e: number[], x: number): number => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0;
    let hi = 1;
    let t = x;
    for (let i = 0; i < 40; i++) {
      const v = curve(e[0] ?? 0, e[2] ?? 1, t);
      if (Math.abs(v - x) < 1e-7) break;
      if (v < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return curve(e[1] ?? 0, e[3] ?? 1, t);
  };
  const vec = (v: number | number[]) => (Array.isArray(v) ? v : [v]);
  const sample = (k: Keyframe[], p: number): number[] => {
    const first = k[0] as Keyframe;
    if (p <= first[0]) return vec(first[1]);
    for (let i = 0; i < k.length - 1; i++) {
      const a = k[i] as Keyframe;
      const b = k[i + 1] as Keyframe;
      if (p < b[0]) {
        const span = b[0] - a[0];
        const u = span > 0 ? (p - a[0]) / span : 1;
        const e = a[2];
        const f = e === undefined ? u : e === 1 ? 0 : ease(e, u);
        const va = vec(a[1]);
        const vb = vec(b[1]);
        return va.map((x, j) => x + ((vb[j] ?? x) - x) * f);
      }
    }
    return vec((k[k.length - 1] as Keyframe)[1]);
  };
  const progress = (c: Clock, now: number): number => {
    const t = c.held ?? (now - c.origin) * c.rate;
    if (t >= c.duration * c.iterations) return 1;
    if (t <= 0) return 0;
    return (t % c.duration) / c.duration;
  };
  const rgba = (hex: string, a: number) =>
    `rgba(${Number.parseInt(hex.slice(1, 3), 16)},${Number.parseInt(hex.slice(3, 5), 16)},${Number.parseInt(hex.slice(5, 7), 16)},${a})`;
  const paint = (ctx: Ctx, p: string | Gradient | undefined): string | CanvasGradient | undefined => {
    if (p === undefined || typeof p === 'string') return p;
    const q = p.p;
    const g =
      p.type === 'linear'
        ? ctx.createLinearGradient(q[0] ?? 0, q[1] ?? 0, q[2] ?? 0, q[3] ?? 0)
        : ctx.createRadialGradient(q[3] ?? 0, q[4] ?? 0, 0, q[0] ?? 0, q[1] ?? 0, q[2] ?? 0);
    for (const [offset, color, alpha] of p.stops) g.addColorStop(offset, alpha === 1 ? color : rgba(color, alpha));
    return g;
  };
  const N = 24;
  const at = (c: number[], t: number, k: number) => {
    const mt = 1 - t;
    return mt * mt * mt * c[k]! + 3 * mt * mt * t * c[k + 2]! + 3 * mt * t * t * c[k + 4]! + t * t * t * c[k + 6]!;
  };
  const table = (c: number[]) => {
    const out = [0];
    let px = c[0]!;
    let py = c[1]!;
    let acc = 0;
    for (let j = 1; j <= N; j++) {
      const x = at(c, j / N, 0);
      const y = at(c, j / N, 1);
      acc += Math.hypot(x - px, y - py);
      out.push(acc);
      px = x;
      py = y;
    }
    return out;
  };
  const paramAt = (lengths: number[], l: number) => {
    const total = lengths[N]!;
    if (l <= 0 || total <= 0) return 0;
    if (l >= total) return 1;
    let j = 1;
    while (lengths[j]! < l) j++;
    const a = lengths[j - 1]!;
    const b = lengths[j]!;
    return (j - 1 + (b > a ? (l - a) / (b - a) : 0)) / N;
  };
  const mix = (a: number[], b: number[], t: number) => [a[0]! + (b[0]! - a[0]!) * t, a[1]! + (b[1]! - a[1]!) * t];
  const split = (c: number[], t: number): [number[], number[]] => {
    const p0 = [c[0]!, c[1]!];
    const p1 = [c[2]!, c[3]!];
    const p2 = [c[4]!, c[5]!];
    const p3 = [c[6]!, c[7]!];
    const a = mix(p0, p1, t);
    const b = mix(p1, p2, t);
    const d = mix(p2, p3, t);
    const e = mix(a, b, t);
    const f = mix(b, d, t);
    const m = mix(e, f, t);
    return [
      [...p0, ...a, ...e, ...m],
      [...m, ...f, ...d, ...p3],
    ];
  };
  const part = (c: number[], t0: number, t1: number) => {
    const left = t1 >= 1 ? c : split(c, t1)[0];
    return t0 <= 0 ? left : split(left, t1 > 0 ? t0 / t1 : 0)[1];
  };
  interface Geo {
    cubics: number[][];
    lengths: number[][];
    total: number;
    closed: boolean;
  }
  const geoOf = (flat: number[], closed: boolean): Geo => {
    const n = Math.floor(flat.length / 6);
    const cubics: number[][] = [];
    for (let k = 0; k < n - (closed ? 0 : 1); k++) {
      const a = k * 6;
      const b = ((k + 1) % n) * 6;
      cubics.push([
        flat[a]!,
        flat[a + 1]!,
        flat[a + 4]!,
        flat[a + 5]!,
        flat[b + 2]!,
        flat[b + 3]!,
        flat[b]!,
        flat[b + 1]!,
      ]);
    }
    const lengths = cubics.map(table);
    return { cubics, lengths, total: lengths.reduce((sum, l) => sum + l[N]!, 0), closed };
  };
  const range = (g: Geo, from: number, to: number, out: number[][]) => {
    let acc = 0;
    for (const [k, c] of g.cubics.entries()) {
      const lengths = g.lengths[k]!;
      const len = lengths[N]!;
      const a = Math.max(from - acc, 0);
      const b = Math.min(to - acc, len);
      if (b > a) out.push(a <= 0 && b >= len ? c : part(c, paramAt(lengths, a), paramAt(lengths, b)));
      acc += len;
    }
    return out;
  };
  const trace = (target: Path2D, cubics: number[][], close: boolean) => {
    const first = cubics[0];
    if (!first) return;
    target.moveTo(first[0]!, first[1]!);
    for (const c of cubics) target.bezierCurveTo(c[2]!, c[3]!, c[4]!, c[5]!, c[6]!, c[7]!);
    if (close) target.closePath();
  };
  const edges = (s: number, e: number, length: number, added: number, total: number): number[][] => {
    const windows =
      e <= 1
        ? [[s, e]]
        : s >= 1
          ? [[s - 1, e - 1]]
          : [
              [s, 1],
              [0, e - 1],
            ];
    const out: number[][] = [];
    for (const [ws, we] of windows) {
      if (we! * total < added || ws! * total > added + length) continue;
      out.push([
        ws! * total <= added ? 0 : (ws! * total - added) / length,
        we! * total >= added + length ? 1 : (we! * total - added) / length,
      ]);
    }
    return out.length ? out : [[0, 0]];
  };
  const num = (v: number | Keyframe[], p: number) => (typeof v === 'number' ? v : (sample(v, p)[0] ?? 0));
  const shapeOf = (path: SvgPath, p: number): Path2D => {
    const target = new Path2D();
    const geos = (path.shapes ?? []).map((shape) =>
      geoOf(Array.isArray(shape.v[0]) ? sample(shape.v as Keyframe[], p) : (shape.v as number[]), shape.c),
    );
    const trim = path.trim;
    let s = 0;
    let e = 1;
    if (trim) {
      let o = (num(trim.o, p) % 360) / 360;
      if (o < 0) o += 1;
      const sv = num(trim.s, p) / 100;
      const ev = num(trim.e, p) / 100;
      s = sv > 1 ? 1 + o : sv < 0 ? o : sv + o;
      e = ev > 1 ? 1 + o : ev < 0 ? o : ev + o;
      if (s > e) [s, e] = [e, s];
      s = Math.round(s * 10000) / 10000;
      e = Math.round(e * 10000) / 10000;
      if (s === e) return target;
    }
    if (!trim || (s === 0 && e === 1) || (s === 1 && e === 0)) {
      for (const g of geos) trace(target, g.cubics, g.closed);
      return target;
    }
    const total = geos.reduce((sum, g) => sum + g.total, 0);
    let added = 0;
    for (const g of geos) {
      const spans = trim.m === 2 && geos.length > 1 ? edges(s, e, g.total, added, total) : [[s, e]];
      added += g.total;
      const l = g.total;
      for (const [a, b] of spans) {
        const head = b! <= 1 ? [a! * l, b! * l] : a! >= 1 ? [(a! - 1) * l, (b! - 1) * l] : [a! * l, l];
        const tail = b! > 1 && a! < 1 ? [0, (b! - 1) * l] : undefined;
        if (head[0] === head[1]) continue;
        const first = range(g, head[0]!, head[1]!, []);
        if (!tail) trace(target, first, false);
        else if (g.closed) trace(target, range(g, tail[0]!, tail[1]!, first), false);
        else {
          trace(target, first, false);
          trace(target, range(g, tail[0]!, tail[1]!, []), false);
        }
      }
    }
    return target;
  };
  const fixed = (path: SvgPath) => !path.trim && (path.shapes ?? []).every((shape) => !Array.isArray(shape.v[0]));
  const draw = (item: Item, now: number): boolean => {
    const p = progress(item.clock, now);
    if (p === item.last) return false;
    item.last = p;
    const { ctx, spec, canvas } = item;
    const sx = canvas.width / (spec.box[2] || 1);
    const sy = canvas.height / (spec.box[3] || 1);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(sx, 0, 0, sy, -(spec.box[0] ?? 0) * sx, -(spec.box[1] ?? 0) * sy);
    for (const [i, path] of spec.paths.entries()) {
      const track = (name: string) => path.a?.find((t) => t.p === name);
      const value = (name: string, fallback: number) => {
        const t = track(name);
        return t ? (sample(t.k, p)[0] ?? fallback) : fallback;
      };
      const color = (name: string, fixed: string | CanvasGradient | undefined) => {
        const t = track(name);
        return t ? `rgb(${sample(t.k, p).map(Math.round).join(',')})` : fixed;
      };
      const shape = item.shapes[i] ?? shapeOf(path, p);
      if (path.fill !== undefined) {
        ctx.fillStyle = color('fill', item.fills[i]) ?? '#000';
        ctx.globalAlpha = value('fillOpacity', path.fo ?? 1);
        ctx.fill(shape, path.rule === 'evenodd' ? 'evenodd' : 'nonzero');
      }
      if (path.stroke !== undefined) {
        ctx.strokeStyle = color('stroke', item.strokes[i]) ?? '#000';
        ctx.globalAlpha = value('strokeOpacity', path.so ?? 1);
        ctx.lineWidth = value('strokeWidth', path.sw ?? 1);
        ctx.lineCap = path.lc ?? 'butt';
        ctx.lineJoin = path.lj ?? 'miter';
        ctx.miterLimit = path.ml ?? 4;
        ctx.setLineDash(path.dash ?? []);
        ctx.lineDashOffset = path.dashOffset ?? 0;
        ctx.stroke(shape);
      }
    }
    return true;
  };
  return {
    add(id: number, canvas: Target, spec: Spec, clock: Clock) {
      canvas.width = spec.width;
      canvas.height = spec.height;
      const ctx = canvas.getContext('2d') as Ctx;
      items.set(id, {
        ctx,
        canvas,
        spec,
        clock,
        shapes: spec.paths.map((path) =>
          !path.shapes ? new Path2D(path.d) : fixed(path) ? shapeOf(path, 0) : undefined,
        ),
        fills: spec.paths.map((path) => paint(ctx, path.fill)),
        strokes: spec.paths.map((path) => paint(ctx, path.stroke)),
        last: Number.NaN,
      });
    },
    clock(id: number, clock: Clock) {
      const item = items.get(id);
      if (!item) return;
      item.clock = clock;
      item.last = Number.NaN;
    },
    resize(id: number, width: number, height: number, scale: number, box: number[]) {
      const item = items.get(id);
      if (!item) return;
      item.canvas.width = width;
      item.canvas.height = height;
      item.spec.scale = scale;
      item.spec.box = box;
      item.last = Number.NaN;
    },
    remove(id: number) {
      items.delete(id);
    },
    frame(now: number) {
      for (const item of items.values()) draw(item, now);
    },
  };
}

type Renderer = ReturnType<typeof renderer>;

function workerMain(create: () => Renderer) {
  const scope = self as unknown as {
    requestAnimationFrame?: (callback: () => void) => number;
    postMessage(message: unknown): void;
    onmessage: ((event: MessageEvent) => void) | null;
  };
  const r = create();
  const pending = new Map<number, number>();
  const schedule = (callback: () => void) =>
    scope.requestAnimationFrame ? scope.requestAnimationFrame(callback) : setTimeout(callback, 16);
  let running = false;
  const tick = () => {
    r.frame(performance.timeOrigin + performance.now());
    for (const [id, seq] of pending) scope.postMessage({ type: 'drawn', id, seq });
    pending.clear();
    schedule(tick);
  };
  scope.onmessage = (event) => {
    const m = event.data;
    if (m.type === 'add') r.add(m.id, m.canvas, m.spec, m.clock);
    else if (m.type === 'clock') r.clock(m.id, m.clock);
    else if (m.type === 'resize') r.resize(m.id, m.width, m.height, m.scale, m.box);
    else if (m.type === 'remove') r.remove(m.id);
    if (m.seq !== undefined) pending.set(m.id, m.seq);
    if (!running) {
      running = true;
      schedule(tick);
    }
  };
  scope.postMessage({ type: 'ready' });
}

let shared: Promise<Worker | null> | undefined;
let nextId = 0;

function sharedWorker(): Promise<Worker | null> {
  shared ??= new Promise((resolve) => {
    try {
      const source = `(${workerMain.toString()})(${renderer.toString()})`;
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      const worker = new Worker(url);
      const done = (value: Worker | null) => {
        clearTimeout(timer);
        URL.revokeObjectURL(url);
        resolve(value);
      };
      const timer = setTimeout(() => done(null), 3000);
      worker.addEventListener('message', function ready(event) {
        if (event.data?.type !== 'ready') return;
        worker.removeEventListener('message', ready);
        done(worker);
      });
      worker.addEventListener('error', () => done(null));
    } catch {
      resolve(null);
    }
  });
  return shared;
}

const settle = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

export async function attach(surfaces: Surface[], clock: Clock, stageScale: number): Promise<Painter> {
  const offscreen =
    typeof OffscreenCanvas === 'function' && 'transferControlToOffscreen' in HTMLCanvasElement.prototype;
  const worker = offscreen ? await sharedWorker() : null;
  const entries = surfaces.map((surface) => ({ ...surface, id: ++nextId }));
  const size = (entry: Surface, stage: number) => {
    const [bx, by, bw, bh] = entry.node.box;
    const rect = entry.canvas.getBoundingClientRect();
    const current = Number.parseFloat(entry.canvas.style.width) || bw;
    const measured = rect.width / current;
    const dpr = globalThis.devicePixelRatio || 1;
    const scale = Math.min(Math.max(measured, stage, 0.01) * dpr, 4096 / Math.max(bw, bh, 1));
    const aligned = measured >= stage - 1e-6;
    const fraction = (v: number) => v - Math.floor(v);
    const fx = aligned ? fraction(rect.left * dpr) : 0;
    const fy = aligned ? fraction(rect.top * dpr) : 0;
    const width = Math.max(1, Math.ceil(bw * scale + fx));
    const height = Math.max(1, Math.ceil(bh * scale + fy));
    const box = [bx - fx / scale, by - fy / scale, width / scale, height / scale];
    const style = entry.canvas.style;
    style.left = `${box[0]}px`;
    style.top = `${box[1]}px`;
    style.width = `${box[2]}px`;
    style.height = `${box[3]}px`;
    return { width, height, scale, box };
  };
  const spec = (entry: Surface, stage: number): Spec => ({ paths: entry.node.c, ...size(entry, stage) });

  if (worker) {
    let seq = 0;
    const acked = new Map<number, number>();
    let waiters: { target: number; resolve: () => void }[] = [];
    const flush = () => {
      waiters = waiters.filter((w) => {
        const done = entries.every((entry) => (acked.get(entry.id) ?? -1) >= w.target);
        if (done) settle().then(w.resolve);
        return !done;
      });
    };
    const onMessage = (event: MessageEvent) => {
      const m = event.data;
      if (m?.type !== 'drawn' || !entries.some((entry) => entry.id === m.id)) return;
      acked.set(m.id, m.seq);
      flush();
    };
    worker.addEventListener('message', onMessage);
    for (const entry of entries) {
      const canvas = entry.canvas.transferControlToOffscreen();
      worker.postMessage({ type: 'add', id: entry.id, canvas, spec: spec(entry, stageScale), clock, seq }, [canvas]);
    }
    return {
      sync(next) {
        seq++;
        for (const entry of entries) worker.postMessage({ type: 'clock', id: entry.id, clock: next, seq });
      },
      resize(stage) {
        seq++;
        for (const entry of entries) worker.postMessage({ type: 'resize', id: entry.id, ...size(entry, stage), seq });
      },
      painted() {
        return new Promise((resolve) => {
          waiters.push({ target: seq, resolve });
          flush();
        });
      },
      destroy() {
        worker.removeEventListener('message', onMessage);
        for (const entry of entries) worker.postMessage({ type: 'remove', id: entry.id });
      },
    };
  }

  const r = renderer();
  for (const entry of entries) r.add(entry.id, entry.canvas, spec(entry, stageScale), clock);
  let frame = 0;
  const tick = () => {
    r.frame(performance.timeOrigin + performance.now());
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return {
    sync(next) {
      for (const entry of entries) r.clock(entry.id, next);
    },
    resize(stage) {
      for (const entry of entries) {
        const s = size(entry, stage);
        r.resize(entry.id, s.width, s.height, s.scale, s.box);
      }
    },
    painted: settle,
    destroy() {
      cancelAnimationFrame(frame);
      for (const entry of entries) r.remove(entry.id);
    },
  };
}
