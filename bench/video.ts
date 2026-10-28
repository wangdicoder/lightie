import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type BrowserType, chromium, firefox, webkit } from '@playwright/test';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { createServer } from 'vite';

const PORT = 5183;
const BLOCK_MS = 2000;
const FPS = 20;
const fixtures = (process.env.BENCH_FIXTURES ?? 'group-animation,stroke-width').split(',').filter(Boolean);
const browsers: [string, BrowserType][] = [
  ['chromium', chromium],
  ['webkit', webkit],
  ['firefox', firefox],
];

function longestFreeze(video: string): number {
  const dir = mkdtempSync(join(tmpdir(), 'lightie-frames-'));
  try {
    execFileSync('ffmpeg', ['-loglevel', 'error', '-i', video, '-vf', `fps=${FPS}`, join(dir, 'f%04d.png')]);
    const frames = readdirSync(dir)
      .filter((f) => f.endsWith('.png'))
      .sort()
      .map((f) => PNG.sync.read(readFileSync(join(dir, f))));
    let longest = 0;
    let run = 0;
    for (let i = 1; i < frames.length; i++) {
      const a = frames[i - 1]!;
      const b = frames[i]!;
      const moved = pixelmatch(a.data, b.data, null, a.width, a.height, { threshold: 0.05 }) > 0;
      run = moved ? 0 : run + 1;
      longest = Math.max(longest, run);
    }
    return Math.round((longest * 1000) / FPS);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const server = await createServer({
  configFile: 'playground/vite.config.ts',
  server: { port: PORT, strictPort: true },
  logLevel: 'error',
});
await server.listen();
const rows: string[] = [];
const videos = mkdtempSync(join(tmpdir(), 'lightie-video-'));
try {
  for (const [name, type] of browsers) {
    const browser = await type.launch();
    for (const fixture of fixtures) {
      for (const renderer of ['lottie', 'lightie']) {
        const size = { width: 480, height: 260 };
        const context = await browser.newContext({ viewport: size, recordVideo: { dir: videos, size } });
        const page = await context.newPage();
        await page.goto(`http://localhost:${PORT}/bench.html?renderer=${renderer}&fixture=${fixture}&count=6`);
        await page.waitForFunction(() => window.bench?.ready);
        await page.waitForTimeout(1000);
        await page.evaluate((ms) => {
          const until = performance.now() + ms;
          while (performance.now() < until) {
            /* a long main-thread task */
          }
        }, BLOCK_MS);
        await page.waitForTimeout(800);
        const video = page.video();
        await context.close();
        const path = video ? await video.path() : '';
        const freeze = path ? longestFreeze(path) : -1;
        rows.push(`| ${name} | ${fixture} | ${renderer === 'lottie' ? 'lottie-web' : 'lightie'} | ${freeze} ms |`);
      }
    }
    await browser.close();
  }
} finally {
  await server.close();
  rmSync(videos, { recursive: true, force: true });
}

const table = [
  `Longest stretch without any visual change in a screen recording, while the main thread is blocked for ${BLOCK_MS} ms`,
  '',
  '| browser | fixture | renderer | longest freeze |',
  '|---|---|---|---|',
  ...rows,
].join('\n');
mkdirSync(join('bench', 'results'), { recursive: true });
writeFileSync(join('bench', 'results', 'video.md'), `${table}\n`);
process.stdout.write(`${table}\n`);
