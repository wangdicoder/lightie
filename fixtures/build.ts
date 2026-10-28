import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

type V = number | number[];
type Json = Record<string, unknown>;
interface Ease {
  o: { x: V; y: V };
  i: { x: V; y: V };
}

const here = dirname(fileURLToPath(import.meta.url));

const EASE: Ease = { o: { x: [0.42], y: [0] }, i: { x: [0.58], y: [1] } };
const EASE_OUT: Ease = { o: { x: [0.16], y: [1] }, i: { x: [0.3], y: [1] } };
const LINEAR: Ease = { o: { x: [0], y: [0] }, i: { x: [1], y: [1] } };
const OVERSHOOT: Ease = { o: { x: [0.3], y: [0] }, i: { x: [0.2], y: [1.6] } };

const vec = (v: V): number[] => (Array.isArray(v) ? v : [v]);
const fixed = (k: unknown) => ({ a: 0, k });
const anim = (...k: Json[]) => ({ a: 1, k });
const kf = (t: number, s: V, ease: Ease = EASE, extra: Json = {}) => ({ t, s: vec(s), ...ease, ...extra });
const end = (t: number, s: V) => ({ t, s: vec(s) });

const rgb = (hex: string): number[] => {
  const n = Number.parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
};

const ks = (o: Json = {}) => ({
  o: fixed(100),
  r: fixed(0),
  p: fixed([0, 0, 0]),
  a: fixed([0, 0, 0]),
  s: fixed([100, 100, 100]),
  ...o,
});

const tr = (o: Json = {}) => ({
  ty: 'tr',
  p: fixed([0, 0]),
  a: fixed([0, 0]),
  s: fixed([100, 100]),
  r: fixed(0),
  o: fixed(100),
  sk: fixed(0),
  sa: fixed(0),
  ...o,
});

const group = (nm: string, items: Json[], transform: Json = {}) => ({ ty: 'gr', nm, it: [...items, tr(transform)] });
const rect = (p: number[], s: number[], r = 0, d = 1) => ({ ty: 'rc', d, p: fixed(p), s: fixed(s), r: fixed(r) });
const ellipse = (p: number[], s: number[], d = 1) => ({ ty: 'el', d, p: fixed(p), s: fixed(s) });
const star = (o: Json) => ({ ty: 'sr', d: 1, p: fixed([0, 0]), r: fixed(0), ...o });
const path = (v: number[][], i: number[][], o: number[][], c = true) => ({ ty: 'sh', ks: fixed({ v, i, o, c }) });
const square = (cx: number, cy: number, half: number) =>
  path(
    [
      [cx - half, cy - half],
      [cx + half, cy - half],
      [cx + half, cy + half],
      [cx - half, cy + half],
    ],
    [
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
    ],
    [
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
    ],
  );
const fill = (hex: string, o = 100, r = 1) => ({ ty: 'fl', c: fixed(rgb(hex)), o: fixed(o), r });
const stroke = (hex: string, w: number, extra: Json = {}) => ({
  ty: 'st',
  c: fixed(rgb(hex)),
  o: fixed(100),
  w: fixed(w),
  lc: 2,
  lj: 2,
  ...extra,
});

let nextInd = 1;
const layer = (ty: number, nm: string, transform: Json, extra: Json, op: number) => ({
  ddd: 0,
  ind: nextInd++,
  ty,
  nm,
  sr: 1,
  ks: transform,
  ao: 0,
  ip: 0,
  op,
  st: 0,
  bm: 0,
  ...extra,
});
const shapeLayer = (nm: string, shapes: Json[], transform: Json, op: number, extra: Json = {}) =>
  layer(4, nm, transform, { shapes, ...extra }, op);
const nullLayer = (nm: string, transform: Json, op: number, extra: Json = {}) => layer(3, nm, transform, extra, op);

const composition = (nm: string, w: number, h: number, op: number, layers: Json[], extra: Json = {}) => ({
  v: '5.12.0',
  fr: 30,
  ip: 0,
  op,
  w,
  h,
  nm,
  ddd: 0,
  assets: [],
  layers,
  markers: [],
  ...extra,
});

