import { createPlayer, type Player } from 'lightie';
import { compile } from 'lightie/compiler';
import { lottieWebFallback } from 'lightie/fallback/lottie-web';
import lottie, { type AnimationItem } from 'lottie-web';

const bundled = import.meta.glob<string>('../fixtures/*.json', { query: '?raw', import: 'default' });
const names = Object.keys(bundled)
  .map((path) => path.replace('../fixtures/', '').replace('.json', ''))
  .sort();
const load = async (name: string): Promise<unknown> => JSON.parse(await bundled[`../fixtures/${name}.json`]!());

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const select = $<HTMLSelectElement>('fixture');
const file = $<HTMLInputElement>('file');
const toggle = $<HTMLButtonElement>('toggle');
const block = $<HTMLButtonElement>('block');
const report = $<HTMLPreElement>('report');
const demo = $<HTMLElement>('demo');

let reference: AnimationItem | undefined;
let player: Player | undefined;
let playing = true;

const kb = (bytes: number) => `${(bytes / 1000).toFixed(1)} kB`;

function show(data: unknown, label: string) {
  reference?.destroy();
  player?.destroy();
  reference = lottie.loadAnimation({
    container: $('ref'),
    renderer: 'svg',
    loop: true,
    autoplay: true,
    animationData: structuredClone(data),
  });
  const started = performance.now();
  try {
    const { animation, report: result } = compile(data, { source: 'embed' });
    const elapsed = performance.now() - started;
    player = createPlayer($('out'), animation, { reducedMotion: 'ignore', fallback: lottieWebFallback });
    const { source: _source, ...scene } = animation;
    report.textContent = [
      `${label}: ${result.supported ? 'plays natively with lightie' : 'uses the lottie-web fallback'}`,
      `compiled in ${elapsed.toFixed(1)} ms · Lottie JSON ${kb(JSON.stringify(data).length)} → lightie scene ${kb(JSON.stringify(scene).length)}`,
      `tracks: ${result.tracks.composited} on the compositor · ${result.tracks.paint} in the paint worker · ${result.tracks.baked} sampled`,
      ...result.unsupported.map((u) => `needs fallback: ${u.feature} (${u.where.join(', ')})`),
    ].join('\n');
  } catch (error) {
    report.textContent = `${label}: ${(error as Error).message}`;
  }
  playing = true;
  toggle.textContent = 'Pause';
}

for (const name of names) {
  const option = document.createElement('option');
  option.value = option.textContent = name;
  select.append(option);
}

const open = async (picked: File | undefined) => {
  if (!picked) return;
  try {
    show(JSON.parse(await picked.text()), picked.name);
  } catch {
    report.textContent = `${picked.name} is not valid JSON`;
  }
};

select.addEventListener('change', async () => show(await load(select.value), select.value));
file.addEventListener('change', () => open(file.files?.[0]));
demo.addEventListener('dragover', (event) => {
  event.preventDefault();
  demo.classList.add('dragging');
});
demo.addEventListener('dragleave', () => demo.classList.remove('dragging'));
demo.addEventListener('drop', (event) => {
  event.preventDefault();
  demo.classList.remove('dragging');
  open(event.dataTransfer?.files[0]);
});
toggle.addEventListener('click', () => {
  playing = !playing;
  for (const target of [reference, player]) {
    if (playing) target?.play();
    else target?.pause();
  }
  toggle.textContent = playing ? 'Pause' : 'Play';
});
block.addEventListener('click', () => {
  block.disabled = true;
  requestAnimationFrame(() =>
    setTimeout(() => {
      const until = performance.now() + 2000;
      while (performance.now() < until) {
        /* a long task on the main thread */
      }
      block.disabled = false;
    }),
  );
});

const beat = $('beat');
const tick = (now: number) => {
  const track = beat.parentElement!.clientWidth - beat.clientWidth;
  const phase = (now / 1200) % 2;
  beat.style.transform = `translateX(${(phase < 1 ? phase : 2 - phase) * track}px)`;
  requestAnimationFrame(tick);
};
requestAnimationFrame(tick);

const initial = names.includes('group-animation') ? 'group-animation' : (names[0] ?? '');
select.value = initial;
show(await load(initial), initial);
const hero = compile(await load('modifiers')).animation;
createPlayer($('hero'), hero, { reducedMotion: 'respect' });
