import { resolve } from 'node:path';
import { expect, type Page, test } from '@playwright/test';

const fixtureUrl = (name: string) => `/@fs${resolve(import.meta.dirname, '..', 'fixtures', `${name}.json`)}`;

async function open(page: Page) {
  await page.goto('/api.html');
  await page.waitForFunction(() => 'lightieApi' in window);
}

test.describe('createPlayer', () => {
  test('autoplays, pauses, seeks and cleans up', async ({ page }) => {
    await open(page);
    const result = await page.evaluate(async () => {
      const { createPlayer, compiled } = window.lightieApi;
      const stage = document.getElementById('stage')!;
      const host = stage.appendChild(document.createElement('div'));
      const player = createPlayer(host, await compiled('basic-transform'), { reducedMotion: 'ignore' });
      const playing = player.isPlaying;
      const running = document.getAnimations().filter((a) => a.playState === 'running').length;
      player.pause();
      player.seek(30);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const card = player.root.firstElementChild!.firstElementChild as HTMLElement;
      const translate = getComputedStyle(card).translate;
      const paused = document.getAnimations().every((a) => a.playState === 'paused');
      player.destroy();
      return {
        playing,
        running,
        paused,
        translate,
        left: document.getAnimations().length,
        children: host.childElementCount,
      };
    });
    expect(result.playing).toBe(true);
    expect(result.running).toBeGreaterThan(0);
    expect(result.paused).toBe(true);
    expect(result.translate).toBe('150px 120px');
    expect(result.left).toBe(0);
    expect(result.children).toBe(0);
  });

  test('fires onComplete when a finite loop ends', async ({ page }) => {
    await open(page);
    const elapsed = await page.evaluate(async () => {
      const { createPlayer, compiled } = window.lightieApi;
      const host = document.getElementById('stage')!.appendChild(document.createElement('div'));
      const animation = await compiled('dots-loader');
      const started = performance.now();
      return new Promise<number>((resolve) => {
        createPlayer(host, animation, {
          loop: false,
          speed: 4,
          reducedMotion: 'ignore',
          onComplete: () => resolve(performance.now() - started),
        });
      });
    });
    expect(elapsed).toBeGreaterThan(150);
    expect(elapsed).toBeLessThan(2000);
  });

  test('respects prefers-reduced-motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page);
    const playing = await page.evaluate(async () => {
      const { createPlayer, compiled } = window.lightieApi;
      const host = document.getElementById('stage')!.appendChild(document.createElement('div'));
      return createPlayer(host, await compiled('dots-loader')).isPlaying;
    });
    expect(playing).toBe(false);
  });
});

test.describe('<lightie-player>', () => {
  test('compiles raw Lottie JSON from src at runtime', async ({ page }) => {
    await open(page);
    const result = await page.evaluate(async (src) => {
      const el = document.createElement('lightie-player');
      el.setAttribute('loop', '');
      el.setAttribute('autoplay', '');
      const ready = new Promise<void>((r) => el.addEventListener('ready', () => r(), { once: true }));
      el.setAttribute('src', src);
      document.getElementById('stage')!.append(el);
      await ready;
      return {
        playing: el.player?.isPlaying,
        nodes: el.shadowRoot?.querySelectorAll('svg').length ?? 0,
        aspect: getComputedStyle(el).aspectRatio,
      };
    }, fixtureUrl('dots-loader'));
    expect(result.playing).toBe(true);
    expect(result.nodes).toBeGreaterThan(0);
    expect(result.aspect).toContain('160');
  });

  test('accepts a precompiled animation and falls back to lottie-web for unsupported features', async ({ page }) => {
    await open(page);
    const result = await page.evaluate(async () => {
      const { compiled, lottieWebFallback } = window.lightieApi;
      const el = document.createElement('lightie-player');
      el.fallback = lottieWebFallback;
      el.autoplay = true;
      document.getElementById('stage')!.append(el);
      const ready = new Promise<void>((r) => el.addEventListener('ready', () => r(), { once: true }));
      el.animation = await compiled('unsupported');
      await ready;
      await new Promise((r) => setTimeout(r, 300));
      return { fallback: el.player?.usingFallback, lottieSvg: el.shadowRoot?.querySelectorAll('svg').length ?? 0 };
    });
    expect(result.fallback).toBe(true);
    expect(result.lottieSvg).toBe(1);
  });
});

test.describe('React wrapper', () => {
  test('renders the custom element and forwards events', async ({ page }) => {
    await open(page);
    const result = await page.evaluate(async () => {
      const { renderReact, compiled } = window.lightieApi;
      const host = document.getElementById('stage')!.appendChild(document.createElement('div'));
      const animation = await compiled('group-animation');
      let readyCount = 0;
      const ready = new Promise<void>((resolve) => {
        renderReact(host, {
          animation,
          loop: true,
          autoplay: true,
          className: 'demo',
          onReady: () => {
            readyCount++;
            resolve();
          },
        });
      });
      await ready;
      const el = host.querySelector('lightie-player')!;
      return { readyCount, className: el.className, playing: el.player?.isPlaying, loop: el.loop };
    });
    expect(result).toEqual({ readyCount: 1, className: 'demo', playing: true, loop: true });
  });
});
