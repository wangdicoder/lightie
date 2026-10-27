import { createPlayer, type Player } from 'lightie';
import { compile } from 'lightie/compiler';
import { lottieWebFallback } from 'lightie/fallback/lottie-web';
import lottie, { type AnimationItem } from 'lottie-web';
import { fixtureNames, loadFixture } from './fixtures';

const select = document.getElementById('fixture') as HTMLSelectElement;
const file = document.getElementById('file') as HTMLInputElement;
const toggle = document.getElementById('toggle') as HTMLButtonElement;
const block = document.getElementById('block') as HTMLButtonElement;
const refEl = document.getElementById('ref') as HTMLDivElement;
const outEl = document.getElementById('out') as HTMLDivElement;
const report = document.getElementById('report') as HTMLPreElement;

let reference: AnimationItem | undefined;
let player: Player | undefined;
let playing = true;

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;

function show(data: unknown, label: string) {
  reference?.destroy();
  player?.destroy();
  reference = lottie.loadAnimation({
    container: refEl,
    renderer: 'svg',
    loop: true,
    autoplay: true,
    animationData: structuredClone(data),
  });
  const started = performance.now();
  const { animation, report: result } = compile(data, { source: 'embed' });
  const compileMs = performance.now() - started;
  player = createPlayer(outEl, animation, { reducedMotion: 'ignore', fallback: lottieWebFallback });
  playing = true;
  toggle.textContent = 'Pause';
  const sourceBytes = JSON.stringify(data).length;
  const { source: _source, ...withoutSource } = animation;
  const lines = [
    `${label}`,
    `renderer: ${player.usingFallback ? 'lottie-web fallback (unsupported features below)' : 'native WAAPI'}`,
    `compiled in ${compileMs.toFixed(1)} ms · source ${kb(sourceBytes)} → compiled ${kb(JSON.stringify(withoutSource).length)}`,
    `tracks: ${result.tracks.composited} composited · ${result.tracks.paint} paint · ${result.tracks.baked} baked`,
    ...result.unsupported.map((u) => `unsupported: ${u.feature} (${u.where.join('; ')})`),
  ];
  report.textContent = lines.join('\n');
}

for (const name of fixtureNames) {
  const option = document.createElement('option');
  option.value = name;
  option.textContent = name.split('/').pop() ?? name;
  select.append(option);
}

select.addEventListener('change', async () => show(await loadFixture(select.value), select.value));
file.addEventListener('change', async () => {
  const picked = file.files?.[0];
  if (picked) show(JSON.parse(await picked.text()), picked.name);
});
toggle.addEventListener('click', () => {
  playing = !playing;
  if (playing) {
    reference?.play();
    player?.play();
  } else {
    reference?.pause();
    player?.pause();
  }
  toggle.textContent = playing ? 'Pause' : 'Play';
});
block.addEventListener('click', () => {
  const until = performance.now() + 1500;
  while (performance.now() < until) {
    /* simulate a long task on the main thread */
  }
});

const initial = fixtureNames.includes('group-animation') ? 'group-animation' : (fixtureNames[0] ?? '');
select.value = initial;
show(await loadFixture(initial), initial);
