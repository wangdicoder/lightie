# Changelog

## 0.1.0

First release.

- Compiler (`lightie/compiler`, the `lightie compile` / `lightie check` CLI and the `lightie/vite` plugin) that turns Lottie JSON into a DOM scene plus Web Animations API tracks, with a report of anything that needs the fallback renderer.
- Player (`lightie`, 3.2 kB gzip), `<lightie-player>` (`lightie/element`), a React wrapper (`lightie/react`) and an on-demand lottie-web fallback (`lightie/fallback/lottie-web`).
- Runs on the compositor: position, rotation, scale, anchor, opacity, parenting, precomps, layer in/out points, hold and bezier easing, static shapes, fills, strokes, dashes, gradients, masks, blend modes, colour and opacity animation, alpha and inverted-alpha track mattes, static repeaters and rounded corners.
- Drawn in a shared worker through OffscreenCanvas: stroke width, trim paths, shape morphing, animated rectangle / ellipse / polystar parameters and animated rounded corners.
- Sampled at compile time and still composited: curved motion paths, separated position axes, skew, `rx` / `ry` rotation and time remapping.
- `loopIn` / `loopOut` expressions (cycle, pingpong, offset) are unrolled into keyframes; files older than Bodymovin 4.4.18 are migrated the way lottie-web migrates them.
- Paused players render as static styles, so a paused or reduced-motion frame is as sharp as an SVG.
- Falls back to lottie-web: other expressions, text layers, effects, 3D layers, luma mattes, animated repeaters and the remaining shape modifiers.
