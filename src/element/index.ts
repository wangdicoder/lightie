import { createPlayer, type FallbackRenderer, type Fit, type Player } from '../player/index';
import { isLightieAnimation, type LightieAnimation } from '../types';

export const TAG_NAME = 'lightie-player';

const FITS: readonly Fit[] = ['contain', 'cover', 'fill', 'none'];
const STYLE =
  ':host{display:inline-block;position:relative;width:100%;overflow:hidden}:host([hidden]){display:none}.c{position:absolute;inset:0}';

const Base = (typeof HTMLElement === 'undefined' ? class {} : HTMLElement) as typeof HTMLElement;

const truthy = (value: unknown): boolean => value === true || value === '' || value === 'true';

export class LightiePlayerElement extends Base {
  static observedAttributes = ['src', 'loop', 'autoplay', 'speed', 'fit'];

  #fallback: FallbackRenderer | undefined;
  #data: unknown;
  #animation: LightieAnimation | undefined;
  #player: Player | undefined;
  #container: HTMLDivElement;
  #sizing: HTMLStyleElement;
  #token = 0;

  constructor() {
    super();
    const shadow = this.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = STYLE;
    this.#sizing = document.createElement('style');
    this.#container = document.createElement('div');
    this.#container.className = 'c';
    this.#container.setAttribute('part', 'container');
    shadow.append(style, this.#sizing, this.#container);
  }

  get animation(): unknown {
    return this.#data;
  }

  set animation(value: unknown) {
    this.#data = value;
    this.#load();
  }

  get player(): Player | undefined {
    return this.#player;
  }

  get fallback(): FallbackRenderer | undefined {
    return this.#fallback;
  }

  set fallback(renderer: FallbackRenderer | undefined) {
    this.#fallback = renderer;
    if (renderer && this.#animation?.unsupported?.length && !this.#player?.usingFallback) this.#load();
  }

  get src(): string {
    return this.getAttribute('src') ?? '';
  }

  set src(value: unknown) {
    if (value === undefined || value === null || value === '') this.removeAttribute('src');
    else this.setAttribute('src', String(value));
  }

  get loop(): boolean | number {
    const value = this.getAttribute('loop');
    if (value === null || value === 'false') return false;
    const count = Number(value);
    return value !== '' && Number.isFinite(count) && count > 0 ? count : true;
  }

  set loop(value: unknown) {
    if (value === undefined || value === null || value === false || value === 'false') this.removeAttribute('loop');
    else {
      const count = Number(value);
      this.setAttribute('loop', value !== true && value !== '' && count > 0 ? String(count) : '');
    }
  }

  get autoplay(): boolean {
    return this.hasAttribute('autoplay') && this.getAttribute('autoplay') !== 'false';
  }

  set autoplay(value: unknown) {
    this.toggleAttribute('autoplay', truthy(value));
  }

  get speed(): number {
    const speed = Number(this.getAttribute('speed') ?? 1);
    return speed > 0 ? speed : 1;
  }

  set speed(value: unknown) {
    if (value === undefined || value === null) this.removeAttribute('speed');
    else this.setAttribute('speed', String(value));
  }

  get fit(): Fit {
    const fit = this.getAttribute('fit') as Fit | null;
    return fit && FITS.includes(fit) ? fit : 'contain';
  }

  set fit(value: unknown) {
    if (value === undefined || value === null) this.removeAttribute('fit');
    else this.setAttribute('fit', String(value));
  }

  play(): void {
    this.#player?.play();
  }

  pause(): void {
    this.#player?.pause();
  }

  stop(): void {
    this.#player?.stop();
  }

  seek(frame: number): void {
    this.#player?.seek(frame);
  }

  setSpeed(speed: number): void {
    this.speed = speed;
  }

  setDirection(direction: 1 | -1): void {
    this.#player?.setDirection(direction);
  }

  connectedCallback(): void {
    this.#load();
  }

  disconnectedCallback(): void {
    this.#token++;
    this.#player?.destroy();
    this.#player = undefined;
  }

  attributeChangedCallback(name: string, previous: string | null, next: string | null): void {
    if (previous === next) return;
    if (name === 'speed' && this.#player) this.#player.setSpeed(this.speed);
    else this.#load();
  }

  async #load(): Promise<void> {
    const token = ++this.#token;
    if (!this.isConnected) return;
    try {
      let data = this.#data;
      if (data === undefined && this.src) {
        const response = await fetch(this.src);
        if (!response.ok) throw new Error(`lightie: failed to load ${this.src} (${response.status})`);
        data = await response.json();
      }
      if (token !== this.#token || data === undefined) return;
      let animation: LightieAnimation;
      if (isLightieAnimation(data)) animation = data;
      else {
        const { compile } = await import('../compiler/index');
        if (token !== this.#token) return;
        animation = compile(data, { source: 'embed' }).animation;
      }
      this.#player?.destroy();
      this.#animation = animation;
      this.#sizing.textContent = `:host{aspect-ratio:${animation.w}/${animation.h}}`;
      this.#player = createPlayer(this.#container, animation, {
        loop: this.loop,
        autoplay: this.autoplay,
        speed: this.speed,
        fit: this.fit,
        fallback: this.#fallback,
        onComplete: () => this.dispatchEvent(new Event('complete')),
      });
      this.dispatchEvent(new Event('ready'));
    } catch (error) {
      if (token === this.#token) this.dispatchEvent(new CustomEvent('error', { detail: error }));
    }
  }
}

if (typeof customElements !== 'undefined' && !customElements.get(TAG_NAME)) {
  customElements.define(TAG_NAME, LightiePlayerElement);
}

declare global {
  interface HTMLElementTagNameMap {
    'lightie-player': LightiePlayerElement;
  }
}
