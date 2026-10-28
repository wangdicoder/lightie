import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const built = new URL('../dist/compiler.js', import.meta.url).href;
const { compile } = (await import(built).catch(() => {
  process.stderr.write('Run `pnpm build` first: this script uses the built compiler in dist/.\n');
  process.exit(1);
})) as typeof import('../src/compiler/index');

const root = resolve(process.argv[2] ?? '');
if (!process.argv[2]) {
  process.stderr.write('Usage: node scripts/corpus.ts <directory with Lottie JSON files>\n');
  process.exit(1);
}

const files: string[] = [];
const collect = (dir: string) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) collect(path);
    else if (name.endsWith('.json')) files.push(path);
  }
};
collect(root);
files.sort();

interface Result {
  file: string;
  status: 'native' | 'fallback' | 'error' | 'skipped';
  features: string[];
  externalImages: boolean;
  error?: string;
}

const results: Result[] = files.map((file) => {
  let data: { layers?: unknown[]; assets?: { p?: string; e?: number; u?: string }[] };
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return { file, status: 'skipped', features: [], externalImages: false, error: 'not JSON' };
  }
  if (!Array.isArray(data.layers))
    return { file, status: 'skipped', features: [], externalImages: false, error: 'not Lottie' };
  const externalImages = (data.assets ?? []).some(
    (a) => typeof a.p === 'string' && !a.p.startsWith('data:') && !('layers' in a),
  );
  try {
    const { report } = compile(data);
    const features = report.unsupported.map((u) => u.feature);
    return { file, status: features.length ? 'fallback' : 'native', features, externalImages };
  } catch (error) {
    return {
      file,
      status: 'error',
      features: [],
      externalImages,
      error: String((error as Error).stack ?? error)
        .split('\n')
        .slice(0, 3)
        .join(' | '),
    };
  }
});

const lottie = results.filter((r) => r.status !== 'skipped');
const count = (status: Result['status']) => lottie.filter((r) => r.status === status).length;
const features = new Map<string, number>();
for (const r of lottie) for (const f of new Set(r.features)) features.set(f, (features.get(f) ?? 0) + 1);
const ranked = [...features].sort((a, b) => b[1] - a[1]);
const onlyBlocker = new Map<string, number>();
for (const r of lottie)
  if (new Set(r.features).size === 1) onlyBlocker.set(r.features[0]!, (onlyBlocker.get(r.features[0]!) ?? 0) + 1);
const pct = (n: number) => `${((n / Math.max(1, lottie.length)) * 100).toFixed(1)}%`;

const lines = [
  `Corpus: ${root} (${lottie.length} Lottie files, ${results.length - lottie.length} skipped)`,
  '',
  `| result | files | share |`,
  `|---|---|---|`,
  `| native (no fallback) | ${count('native')} | ${pct(count('native'))} |`,
  `| needs fallback | ${count('fallback')} | ${pct(count('fallback'))} |`,
  `| compiler error | ${count('error')} | ${pct(count('error'))} |`,
  '',
  '| feature needing fallback | files | files where it is the only blocker |',
  '|---|---|---|',
  ...ranked.map(([f, n]) => `| ${f} | ${n} | ${onlyBlocker.get(f) ?? 0} |`),
  '',
  ...lottie.filter((r) => r.status === 'error').map((r) => `- error: ${relative(root, r.file)}: ${r.error}`),
];
mkdirSync(join('bench', 'results'), { recursive: true });
writeFileSync(join('bench', 'results', 'corpus.md'), `${lines.join('\n')}\n`);
writeFileSync(join('bench', 'results', 'corpus.json'), JSON.stringify(results, null, 2));
writeFileSync(
  join('bench', 'results', 'corpus-native.txt'),
  lottie
    .filter((r) => r.status === 'native' && !r.externalImages)
    .map((r) => r.file)
    .join(','),
);
process.stdout.write(`${lines.join('\n')}\n`);
