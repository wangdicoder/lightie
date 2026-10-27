import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = dirname(fileURLToPath(import.meta.url));
const project = resolve(root, '..');
const extra = (process.env.LIGHTIE_EXTRA_FIXTURES ?? '')
  .split(',')
  .filter(Boolean)
  .map((file) => dirname(resolve(file)));

export default defineConfig({
  root,
  server: { port: 5179, fs: { allow: [project, ...extra] } },
  define: { __EXTRA_FIXTURES__: JSON.stringify(process.env.LIGHTIE_EXTRA_FIXTURES ?? '') },
  resolve: {
    alias: [
      { find: /^lightie$/, replacement: resolve(project, 'src/index.ts') },
      { find: /^lightie\/(compiler|element|react|player)$/, replacement: resolve(project, 'src/$1/index.ts') },
      { find: /^lightie\/fallback\/lottie-web$/, replacement: resolve(project, 'src/fallback/lottie-web.ts') },
    ],
  },
  build: {
    rollupOptions: {
      input: {
        index: resolve(root, 'index.html'),
        harness: resolve(root, 'harness.html'),
        bench: resolve(root, 'bench.html'),
      },
    },
  },
});
