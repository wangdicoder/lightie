# AGENTS.md

lightie compiles Lottie JSON into DOM + Web Animations API keyframes. Single package, ESM only, subpath exports.

## Layout

- `src/compiler/` — Lottie → scene IR (`src/types.ts`). Pure TypeScript, no DOM, runs in Node and the browser.
  - `property.ts` keyframe normalisation and evaluation, `track.ts` time mapping, exact bezier slicing and baking, `transform.ts` layer and group transforms, `shapes.ts` shape layers, `layers.ts` layers, precomps and parenting.
- `src/player/` — scene IR → DOM + `element.animate()`; the runtime everyone ships. Budget 3.5 KB gzip.
- `src/element/` — `<lightie-player>`; `src/react/` — thin wrapper over the element; `src/fallback/` — lottie-web adapter.
- `src/vite/`, `src/cli/` — build-time entry points (Node).
- `fixtures/build.ts` generates every fixture JSON. Edit it and run `pnpm fixtures`; never hand-edit `fixtures/*.json`.
- `playground/` — Vite app: `index.html` (side-by-side demo), `harness.html` (fidelity tests), `api.html` (API tests), `bench.html` (benchmark).

## Commands

| action | command |
| --- | --- |
| everything except e2e | `pnpm check` |
| unit tests | `pnpm test` |
| fidelity + API tests (Chromium, WebKit, Firefox) | `pnpm test:e2e` |
| one browser | `pnpm test:e2e --project=chromium` |
| benchmark | `pnpm bench` |
| bundle budgets | `pnpm build && pnpm size` |

Run `pnpm test:e2e` after any compiler or player change; it is the merge gate for fidelity.

## Lottie semantics that are easy to get wrong

- Keyframe times are in the containing composition's time. A layer's `st` does not shift its own keyframes; it only offsets the time inside a precomp (`child time = (parent time - st) / sr`).
- Transform order is `translate(p) · rotate(r) · skew · scale(s) · translate(-anchor)`. Parents pass on their transform but never their opacity.
- A style (`fl`, `st`, `gf`, `gs`) paints every shape above it in its group, including shapes in nested groups above it. Transforms of groups between the style and the shape are baked into the path, so the stroke is not scaled by them.
- lottie-web ignores merge paths (`mm`) and always clips precomps to their width and height.

## Browser constraints the player relies on

- Chrome does not composite `translate` / `rotate` / `scale` animations on an `<svg>` element, so every scene node is a `<div>`; SVG content sits inside it unanimated.
- WebKit drops `opacity` on a zero-sized element whose content overflows, so node divs are 1 px × 1 px.
- Chrome does not composite two animations of the same property on one element. The compiler emits at most one track per property per node; keep it that way.
- SVG paint properties never run on the compositor. Colour animations are compiled into cross-faded opaque copies (`crossFade` in `src/compiler/shapes.ts`) and fill/stroke opacity into a wrapper `opacity` track.
- Stroke width, trim paths, shape morphing (and colour/opacity on blend-mode styles) compile to `canvas` nodes; trims are applied per shape exactly like lottie-web's TrimModifier. `src/player/painter.ts` draws them in one shared Blob-URL worker via OffscreenCanvas; `renderer()` and `workerMain()` are serialised with `toString()`, so they must stay self-contained (no imports, no outer variables). Without worker support the same renderer runs on the main thread.
- Tests and screenshots must `await player.painted()` after `seek()`; canvas frames arrive asynchronously from the worker.
- Track mattes compile to an outer div that carries the matte transform plus a static `clip-path` (the matte shape in matte space) and an inner div with the inverse transform, so the matted content stays put while everything stays composited. The outer wrappers reuse the matte layer's own tracks; the inverse negates translate/rotate keyframes exactly and samples only the reciprocal of an animated scale. Animated anchors or skew fall back to sampled `transform` matrices.

## Measuring main-thread independence

- Chromium: `pnpm bench` counts `Display::DrawAndSwap` trace events while the page runs a long task.
- Firefox: `pnpm bench:video` (screen recording; needs `ffmpeg` on PATH).
- Safari/WebKit: no automated signal. Playwright screenshots wait for the main thread in every browser, and its WebKit recording stalls with it. Check by hand: `pnpm dev`, open the playground in Safari, press "Block main thread".

## Releasing

1. Bump `version` in `package.json` and add a `CHANGELOG.md` entry.
2. Push a `vX.Y.Z` tag. `.github/workflows/release.yml` checks the tag against `package.json` and publishes with npm provenance. It needs the repository secret `NPM_TOKEN`.
3. Manual alternative: `npm login`, then `pnpm publish --access public`. `prepublishOnly` runs `pnpm check` first.

## Conventions

- Code comments are not used; names and tests carry intent.
- Never commit third-party or proprietary animations. Use `LIGHTIE_EXTRA_FIXTURES=/abs/a.json,/abs/b.json` to test them locally.
- Playwright reuses a dev server already running on port 5179. If results look stale, stop any manually started `pnpm dev` and rerun.
- Dependencies must be at least 7 days old (`minimumReleaseAge` in `pnpm-workspace.yaml`).
