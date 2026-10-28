import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import lightie from '../src/vite/index';

const fixture = (name: string) => join(import.meta.dirname, '..', 'fixtures', `${name}.json`);

type Load = (this: unknown, id: string) => Promise<string | null>;

function setup(command: 'build' | 'serve', options = {}) {
  const plugin = lightie(options);
  (plugin.configResolved as (config: { command: string }) => void)({ command });
  const context = {
    addWatchFile: vi.fn(),
    warn: vi.fn(),
    error: vi.fn((message: string) => {
      throw new Error(message);
    }),
    emitFile: vi.fn(() => 'ref0'),
  };
  const load = (id: string) => (plugin.load as Load).call(context, id);
  return { context, load };
}

describe('vite plugin', () => {
  it('ignores ids without the query', async () => {
    const { load } = setup('build');
    expect(await load(fixture('dots-loader'))).toBeNull();
    expect(await load(`${fixture('dots-loader')}?raw`)).toBeNull();
  });

  it('compiles ?lightie imports into a module', async () => {
    const { load, context } = setup('build');
    const code = await load(`${fixture('dots-loader')}?lightie`);
    expect(code).toMatch(/^export default \{"lightie":1,/);
    expect(context.addWatchFile).toHaveBeenCalledWith(fixture('dots-loader'));
    expect(context.warn).not.toHaveBeenCalled();
  });

  it('emits the source as an asset for the fallback renderer when features are unsupported', async () => {
    const { load, context } = setup('build');
    const code = await load(`${fixture('unsupported')}?lightie`);
    expect(context.warn).toHaveBeenCalledWith(expect.stringContaining('expression'));
    expect(context.emitFile).toHaveBeenCalledWith(expect.objectContaining({ type: 'asset', name: 'unsupported.json' }));
    expect(code).toContain('animation.source = import.meta.ROLLUP_FILE_URL_ref0;');
  });

  it('embeds the source during dev and can fail the build instead', async () => {
    const dev = setup('serve');
    expect(await dev.load(`${fixture('unsupported')}?lightie`)).toContain('"source":{');
    const strict = setup('build', { failOnUnsupported: true });
    await expect(strict.load(`${fixture('unsupported')}?lightie`)).rejects.toThrow('expression');
  });
});
