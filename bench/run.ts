import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { type Browser, chromium, type Page } from '@playwright/test';
import { createServer } from 'vite';

const PORT = 5181;
const SECONDS = Number(process.env.BENCH_SECONDS ?? 4);
const COUNT = Number(process.env.BENCH_COUNT ?? 24);
const BLOCK_MS = 500;
const fixtures = process.env.BENCH_FIXTURES
  ? process.env.BENCH_FIXTURES.split(',').filter(Boolean)
  : [
      'dots-loader',
      'group-animation',
      'basic-transform',
      ...(process.env.LIGHTIE_EXTRA_FIXTURES ?? '').split(',').filter(Boolean),
    ];

interface Row {
  fixture: string;
  renderer: string;
  scriptMsPerSec: number;
  mainThreadMsPerSec: number;
  framesIdle: number;
  framesBlocked: number;
  mountMs: number;
}

type Metrics = Record<string, number>;

async function open(browser: Browser, renderer: string, fixture: string): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(
    `http://localhost:${PORT}/bench.html?renderer=${renderer}&fixture=${encodeURIComponent(fixture)}&count=${COUNT}`,
  );
  await page.waitForFunction(() => window.bench?.ready);
  await page.waitForTimeout(1000);
  return page;
}

async function steadyState(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const metrics = async (): Promise<Metrics> => {
    const { metrics } = (await cdp.send('Performance.getMetrics')) as { metrics: { name: string; value: number }[] };
    return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
  };
  const before = await metrics();
  await page.waitForTimeout(SECONDS * 1000);
  const after = await metrics();
  const per = (key: string) => Math.round((((after[key] ?? 0) - (before[key] ?? 0)) / SECONDS) * 1000);
  return { scriptMsPerSec: per('ScriptDuration'), mainThreadMsPerSec: per('TaskDuration') };
}

async function framesAroundBlock(browser: Browser, page: Page): Promise<{ idle: number; blocked: number }> {
  await browser.startTracing(page, { categories: ['viz', 'blink.user_timing'] });
  await page.evaluate(async (ms) => {
    performance.mark('lightie-idle-start');
    await new Promise((resolve) => setTimeout(resolve, ms));
    performance.mark('lightie-idle-end');
    performance.mark('lightie-block-start');
    const until = performance.now() + ms;
    while (performance.now() < until) {
      /* a long main-thread task */
    }
    performance.mark('lightie-block-end');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }, BLOCK_MS);
  const trace = JSON.parse((await browser.stopTracing()).toString()) as { traceEvents: { name: string; ts: number }[] };
  const events = trace.traceEvents;
  const at = (name: string) => events.find((e) => e.name === name)?.ts ?? 0;
  const count = (from: number, to: number) =>
    events.filter((e) => e.name === 'Display::DrawAndSwap' && e.ts > from && e.ts < to).length;
  return {
    idle: count(at('lightie-idle-start'), at('lightie-idle-end')),
    blocked: count(at('lightie-block-start'), at('lightie-block-end')),
  };
}

const server = await createServer({
  configFile: 'playground/vite.config.ts',
  server: { port: PORT, strictPort: true },
  logLevel: 'error',
});
await server.listen();
const browser = await chromium.launch();
const rows: Row[] = [];
try {
  for (const fixture of fixtures) {
    for (const renderer of ['lottie', 'lightie']) {
      const page = await open(browser, renderer, fixture);
      const steady = await steadyState(page);
      const frames = await framesAroundBlock(browser, page);
      const mountMs = await page.evaluate(() => window.bench.mountMs);
      rows.push({
        fixture: basename(fixture).replace('.json', ''),
        renderer: renderer === 'lottie' ? 'lottie-web' : 'lightie',
        ...steady,
        framesIdle: frames.idle,
        framesBlocked: frames.blocked,
        mountMs: Math.round(mountMs),
      });
      await page.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}

const table = [
  `${COUNT} instances per page, ${SECONDS}s steady-state sample, headless Chromium ${browser.version()}`,
  '',
  `| fixture | renderer | JS per second (ms) | main-thread busy per second (ms) | frames drawn in ${BLOCK_MS} ms, idle | frames drawn in ${BLOCK_MS} ms, main thread blocked | mount (ms) |`,
  `|${'---|'.repeat(7)}`,
  ...rows.map(
    (r) =>
      `| ${r.fixture} | ${r.renderer} | ${r.scriptMsPerSec} | ${r.mainThreadMsPerSec} | ${r.framesIdle} | ${r.framesBlocked} | ${r.mountMs} |`,
  ),
].join('\n');
mkdirSync(join('bench', 'results'), { recursive: true });
writeFileSync(join('bench', 'results', 'latest.md'), `${table}\n`);
writeFileSync(join('bench', 'results', 'latest.json'), JSON.stringify(rows, null, 2));
process.stdout.write(`${table}\n`);
