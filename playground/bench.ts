import { createPlayer } from 'lightie';
import { compile } from 'lightie/compiler';
import lottie from 'lottie-web';
import { loadFixture } from './fixtures';

declare global {
  interface Window {
    bench: { ready: boolean; frames: number; mountMs: number };
  }
}

const params = new URLSearchParams(location.search);
const renderer = params.get('renderer') ?? 'lightie';
const fixture = params.get('fixture') ?? 'dots-loader';
const count = Number(params.get('count') ?? 20);
const block = Number(params.get('block') ?? 0);
const grid = document.getElementById('grid') as HTMLDivElement;

window.bench = { ready: false, frames: 0, mountMs: 0 };

const data = (await loadFixture(fixture)) as { ip: number; op: number };
const totalFrames = data.op - data.ip;
const cells = Array.from({ length: count }, () => grid.appendChild(document.createElement('div')));
const phase = (i: number) => (i / count) * totalFrames;
const start = performance.now();
if (renderer === 'lottie') {
  cells.forEach((cell, i) => {
    const anim = lottie.loadAnimation({
      container: cell,
      renderer: 'svg',
      loop: true,
      autoplay: true,
      animationData: structuredClone(data),
    });
    anim.addEventListener('DOMLoaded', () => anim.goToAndPlay(phase(i), true));
    anim.addEventListener('enterFrame', () => {
      window.bench.frames++;
    });
  });
} else {
  const { animation } = compile(data);
  for (const [i, cell] of cells.entries()) createPlayer(cell, animation, { reducedMotion: 'ignore' }).seek(phase(i));
}
window.bench.mountMs = performance.now() - start;

if (block > 0) {
  setInterval(() => {
    const until = performance.now() + block;
    while (performance.now() < until) {
      /* simulate a busy main thread */
    }
  }, 100);
}

requestAnimationFrame(() => {
  window.bench.ready = true;
});
