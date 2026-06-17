import { describe, it, expect } from 'vitest';
import {
  KNOWN_PLUGINS,
  searchRegistry,
  categories,
  listByCategory,
  isRegistryEntryInstallable,
  resolveInstallSource,
} from '../src/plugins/registry.js';

describe('plugin registry discovery', () => {
  it('ships a meaningful curated catalog', () => {
    expect(KNOWN_PLUGINS.length).toBeGreaterThanOrEqual(10);
    // The bundled plugins are present and flagged.
    const bundled = KNOWN_PLUGINS.filter((e) => e.bundled).map((e) => e.name);
    expect(bundled).toEqual(expect.arrayContaining(['code-review', 'conventional-commits', 'ruflo-core']));
  });

  it('searches by name, tag, and category', () => {
    expect(searchRegistry('testing').some((e) => e.name === 'test-runner')).toBe(true); // category
    expect(searchRegistry('k8s').some((e) => e.name === 'k8s-ops')).toBe(true); // tag
    expect(searchRegistry('python').some((e) => e.name === 'python-pro')).toBe(true); // name
    expect(searchRegistry('definitely-no-such-plugin')).toEqual([]);
  });

  it('lists categories and entries within a category', () => {
    const cats = categories();
    expect(cats).toEqual(expect.arrayContaining(['infra', 'languages', 'review']));
    const infra = listByCategory('infra').map((e) => e.name);
    expect(infra).toEqual(expect.arrayContaining(['terraform-iac', 'k8s-ops']));
  });

  it('marks only packaged entries as one-click installable', () => {
    const names = KNOWN_PLUGINS.filter(isRegistryEntryInstallable).map((e) => e.name);
    expect(names).toEqual(expect.arrayContaining(['code-review', 'conventional-commits']));
    expect(names).not.toEqual(expect.arrayContaining(['terraform-iac', 'release-notes', 'ruflo-core']));
  });

  it('does not try to clone non-packaged discovery entries by name', () => {
    expect(() => resolveInstallSource('terraform-iac')).toThrow(/not packaged/);
    expect(() => resolveInstallSource('ruflo-core')).toThrow(/not packaged/);
  });
});
