import { writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import type { MountInfo } from '../playground/harness';

const FIXTURES = [
  'basic-transform',
  'parenting',
  'precomp',
  'dots-loader',
  'shapes',
  'group-animation',
  'paint',
  'stroke-width',
  'trim',
  'morph',
  'shape-params',
  'modifiers',
  'matte',
  'mask',
  'spatial',
  ...(process.env.LIGHTIE_EXTRA_FIXTURES ?? '').split(',').filter(Boolean),
];
const WIDTH = 240;
const MAX_MISMATCH = Number(process.env.LIGHTIE_MAX_MISMATCH ?? 0.004);
const CANVAS_ANTIALIASING_MISMATCH = 0.008;
const CANVAS_FIXTURES = new Set(['stroke-width', 'trim', 'morph', 'shape-params', 'modifiers']);

const framesFor = (total: number): number[] => {
  const frames = new Set<number>([0]);
  for (let n = 1; n < 8; n++) frames.add(Math.round(((total * n) / 8 + 0.37) * 100) / 100);
  frames.add(total - 1);
  return [...frames].sort((a, b) => a - b);
};

for (const name of FIXTURES) {
  test(`renders like lottie-web: ${name.split('/').pop()}`, async ({ page }, testInfo) => {
    await page.goto('/harness.html');
    await page.waitForFunction(() => 'lightieHarness' in window);
    const info: MountInfo = await page.evaluate(
      ([n, w]) => window.lightieHarness.mount(n as string, w as number),
      [name, WIDTH],
    );
    expect(info.report.supported, info.report.unsupported.map((u) => u.feature).join(', ')).toBe(true);
    const results: string[] = [];
    const failures: string[] = [];
    for (const frame of framesFor(info.totalFrames)) {
      await page.evaluate((f) => window.lightieHarness.frame(f), frame);
      const a = PNG.sync.read(await page.locator('#ref').screenshot());
      const b = PNG.sync.read(await page.locator('#out').screenshot());
      const diff = new PNG({ width: a.width, height: a.height });
      const mismatched = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1 });
      const ratio = mismatched / (a.width * a.height);
      results.push(`${frame}:${(ratio * 100).toFixed(2)}%`);
      if (ratio > (CANVAS_FIXTURES.has(name) ? CANVAS_ANTIALIASING_MISMATCH : MAX_MISMATCH)) {
        failures.push(`frame ${frame}: ${(ratio * 100).toFixed(2)}% of pixels differ`);
        for (const [label, png] of [
          ['lottie-web', a],
          ['lightie', b],
          ['diff', diff],
        ] as const) {
          const file = testInfo.outputPath(`frame-${frame}-${label}.png`);
          writeFileSync(file, PNG.sync.write(png));
          await testInfo.attach(`frame-${frame}-${label}`, { path: file, contentType: 'image/png' });
        }
      }
    }
    testInfo.annotations.push({ type: 'mismatch', description: results.join(' ') });
    console.log(`[${testInfo.project.name}] ${name.split('/').pop()}: ${results.join(' ')}`);
    expect(failures).toEqual([]);
  });
}
