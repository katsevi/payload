import { describe, expect, it } from 'vitest';
import es from '../locales/es.json';
import en from '../locales/en.json';
import { flatten } from '../i18n/flatten';

describe('i18n namespace ui', () => {
  const esKeys = Object.keys(flatten(es)).sort();
  const enKeys = Object.keys(flatten(en)).sort();

  it('es y en tienen exactamente las mismas claves', () => {
    expect(enKeys).toEqual(esKeys);
  });

  it('no hay textos vacíos', () => {
    for (const dict of [flatten(es), flatten(en)]) {
      for (const [k, v] of Object.entries(dict)) expect(v.trim(), k).not.toBe('');
    }
  });
});
