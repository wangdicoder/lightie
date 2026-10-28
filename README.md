# lightie

Lottie animations, compiled ahead of time into native browser animations.

lightie turns a Lottie (Bodymovin) JSON file into DOM nodes plus [Web Animations API](https://developer.mozilla.org/docs/Web/API/Web_Animations_API) keyframes. The browser then plays the animation itself. Transforms and opacity run on the compositor thread, so the animation keeps moving while the main thread is busy rendering React, parsing JSON or running a long task. No JavaScript runs per frame.

It covers the subset of Lottie that UI animations use most: loaders, icons, micro-interactions and onboarding illustrations. Anything outside that subset is reported by the compiler and can be handed to lottie-web automatically.

## Numbers

Bundle cost for a consumer (minified + gzip, static imports only, 1 kB = 1000 bytes):

| import | size |
| --- | --- |
| `lightie` (player) | 3.1 kB |
| `lightie/element` (`<lightie-player>`, includes the player) | 4.2 kB |
| `lightie/react` (includes the element) | 4.5 kB |
| paint worker (loaded on demand, only by animations with stroke-width, trim-path or shape-morph animation) | 3.7 kB |
| `lightie/compiler` (build time, or lazy-loaded for runtime compilation) | 11.2 kB |
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

Fidelity: every fixture is rendered by lottie-web and by lightie at nine frames, in Chromium, WebKit and Firefox, and compared pixel by pixel (`pnpm test:e2e`). The worst frame differs in 0.19% of its pixels, which is anti-aliasing. Shapes drawn on a canvas (stroke width, trim paths, morphing) are allowed 0.8%, because canvas and SVG anti-alias thin strokes slightly differently; the worst measured frame is 0.66% (Firefox, a 2 px ring).

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
| Composited, zero JS | position, rotation, scale, anchor, opacity, parenting, precomps (offset, stretch, clipping), layer in and out points, hold keyframes, per-keyframe bezier easing, static shapes (paths, rectangles, ellipses, stars, polygons), fills, strokes, dashes, linear and radial gradients, groups, single add masks, alpha and inverted-alpha track mattes whose matte is a solid-filled shape layer (moving mattes are baked into composited matrices), solids, images, blend modes, animated fill and stroke colour, animated fill and stroke opacity | WAAPI on `transform` / `opacity`, executed by the compositor |
| Worker canvas | trim paths (simultaneous and individual), shape morphing, animated stroke width; colour or opacity animations on a style that also uses a blend mode | drawn on an OffscreenCanvas by one shared Web Worker, so a busy main thread does not stop it; drawn on the main thread when workers or OffscreenCanvas are unavailable (for example a CSP without `worker-src blob:`) |
| Baked at compile time | curved motion paths, separated position axes with different easing, skew | sampled into linear keyframes, still composited |
| Fallback | shape modifiers (repeater, rounded corners, …), luma mattes, mattes with soft edges, strokes or partial opacity, expressions, text layers, effects, time remapping, 3D layers | reported by the compiler; rendered by lottie-web when a fallback is configured |

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
