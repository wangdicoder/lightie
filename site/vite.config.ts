import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = dirname(fileURLToPath(import.meta.url));
const project = resolve(root, '..');

export default defineConfig({
  root,
  base: process.env.LIGHTIE_SITE_BASE ?? '/lightie/',
  server: { port: 5190, fs: { allow: [project] } },
  resolve: {
    alias: [
      { find: /^lightie$/, replacement: resolve(project, 'src/index.ts') },
      { find: /^lightie\/(compiler|element|react|player)$/, replacement: resolve(project, 'src/$1/index.ts') },
      { find: /^lightie\/fallback\/lottie-web$/, replacement: resolve(project, 'src/fallback/lottie-web.ts') },
    ],
  },
  build: { outDir: resolve(project, 'site-dist'), emptyOutDir: true },
});