const fixtures: Record<string, () => Json> = {
  'basic-transform': () =>
    composition('basic-transform', 200, 200, 60, [
      shapeLayer(
        'dot',
        [group('dot', [ellipse([0, 0], [28, 28]), fill('#2b2d42')])],
        ks({
          p: fixed([100, 40, 0]),
          a: fixed([-30, 0, 0]),
          r: anim(kf(0, 0, LINEAR), end(60, 360)),
        }),
        60,
      ),
      shapeLayer(
        'card',
        [group('card', [rect([0, 0], [80, 80], 12), fill('#ef476f')])],
        ks({
          p: anim(kf(0, [50, 120, 0]), kf(30, [150, 120, 0]), end(60, [50, 120, 0])),
          r: anim(kf(0, 0, EASE_OUT), kf(30, 180), end(60, 0)),
          s: anim(kf(0, [100, 100, 100], OVERSHOOT), kf(30, [60, 140, 100]), end(60, [100, 100, 100])),
          o: anim(kf(0, 100, EASE, { h: 1 }), kf(20, 30), kf(40, 30, EASE, { h: 1 }), end(50, 100)),
        }),
        60,
      ),
    ]),

  parenting: () => {
    nextInd = 1;
    const op = 60;
    return composition('parenting', 200, 200, op, [
      shapeLayer(
        'grandchild',
        [group('g', [ellipse([0, 0], [16, 16]), fill('#118ab2')])],
        ks({ p: fixed([30, 0, 0]), o: fixed(80) }),
        op,
        {
          ind: 3,
          parent: 2,
        },
      ),
      shapeLayer(
        'child',
        [group('c', [rect([0, 0], [36, 20], 4), fill('#06d6a0')])],
        ks({ p: fixed([50, 0, 0]), r: anim(kf(0, 0), end(60, -180)) }),
        op,
        { ind: 2, parent: 1 },
      ),
      shapeLayer(
        'follower',
        [group('f', [rect([0, 0], [24, 24]), fill('#ffd166')])],
        ks({ p: fixed([0, 60, 0]) }),
        op,
        {
          ind: 5,
          parent: 4,
        },
      ),
      nullLayer('hidden rig', ks({ p: anim(kf(0, [40, 40, 0]), end(60, [160, 40, 0])) }), op, { ind: 4, hd: true }),
      nullLayer(
        'rig',
        ks({
          p: anim(kf(0, [100, 110, 0]), end(60, [110, 100, 0])),
          r: anim(kf(0, 0), end(60, 90)),
          s: fixed([120, 120, 100]),
          o: fixed(40),
        }),
        op,
        { ind: 1 },
      ),
    ]);
  },

  precomp: () => {
    nextInd = 1;
    const ball = {
      id: 'ball',
      nm: 'ball',
      fr: 30,
      layers: [
        shapeLayer(
          'ball',
          [group('b', [ellipse([0, 0], [30, 30]), fill('#ef476f')])],
          ks({ p: anim(kf(0, [50, 20, 0]), kf(15, [50, 80, 0]), end(30, [50, 20, 0])) }),
          90,
        ),
        shapeLayer('backdrop', [group('bg', [rect([50, 50], [140, 140]), fill('#ffd166')])], ks(), 90),
      ],
    };
    return composition(
      'precomp',
      240,
      160,
      90,
      [
        layer(
          0,
          'stretched',
          ks({ p: fixed([180, 80, 0]), a: fixed([50, 50, 0]), r: anim(kf(10, -10), end(80, 10)) }),
          {
            refId: 'ball',
            w: 100,
            h: 100,
            st: 15,
            sr: 2,
            ip: 10,
            op: 80,
          },
          90,
        ),
        layer(0, 'normal', ks({ p: fixed([60, 80, 0]), a: fixed([50, 50, 0]) }), { refId: 'ball', w: 100, h: 100 }, 90),
        layer(1, 'background', ks(), { sc: '#e9ecef', sw: 240, sh: 160 }, 90),
      ],
      { assets: [ball] },
    );
  },

  'dots-loader': () => {
    nextInd = 1;
    const dot = {
      id: 'dot',
      nm: 'dot',
      fr: 30,
      layers: [
        shapeLayer(
          'dot',
          [group('d', [ellipse([0, 0], [24, 24]), fill('#5a189a')])],
          ks({
            p: fixed([20, 30, 0]),
            s: anim(kf(0, [60, 60, 100]), kf(10, [100, 100, 100]), kf(20, [60, 60, 100]), end(30, [60, 60, 100])),
            o: anim(kf(0, 40), kf(10, 100), end(20, 40)),
          }),
          60,
          { ip: -30 },
        ),
      ],
    };
    const instance = (x: number, st: number) =>
      layer(0, `dot ${x}`, ks({ p: fixed([x, 30, 0]), a: fixed([20, 30, 0]) }), { refId: 'dot', w: 40, h: 60, st }, 30);
    return composition('dots-loader', 160, 60, 30, [instance(40, 0), instance(80, 5), instance(120, 10)], {
      assets: [dot],
    });
  },

  shapes: () => {
    nextInd = 1;
    const op = 30;
    return composition('shapes', 220, 220, op, [
      shapeLayer(
        'strokes',
        [
          group('butt-miter', [
            path(
              [
                [10, 190],
                [40, 160],
                [70, 190],
              ],
              [
                [0, 0],
                [0, 0],
                [0, 0],
              ],
              [
                [0, 0],
                [0, 0],
                [0, 0],
              ],
              false,
            ),
            stroke('#073b4c', 8, { lc: 1, lj: 1, ml: 4 }),
          ]),
          group('square-bevel-dashed', [
            path(
              [
                [90, 190],
                [120, 160],
                [150, 190],
              ],
              [
                [0, 0],
                [0, 0],
                [0, 0],
              ],
              [
                [0, 0],
                [0, 0],
                [0, 0],
              ],
              false,
            ),
            stroke('#ef476f', 6, {
              lc: 3,
              lj: 3,
              d: [
                { n: 'd', nm: 'dash', v: fixed(8) },
                { n: 'g', nm: 'gap', v: fixed(5) },
                { n: 'o', nm: 'offset', v: fixed(3) },
              ],
            }),
          ]),
          group('curve', [
            path(
              [
                [170, 200],
                [210, 160],
              ],
              [
                [0, 0],
                [-30, 0],
              ],
              [
                [0, -40],
                [0, 0],
              ],
              false,
            ),
            stroke('#118ab2', 4),
          ]),
        ],
        ks(),
        op,
      ),
      shapeLayer(
        'gradients',
        [
          group('linear', [
            rect([50, 120], [80, 40], 8),
            {
              ty: 'gf',
              o: fixed(100),
              r: 1,
              t: 1,
              s: fixed([10, 120]),
              e: fixed([90, 120]),
              g: { p: 3, k: fixed([0, 0.937, 0.278, 0.435, 0.5, 1, 0.82, 0.4, 1, 0.024, 0.839, 0.627]) },
            },
          ]),
          group('radial', [
            ellipse([160, 120], [70, 70]),
            {
              ty: 'gf',
              o: fixed(90),
              r: 1,
              t: 2,
              s: fixed([160, 120]),
              e: fixed([195, 120]),
              h: fixed(30),
              a: fixed(45),
              g: { p: 2, k: fixed([0, 1, 1, 1, 1, 0.067, 0.541, 0.698, 0, 1, 0.6, 1, 1, 0.2]) },
            },
          ]),
        ],
        ks(),
        op,
      ),
      shapeLayer(
        'composition',
        [
          group(
            'stars',
            [
              star({ sy: 1, pt: fixed(5), or: fixed(22), os: fixed(0), ir: fixed(10), is: fixed(0), p: fixed([0, 0]) }),
              fill('#ffd166'),
              star({ sy: 2, pt: fixed(6), or: fixed(30), os: fixed(20), p: fixed([0, 0]), r: fixed(15) }),
              stroke('#073b4c', 3),
            ],
            { p: fixed([50, 45]), r: fixed(15), s: fixed([90, 110]) },
          ),
          group('inherit', [
            group('inner', [ellipse([0, 0], [30, 20]), stroke('#06d6a0', 4)], {
              p: fixed([130, 45]),
              s: fixed([150, 150]),
            }),
            fill('#118ab2'),
          ]),
          group('holes', [square(190, 45, 22), square(190, 45, 10), fill('#ef476f', 100, 2)]),
          group('group-opacity', [rect([18, 18], [24, 24]), rect([30, 30], [24, 24], 0, 3), fill('#073b4c')], {
            p: fixed([0, 0]),
            o: fixed(50),
          }),
        ],
        ks(),
        op,
      ),
    ]);
  },

  'group-animation': () => {
    nextInd = 1;
    const op = 60;
    const spoke = (angle: number) =>
      group(`spoke ${angle}`, [rect([0, -30], [8, 22], 4), fill('#5a189a')], { r: fixed(angle) });
    return composition('group-animation', 200, 200, op, [
      shapeLayer(
        'widgets',
        [
          group('pulse', [ellipse([0, 0], [40, 40]), fill('#ef476f')], {
            p: fixed([150, 150]),
            s: anim(kf(0, [80, 80]), kf(30, [130, 130]), end(60, [80, 80])),
            o: anim(kf(0, 100), kf(30, 40), end(60, 100)),
          }),
          group('static', [rect([100, 100], [60, 60], 10), fill('#ffd166')]),
          group('spinner', [spoke(0), spoke(90), spoke(180), spoke(270)], {
            p: fixed([60, 60]),
            r: anim(kf(0, 0, LINEAR), end(60, 360)),
          }),
          group(
            'orbit',
            [
              ellipse([0, 0], [10, 10]),
              fill('#073b4c'),
              group('moon', [ellipse([25, 0], [14, 14]), fill('#118ab2')], {
                r: anim(kf(0, 0, LINEAR), end(60, -720)),
              }),
            ],
            { p: anim(kf(0, [150, 50]), kf(30, [120, 60]), end(60, [150, 50])) },
          ),
        ],
        ks(),
        op,
      ),
    ]);
  },

  paint: () => {
    nextInd = 1;
    const op = 60;
    return composition('paint', 200, 200, op, [
      shapeLayer(
        'paint',
        [
          group('fill', [
            ellipse([60, 100], [70, 70]),
            {
              ty: 'fl',
              c: anim(kf(0, rgb('#ef476f')), kf(30, rgb('#06d6a0')), end(60, rgb('#ef476f'))),
              o: anim(kf(0, 100), kf(30, 35), end(60, 100)),
              r: 1,
            },
          ]),
          group('stroke', [
            rect([145, 100], [60, 60], 6),
            {
              ty: 'st',
              c: anim(kf(0, rgb('#073b4c'), EASE, { h: 1 }), kf(20, rgb('#118ab2')), end(60, rgb('#ffd166'))),
              o: anim(kf(0, 100), kf(45, 50), end(60, 100)),
              w: fixed(8),
              lc: 2,
              lj: 2,
            },
          ]),
        ],
        ks(),
        op,
      ),
    ]);
  },

  'stroke-width': () => {
    nextInd = 1;
    const op = 60;
    return composition('stroke-width', 200, 200, op, [
      shapeLayer(
        'stroke-width',
        [
          group('ring', [
            ellipse([100, 100], [110, 110]),
            {
              ty: 'st',
              c: fixed(rgb('#5a189a')),
              o: fixed(100),
              w: anim(kf(0, 2), kf(30, 22), end(60, 2)),
              lc: 2,
              lj: 2,
            },
          ]),
        ],
        ks(),
        op,
      ),
    ]);
  },

  trim: () => {
    nextInd = 1;
    const op = 60;
    const zigzag = path(
      [
        [20, 170],
        [60, 130],
        [100, 170],
        [140, 130],
        [180, 170],
      ],
      [
        [0, 0],
        [0, 0],
        [0, 0],
        [0, 0],
        [0, 0],
      ],
      [
        [0, 0],
        [0, 0],
        [0, 0],
        [0, 0],
        [0, 0],
      ],
      false,
    );
    return composition('trim', 200, 200, op, [
      shapeLayer(
        'trims',
        [
          group('draw-on', [
            ellipse([55, 55], [70, 70]),
            stroke('#ef476f', 8),
            { ty: 'tm', s: fixed(0), e: anim(kf(0, 0), end(40, 100)), o: anim(kf(0, 0, LINEAR), end(60, 270)), m: 1 },
          ]),
          group('chase', [
            zigzag,
            stroke('#118ab2', 6, { lc: 2, lj: 2 }),
            { ty: 'tm', s: anim(kf(10, 0), end(50, 60)), e: anim(kf(0, 30), end(40, 100)), o: fixed(0), m: 1 },
          ]),
          group('sequence', [
            rect([130, 40], [40, 40]),
            rect([175, 40], [30, 30]),
            stroke('#073b4c', 4, { lc: 1, lj: 1, ml: 4 }),
            { ty: 'tm', s: fixed(0), e: anim(kf(0, 0, LINEAR), end(60, 100)), o: fixed(0), m: 2 },
          ]),
          group('fill-trim', [
            ellipse([150, 100], [44, 44]),
            fill('#06d6a0'),
            { ty: 'tm', s: fixed(10), e: anim(kf(0, 20), end(60, 95)), o: fixed(0), m: 1 },
          ]),
        ],
        ks(),
        op,
      ),
    ]);
  },

  morph: () => {
    nextInd = 1;
    const op = 60;
    const shapeValue = (v: number[][], i: number[][], o: number[][]) => ({ v, i, o, c: true });
    const zero = [
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
    ];
    const square = shapeValue(
      [
        [-40, -40],
        [40, -40],
        [40, 40],
        [-40, 40],
      ],
      zero,
      zero,
    );
    const blob = shapeValue(
      [
        [0, -50],
        [50, 0],
        [0, 50],
        [-50, 0],
      ],
      [
        [-28, 0],
        [0, -28],
        [28, 0],
        [0, 28],
      ],
      [
        [28, 0],
        [0, 28],
        [-28, 0],
        [0, -28],
      ],
    );
    const diamond = shapeValue(
      [
        [0, -45],
        [45, 0],
        [0, 45],
        [-45, 0],
      ],
      zero,
      zero,
    );
    const morph = (values: unknown[], times: number[], ease = EASE) => ({
      ty: 'sh',
      ks: anim(
        ...values.map((value, n) =>
          n === values.length - 1
            ? end(times[n]!, [value] as unknown as number[])
            : kf(times[n]!, [value] as unknown as number[], ease),
        ),
      ),
    });
    return composition('morph', 200, 200, op, [
      shapeLayer(
        'filled',
        [group('f', [morph([square, blob, square], [0, 30, 60]), fill('#5a189a')])],
        ks({ p: fixed([60, 100, 0]), s: fixed([60, 60, 100]) }),
        op,
      ),
      shapeLayer(
        'stroked',
        [group('s', [morph([diamond, blob, diamond], [0, 30, 60]), stroke('#ef476f', 5)])],
        ks({ p: fixed([145, 100, 0]), s: fixed([70, 70, 100]) }),
        op,
      ),
    ]);
  },

  mask: () => {
    nextInd = 1;
    const op = 60;
    const blob = {
      mode: 'a',
      inv: false,
      nm: 'Mask 1',
      cl: true,
      o: fixed(100),
      x: fixed(0),
      pt: fixed({
        v: [
          [0, -40],
          [40, 0],
          [0, 40],
          [-40, 0],
        ],
        i: [
          [-22, 0],
          [0, -22],
          [22, 0],
          [0, 22],
        ],
        o: [
          [22, 0],
          [0, 22],
          [-22, 0],
          [0, -22],
        ],
        c: true,
      }),
    };
    return composition('mask', 200, 200, op, [
      shapeLayer(
        'masked',
        [
          group('stripes', [rect([0, -20], [120, 24]), rect([0, 20], [120, 24]), fill('#ef476f')]),
          group('bg', [rect([0, 0], [120, 120]), fill('#ffd166')]),
        ],
        ks({
          p: anim(kf(0, [70, 100, 0]), kf(30, [130, 100, 0]), end(60, [70, 100, 0])),
          r: anim(kf(0, 0), end(60, 90)),
        }),
        op,
        { hasMask: true, masksProperties: [blob] },
      ),
    ]);
  },

  spatial: () => {
    nextInd = 1;
    const op = 60;
    return composition('spatial', 200, 200, op, [
      shapeLayer(
        'curve',
        [group('c', [ellipse([0, 0], [20, 20]), fill('#ef476f')])],
        ks({
          p: anim(
            kf(0, [30, 170, 0], EASE, { to: [40, -120, 0], ti: [-60, 0, 0] }),
            kf(30, [170, 40, 0], EASE, { to: [0, 80, 0], ti: [40, 40, 0] }),
            end(60, [30, 170, 0]),
          ),
        }),
        op,
      ),
      shapeLayer(
        'separate',
        [group('s', [rect([0, 0], [18, 18]), fill('#118ab2')])],
        ks({
          p: {
            s: true,
            x: anim(kf(0, 30, LINEAR), end(60, 170)),
            y: anim(kf(0, 30, EASE_OUT), kf(30, 90), end(60, 30)),
          },
        }),
        op,
      ),
      shapeLayer(
        'skew',
        [group('k', [rect([0, 0], [50, 30]), fill('#06d6a0')])],
        ks({ p: fixed([60, 110, 0]), sk: fixed(20), sa: fixed(30) }),
        op,
      ),
      shapeLayer(
        'skew-animated',
        [group('k', [rect([0, 0], [50, 30]), fill('#5a189a')])],
        ks({ p: fixed([140, 110, 0]), sk: anim(kf(0, -25), kf(30, 25), end(60, -25)), sa: fixed(0) }),
        op,
      ),
    ]);
  },

  matte: () => {
    nextInd = 1;
    const op = 60;
    const bars = [
      group('bar-1', [rect([100, 70], [150, 24], 12), fill('#ef476f')]),
      group('bar-2', [rect([100, 100], [150, 24], 12), fill('#118ab2')]),
      group('bar-3', [rect([100, 130], [150, 24], 12), fill('#06d6a0')]),
    ];
    return composition('matte', 200, 200, op, [
      shapeLayer(
        'wipe',
        [group('window', [rect([0, 0], [90, 200]), fill('#000000')])],
        ks({ p: anim(kf(0, [-45, 100, 0]), end(40, [245, 100, 0])) }),
        op,
        { td: 1 },
      ),
      shapeLayer('revealed', bars, ks(), op, { tt: 1 }),
      shapeLayer(
        'hole',
        [group('circle', [ellipse([0, 0], [70, 70]), fill('#000000')])],
        ks({ p: fixed([100, 100, 0]), s: anim(kf(0, [40, 40, 100]), kf(30, [140, 140, 100]), end(60, [40, 40, 100])) }),
        op,
        { td: 1 },
      ),
      shapeLayer('backdrop', [group('panel', [rect([100, 100], [180, 180], 20), fill('#ffd166')])], ks(), op, {
        tt: 2,
      }),
    ]);
  },

  unsupported: () => {
    nextInd = 1;
    const op = 60;
    return composition('unsupported', 200, 200, op, [
      shapeLayer(
        'trim',
        [
          group('t', [
            ellipse([0, 0], [80, 80]),
            stroke('#ef476f', 6),
            { ty: 'tm', s: fixed(0), e: anim(kf(0, 0), end(60, 100)), o: fixed(0), m: 1 },
          ]),
        ],
        ks({ p: fixed([100, 100, 0]) }),
        op,
      ),
      shapeLayer(
        'morph',
        [
          group('m', [
            {
              ty: 'sh',
              ks: anim(
                kf(0, [
                  {
                    v: [
                      [-20, -20],
                      [20, -20],
                      [20, 20],
                      [-20, 20],
                    ],
                    i: [
                      [0, 0],
                      [0, 0],
                      [0, 0],
                      [0, 0],
                    ],
                    o: [
                      [0, 0],
                      [0, 0],
                      [0, 0],
                      [0, 0],
                    ],
                    c: true,
                  },
                ] as unknown as number[]),
                end(60, [
                  {
                    v: [
                      [0, -28],
                      [28, 0],
                      [0, 28],
                      [-28, 0],
                    ],
                    i: [
                      [0, 0],
                      [0, 0],
                      [0, 0],
                      [0, 0],
                    ],
                    o: [
                      [0, 0],
                      [0, 0],
                      [0, 0],
                      [0, 0],
                    ],
                    c: true,
                  },
                ] as unknown as number[]),
              ),
            },
            fill('#118ab2'),
          ]),
        ],
        ks({ p: fixed([50, 50, 0]) }),
        op,
      ),
      shapeLayer(
        'expression',
        [group('e', [rect([0, 0], [30, 30]), fill('#ffd166')])],
        ks({ p: fixed([150, 50, 0]), r: { a: 0, k: 0, x: 'var $bm_rt;\n$bm_rt = time * 90;' } }),
        op,
      ),
    ]);
  },
};

for (const [name, build] of Object.entries(fixtures)) {
  nextInd = 1;
  writeFileSync(join(here, `${name}.json`), `${JSON.stringify(build())}\n`);
}
process.stdout.write(`wrote ${Object.keys(fixtures).length} fixtures to ${here}\n`);
