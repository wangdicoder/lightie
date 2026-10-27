import { createPlayer, type Player } from 'lightie';
import { type CompileReport, compile } from 'lightie/compiler';
import lottie, { type AnimationItem } from 'lottie-web';
import { loadFixture } from './fixtures';

export interface MountInfo {
  report: CompileReport;
  totalFrames: number;
  width: number;
  height: number;
}

export interface Harness {
  mount(name: string, width: number): Promise<MountInfo>;
  frame(frame: number): Promise<void>;
}

declare global {
  interface Window {
    lightieHarness: Harness;
  }
}

const refEl = document.getElementById('ref') as HTMLDivElement;
const outEl = document.getElementById('out') as HTMLDivElement;
let reference: AnimationItem | undefined;
let player: Player | undefined;

const settle = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

window.lightieHarness = {
  async mount(name, width) {
    const data = (await loadFixture(name)) as { w: number; h: number };
    const height = Math.round((width * data.h) / data.w);
    for (const el of [refEl, outEl]) {
      el.style.width = `${width}px`;
      el.style.height = `${height}px`;
    }
    reference?.destroy();
    player?.destroy();
    const anim = lottie.loadAnimation({
      container: refEl,
      renderer: 'svg',
      loop: false,
      autoplay: false,
      animationData: structuredClone(data),
    });
    if (!anim.isLoaded) await new Promise<void>((resolve) => anim.addEventListener('DOMLoaded', () => resolve()));
    reference = anim;
    const { animation, report } = compile(data);
    player = createPlayer(outEl, animation, {
      autoplay: false,
      loop: true,
      pauseWhenHidden: false,
      reducedMotion: 'ignore',
    });
    await settle();
    return { report, totalFrames: animation.op - animation.ip, width, height };
  },
  async frame(frame) {
    reference?.goToAndStop(frame, true);
    player?.seek(frame);
    await settle();
  },
};
