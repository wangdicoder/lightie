# lightie

Lottie animations, compiled ahead of time into native browser animations.

lightie turns a Lottie (Bodymovin) JSON file into DOM nodes plus [Web Animations API](https://developer.mozilla.org/docs/Web/API/Web_Animations_API) keyframes. The browser then plays the animation itself. Transforms and opacity run on the compositor thread, so the animation keeps moving while the main thread is busy rendering React, parsing JSON or running a long task. No JavaScript runs per frame.

It covers the subset of Lottie that UI animations use most: loaders, icons, micro-interactions and onboarding illustrations. Anything outside that subset is reported by the compiler and can be handed to lottie-web automatically.

## Numbers

Bundle cost for a consumer (minified + gzip, static imports only, 1 kB = 1000 bytes):

| import | size |
| --- | --- |
| `lightie` (player) | 3.2 kB |
| `lightie/element` (`<lightie-player>`, includes the player) | 4.3 kB |
| `lightie/react` (includes the element) | 4.6 kB |
| paint worker (loaded on demand, only by animations with stroke-width, trim-path or shape-morph animation) | 3.7 kB |
| `lightie/compiler` (build time, or lazy-loaded for runtime compilation) | 14.9 kB |
| lottie-web 5.13 `lottie_light.min.js` / `lottie.min.js` | 46.5 kB / 76.1 kB |

Runtime cost, 24 instances on one page, headless Chromium 156 (`pnpm bench`):

| fixture | renderer | JS per second | main-thread busy per second | frames drawn in 500 ms | frames drawn in 500 ms with the main thread blocked |
| --- | --- | --- | --- | --- | --- |
| dots-loader | lottie-web | 31 ms | 82 ms | 30 | 1 |
| dots-loader | lightie | 0 ms | 1 ms | 30 | 30 |
| group-animation | lottie-web | 30 ms | 94 ms | 30 | 0 |
| group-animation | lightie | 0 ms | 0 ms | 30 | 30 |
| basic-transform | lottie-web | 21 ms | 60 ms | 30 | 1 |
| basic-transform | lightie | 0 ms | 0 ms | 30 | 30 |
| paint (colour and opacity) | lottie-web | 20 ms | 46 ms | 30 | 0 |
| paint (colour and opacity) | lightie | 0 ms | 0 ms | 30 | 30 |
| stroke-width | lottie-web | 10 ms | 48 ms | 30 | 1 |
| stroke-width | lightie | 0 ms | 3 ms | 30 | 30 |
| trim | lottie-web | 49 ms | 99 ms | 30 | 1 |
| trim | lightie | 0 ms | 8 ms | 30 | 30 |
| morph | lottie-web | 42 ms | 85 ms | 30 | 1 |
| morph | lightie | 0 ms | 7 ms | 30 | 30 |
| matte | lottie-web | 25 ms | 100 ms | 30 | 1 |
| matte | lightie | 0 ms | 0 ms | 30 | 30 |
| modifiers | lottie-web | 57 ms | 143 ms | 30 | 1 |
| modifiers | lightie | 0 ms | 2 ms | 30 | 30 |
| time-remap | lottie-web | 14 ms | 47 ms | 30 | 0 |
| time-remap | lightie | 0 ms | 1 ms | 29 | 31 |

Real-world coverage: `node scripts/corpus.ts <dir>` compiles every Lottie file in a directory and ranks what still needs the fallback. On the 189 sample animations in the lottie-ios repository, 106 (56.1%) compile without fallback and none fail to compile. The most common blockers are text layers (23 files), track mattes that are not solid shapes (20), animated masks (16), layer effects (13) and animated gradients (11). In the Chromium pixel comparison, 96 of the 102 natively supported files without external images match lottie-web. The other six are listed in `e2e/known-differences.ts` because lottie-web renders them wrongly: it throws on null easing handles and on `rx` without `ry` or `or`, builds a NaN matrix for a one-component anchor, and jumps to the end of a curved motion path when the easing undershoots.

Other browsers: `pnpm bench:video` records each browser while the main thread is blocked for 2 s. In Firefox, lottie-web stops changing for 1.85 s while lightie keeps moving, both for composited tracks and for worker-drawn canvases. Playwright's WebKit recording stalls with the main thread, so Safari was checked by hand in the playground instead: lightie keeps moving during the block.

Fidelity: every fixture is rendered by lottie-web and by lightie at nine frames, in Chromium, WebKit and Firefox, and compared pixel by pixel (`pnpm test:e2e`). A pixel only counts as different when neither image has a matching colour within one pixel of it, so edges that are anti-aliased differently by SVG, canvas or clip-path are not counted. The limit is 0.4% of pixels per frame; the worst bundled frame is 0.17% (Firefox, stroke-width).

## Install

```sh
npm install lightie
```

## Use

### Compile at build time (recommended)

With Vite:

```ts
// vite.config.ts
import lightie from 'lightie/vite';
export default { plugins: [lightie()] };
```

```ts
import animation from './loader.json?lightie';
```

Add `/// <reference types="lightie/vite-client" />` to a `.d.ts` file for the import type.

Anywhere else, use the CLI and ship the output JSON:

```sh
npx lightie compile loader.json -o loader.lightie.json
npx lightie check animations/*.json   # exits 1 if a file needs the fallback renderer
```

### Web Component

```html
<script type="module">
  import 'lightie/element';
</script>
<lightie-player src="/loader.lightie.json" autoplay loop style="width: 80px"></lightie-player>
```

`src` can also point at a raw Lottie file. The element then loads the compiler on demand and compiles in the browser, which costs the compiler download and a few milliseconds of work, so prefer precompiled files.

Attributes: `src`, `autoplay`, `loop` (or a play count such as `loop="3"`), `speed`, `fit` (`contain`, `cover`, `fill`, `none`). Properties: `animation`, `fallback`, `player`. Methods: `play()`, `pause()`, `stop()`, `seek(frame)`, `setSpeed(n)`, `setDirection(1 | -1)`. Events: `ready`, `complete`, `error`.

### React

```tsx
import { Lightie } from 'lightie/react';
import animation from './loader.json?lightie';

<Lightie animation={animation} autoplay loop style={{ width: 80 }} onComplete={() => {}} />;
```

The component is a thin wrapper around `<lightie-player>` and works with React 18 and 19.

### Plain JavaScript

```ts
import { createPlayer } from 'lightie';

const player = createPlayer(container, animation, { loop: true, autoplay: true });
player.pause();
player.seek(30);
player.destroy();
```

Options: `loop`, `autoplay`, `speed`, `direction`, `fit`, `pauseWhenHidden` (default `true`, pauses while scrolled out of view), `reducedMotion` (default `'respect'`: no autoplay when the user prefers reduced motion), `posterFrame`, `fallback`, `onComplete`.

### Fallback for unsupported features

```ts
import { lottieWebFallback } from 'lightie/fallback/lottie-web';

createPlayer(container, animation, { fallback: lottieWebFallback });
```

When the compiled animation lists unsupported features and carries its source (the Vite plugin and runtime compilation attach it; the CLI does with `--embed-source`), lightie loads lottie-web on demand and renders with it instead. Animations that compile cleanly never download lottie-web.

## What is supported

| tier | features | how it runs |
| --- | --- | --- |
| Composited, zero JS | position, rotation, scale, anchor, opacity, parenting, precomps (offset, stretch, clipping), layer in and out points, hold keyframes, per-keyframe bezier easing, static shapes (paths, rectangles, ellipses, stars, polygons), static repeaters (expanded into copies at compile time), static rounded corners, fills, strokes, dashes, linear and radial gradients, groups, single add masks, alpha and inverted-alpha track mattes whose matte is a solid-filled shape layer (moving mattes are baked into composited matrices), solids, images, blend modes, animated fill and stroke colour, animated fill and stroke opacity | WAAPI on `transform` / `opacity`, executed by the compositor |
| Worker canvas | trim paths (simultaneous and individual), shape morphing, animated rounded corners, animated rectangle, ellipse and polystar parameters (except the number of points), animated stroke width; colour or opacity animations on a style that also uses a blend mode | drawn on an OffscreenCanvas by one shared Web Worker, so a busy main thread does not stop it; drawn on the main thread when workers or OffscreenCanvas are unavailable (for example a CSP without `worker-src blob:`) |
| Baked at compile time | curved motion paths, separated position axes with different easing, skew, time remapping (everything inside a remapped precomp is sampled on the remapped clock) | sampled into linear keyframes, still composited |
| Fallback | expressions other than `loopIn` / `loopOut` (cycle, pingpong and offset loops are unrolled into keyframes), animated repeaters, other shape modifiers (pucker & bloat, zig zag, offset path, twist, merge), luma mattes, mattes with soft edges, strokes or partial opacity, text layers, effects, 3D layers | reported by the compiler; rendered by lottie-web when a fallback is configured |

## How it works

1. **Compile.** The compiler flattens precomp time into one timeline, turns every Lottie keyframe segment into a CSS `cubic-bezier()` (cutting segments exactly where precomps clip them), splits shape groups into static SVG and animated HTML wrappers, and writes a compact JSON scene. Browsers cannot composite SVG paint properties, so a colour animation becomes one opaque copy of the shape per keyframe colour, and the copies cross-fade with composited opacity. Fading copy B in over copy A at opacity `t` gives exactly the colour `lerp(A, B, t)`, so the result matches Lottie's colour interpolation.
2. **Play.** The player builds the DOM once and calls `element.animate()` for each track. All animations share one start time, so seeking, pausing and changing speed stay in sync. Shapes whose geometry changes (stroke width, trim paths, morphing) are compiled to canvas nodes; the player hands those canvases to a shared worker that draws each frame from the same keyframes and the same clock.

Lottie semantics (transform order, shape geometry, style inheritance, gradient highlights) follow lottie-web, which the fidelity tests use as the reference.

## Development

```sh
pnpm install
pnpm dev          # playground: lottie-web and lightie side by side
pnpm test         # unit tests
pnpm test:e2e     # pixel comparison against lottie-web + API tests in three browsers
pnpm bench        # main-thread cost and frames drawn under a blocked main thread
pnpm size         # bundle budgets
pnpm check        # lint, typecheck, unit tests, build, size
```

`pnpm fixtures` regenerates the test animations in `fixtures/` from `fixtures/build.ts`. To compare your own files without committing them, point `LIGHTIE_EXTRA_FIXTURES` at a comma-separated list of absolute paths before running `pnpm test:e2e`, `pnpm bench` or `pnpm dev`.

## License

MIT
