declare const __EXTRA_FIXTURES__: string;

const bundled = import.meta.glob<string>('../fixtures/*.json', { query: '?raw', import: 'default' });

export const extraFixtures: string[] = __EXTRA_FIXTURES__.split(',').filter(Boolean);

export const fixtureNames: string[] = [
  ...Object.keys(bundled).map((path) => path.replace('../fixtures/', '').replace('.json', '')),
  ...extraFixtures,
];

export async function loadFixture(name: string): Promise<unknown> {
  if (name.startsWith('/')) {
    const response = await fetch(`/@fs${name}`);
    if (!response.ok) throw new Error(`Cannot load ${name}: ${response.status}`);
    return response.json();
  }
  const load = bundled[`../fixtures/${name}.json`];
  if (!load) throw new Error(`Unknown fixture ${name}`);
  return JSON.parse(await load());
}
