import { createPlayer, type LightieAnimation } from 'lightie';
import { compile } from 'lightie/compiler';
import { lottieWebFallback } from 'lightie/fallback/lottie-web';
import { Lightie, type LightieProps } from 'lightie/react';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { loadFixture } from './fixtures';

const api = {
  createPlayer,
  compile,
  loadFixture,
  lottieWebFallback,
  async compiled(name: string): Promise<LightieAnimation> {
    return compile(await loadFixture(name), { source: 'embed' }).animation;
  },
  renderReact(container: HTMLElement, props: LightieProps) {
    const root = createRoot(container);
    root.render(createElement(Lightie, props));
    return () => root.unmount();
  },
};

declare global {
  interface Window {
    lightieApi: typeof api;
  }
}

window.lightieApi = api;
