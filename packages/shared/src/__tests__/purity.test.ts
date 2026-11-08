import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..');
// Solo los módulos del motor (src/*.ts); los tests de __tests__ pueden usar Node.
const files = readdirSync(SRC).filter((f) => f.endsWith('.ts'));
/** Quita comentarios para no dar falsos positivos con la documentación. */
const code = (f: string) =>
  readFileSync(join(SRC, f), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('pureza del motor (src/)', () => {
  it.each(files)('%s no usa relojes ni azar global', (f) => {
    const c = code(f);
    expect(c).not.toMatch(/Math\.random\s*\(/);
    expect(c).not.toMatch(/Date\.now\s*\(/);
    expect(c).not.toMatch(/new\s+Date\s*\(/);
    expect(c).not.toMatch(/performance\.now\s*\(/);
    expect(c).not.toMatch(/\b(setTimeout|setInterval|setImmediate|queueMicrotask)\s*\(/);
  });
  it.each(files)('%s no usa Node, React, Three ni DOM', (f) => {
    const c = code(f);
    expect(c).not.toMatch(/from\s+['"](node:|fs|path|os|crypto|url|react|three|@react-three)/);
    expect(c).not.toMatch(/\brequire\s*\(/);
    expect(c).not.toMatch(/\bprocess\./);
    expect(c).not.toMatch(/\bBuffer\b/);
    expect(c).not.toMatch(/\b(__dirname|__filename|global)\b/);
    expect(c).not.toMatch(/\b(window|document|localStorage|navigator)\./);
  });
});
