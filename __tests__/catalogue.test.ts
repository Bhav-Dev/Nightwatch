import catalogue from '../catalogue/catalogue.json';
import { bundledCatalogue, DEFAULT_FACTOR_CHIPS, DEFAULT_REMEDY_CHIPS } from '../src/domain/catalogue';

describe('bundled catalogue', () => {
  it('has the 42 launch entries: 16 devices, 11 habits, 15 factors', () => {
    expect(bundledCatalogue).toHaveLength(42);
    const count = (kind: string) => bundledCatalogue.filter((i) => i.kind === kind).length;
    expect(count('device')).toBe(16);
    expect(count('habit')).toBe(11);
    expect(count('factor')).toBe(15);
  });

  it('has unique ids', () => {
    const ids = bundledCatalogue.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every remedy an article and only products a shop flag', () => {
    for (const item of bundledCatalogue.filter((i) => i.type === 'remedy')) {
      expect(item.article_md.length).toBeGreaterThan(50);
      if (item.kind === 'habit') expect(item.shop).toBe(false);
    }
    expect(bundledCatalogue.find((i) => i.id === 'cpap')?.shop).toBe(false);
  });

  it('only gives alcohol a value band', () => {
    const banded = bundledCatalogue.filter((i) => i.value_options);
    expect(banded.map((i) => i.id)).toEqual(['alcohol']);
    expect(banded[0].value_options).toEqual(['1-2', '3-4', '5+']);
  });

  it('default chips exist in the catalogue', () => {
    const ids = new Set(catalogue.items.map((i) => i.id));
    for (const id of [...DEFAULT_REMEDY_CHIPS, ...DEFAULT_FACTOR_CHIPS]) expect(ids.has(id)).toBe(true);
  });

  it('article copy makes no diagnostic claims', () => {
    const banned = /\b(diagnos(e|es|is)|cure[sd]?|detects? (sleep )?apnoea)\b/i;
    for (const item of bundledCatalogue) expect(item.article_md).not.toMatch(banned);
  });
});
