import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { Plugin } from 'vite';
import { compile } from '../compiler/index';

export interface LightieViteOptions {
  query?: string;
  failOnUnsupported?: boolean;
  sampleRate?: number;
}

export default function lightie(options: LightieViteOptions = {}): Plugin {
  const query = options.query ?? 'lightie';
  let serve = false;
  return {
    name: 'lightie',
    enforce: 'pre',
    configResolved(config) {
      serve = config.command === 'serve';
    },
    async load(id) {
      const [file, search] = id.split('?', 2);
      if (!file || search === undefined || !new URLSearchParams(search).has(query)) return null;
      this.addWatchFile(file);
      const text = await readFile(file, 'utf8');
      const { animation, report } = compile(text, { sampleRate: options.sampleRate, source: 'omit' });
      if (!report.supported) {
        const list = report.unsupported.map((u) => u.feature).join(', ');
        const message = `${basename(file)} uses features lightie cannot render natively: ${list}`;
        if (options.failOnUnsupported) this.error(message);
        this.warn(message);
        if (serve) animation.source = JSON.parse(text);
        else {
          const ref = this.emitFile({ type: 'asset', name: basename(file), source: text });
          return `const animation = ${JSON.stringify(animation)};\nanimation.source = import.meta.ROLLUP_FILE_URL_${ref};\nexport default animation;\n`;
        }
      }
      return `export default ${JSON.stringify(animation)};\n`;
    },
  };
}

export { lightie };
