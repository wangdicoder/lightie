import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';

interface Entry {
  name: string;
  code: string;
  budget: number;
}

const dist = join(process.cwd(), 'dist');
const ENTRIES: Entry[] = [
  { name: 'lightie (player)', code: `export { createPlayer } from '${dist}/index.js';`, budget: 3500 },
  { name: 'lightie/element', code: `import '${dist}/element.js';`, budget: 4500 },
  { name: 'lightie/react', code: `export { Lightie } from '${dist}/react.js';`, budget: 5000 },
  { name: 'lightie/compiler', code: `export { compile } from '${dist}/compiler.js';`, budget: 12000 },
];

const dir = join(process.cwd(), 'node_modules', '.cache', 'lightie-size');
mkdirSync(dir, { recursive: true });
const files = ENTRIES.map((entry, i) => {
  const file = join(dir, `entry-${i}.js`);
  writeFileSync(file, `${entry.code}\n`);
  return file;
});

const result = await build({
  entryPoints: files,
  bundle: true,
  minify: true,
  splitting: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  external: ['react', 'lottie-web'],
  outdir: join(dir, 'out'),
  write: false,
  metafile: true,
  logLevel: 'silent',
});

const outputs = result.metafile.outputs;
const texts = new Map(result.outputFiles.map((f) => [relative(process.cwd(), f.path), f.text]));
const closure = (output: string, seen = new Set<string>()): Set<string> => {
  if (seen.has(output)) return seen;
  seen.add(output);
  for (const imp of outputs[output]?.imports ?? []) {
    if (imp.kind === 'import-statement' && !imp.external) closure(imp.path, seen);
  }
  return seen;
};

let failed = false;
const rows = ENTRIES.map((entry, i) => {
  const source = relative(process.cwd(), files[i]!);
  const output = Object.keys(outputs).find((o) => outputs[o]?.entryPoint === source)!;
  const code = [...closure(output)].map((o) => texts.get(o) ?? '').join('\n');
  const gzip = gzipSync(code, { level: 9 }).length;
  const ok = gzip <= entry.budget;
  failed ||= !ok;
  return `${entry.name.padEnd(20)} ${String(code.length).padStart(7)} B min  ${String(gzip).padStart(6)} B gzip  budget ${entry.budget} B  ${ok ? 'ok' : 'OVER'}`;
});
process.stdout.write(`${rows.join('\n')}\n`);
if (failed) process.exitCode = 1;
