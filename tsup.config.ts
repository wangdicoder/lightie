import { defineConfig } from 'tsup';

const tsconfig = 'tsconfig.build.json';

export default defineConfig([
  {
    tsconfig,
    entry: {
      index: 'src/index.ts',
      compiler: 'src/compiler/index.ts',
      element: 'src/element/index.ts',
      react: 'src/react/index.ts',
      'fallback-lottie-web': 'src/fallback/lottie-web.ts',
    },
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    dts: true,
    splitting: true,
    treeshake: true,
    external: ['react', 'lottie-web'],
  },
  {
    tsconfig,
    entry: { vite: 'src/vite/index.ts' },
    format: 'esm',
    platform: 'node',
    target: 'node20',
    dts: true,
    external: ['vite'],
  },
  {
    tsconfig,
    entry: { cli: 'src/cli/index.ts' },
    format: 'esm',
    platform: 'node',
    target: 'node20',
    banner: { js: '#!/usr/bin/env node' },
  },
]);
