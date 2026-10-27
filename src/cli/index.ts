import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { parseArgs } from 'node:util';
import { type CompileReport, compile } from '../compiler/index';

const USAGE = `Usage:
  lightie compile <input.json> [-o <output.json>] [--embed-source] [--pretty]
  lightie check <input.json...>

compile  Compile a Lottie JSON file into a lightie animation.
check    Report which Lottie features each file uses that lightie cannot render natively.
         Exits with code 1 when any file needs the fallback renderer.`;

function describe(file: string, report: CompileReport): string {
  const { composited, paint, baked } = report.tracks;
  const head = `${report.supported ? 'ok  ' : 'FALLBACK'} ${file}  (composited ${composited}, paint ${paint}, baked ${baked})`;
  const lines = report.unsupported.map(
    (u) =>
      `    - ${u.feature}: ${u.where.slice(0, 3).join('; ')}${u.where.length > 3 ? ` (+${u.where.length - 3})` : ''}`,
  );
  return [head, ...lines].join('\n');
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      output: { type: 'string', short: 'o' },
      'embed-source': { type: 'boolean', default: false },
      pretty: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (values.help || !command || command === 'help' || !positionals.length) {
    process.stdout.write(`${USAGE}\n`);
    return values.help || command === 'help' ? 0 : 2;
  }
  if (command === 'compile') {
    const input = positionals[0]!;
    const { animation, report } = compile(await readFile(input, 'utf8'), {
      source: values['embed-source'] ? 'embed' : 'omit',
    });
    const json = JSON.stringify(animation, null, values.pretty ? 2 : undefined);
    if (values.output) await writeFile(values.output, json);
    else process.stdout.write(`${json}\n`);
    process.stderr.write(`${describe(basename(input), report)}\n`);
    return 0;
  }
  if (command === 'check') {
    let failed = false;
    for (const input of positionals) {
      const { report } = compile(await readFile(input, 'utf8'));
      failed ||= !report.supported;
      process.stdout.write(`${describe(input, report)}\n`);
    }
    return failed ? 1 : 0;
  }
  process.stderr.write(`Unknown command: ${command}\n${USAGE}\n`);
  return 2;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  },
);
