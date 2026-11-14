import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { INCIDENT_KINDS, SUPPLY_IDS, THROTTLE_IDS } from '@payload/shared';
import es from '../locales/es.json';
import en from '../locales/en.json';
import { flatten } from '../i18n/flatten';
import { SFX_META } from '../audio/soundLogic';
import { CREDITS } from '../data/credits';

const SRC = join(__dirname, '..');
const esFlat = flatten(es);
const enFlat = flatten(en);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('i18n de la interfaz (namespace ui)', () => {
  it('es y en tienen exactamente las mismas claves y ningún texto vacío', () => {
    expect(Object.keys(esFlat).sort()).toEqual(Object.keys(enFlat).sort());
    for (const [key, value] of [...Object.entries(esFlat), ...Object.entries(enFlat)]) expect(value.length, key).toBeGreaterThan(0);
  });

  it('cada clave usa los mismos {{params}} en ambos idiomas', () => {
    const params = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
    for (const key of Object.keys(esFlat)) expect(params(esFlat[key]!), key).toEqual(params(enFlat[key]!));
  });

  it('toda clave literal usada con t() en el código existe (las del motor llevan ns: sim)', () => {
    const missing: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const code = readFileSync(file, 'utf8');
      for (const m of code.matchAll(/\bt\(\s*'([\w.]+)'\s*([,)])([^)\n]*)/g)) {
        const key = m[1]!;
        if (m[3]?.includes("ns: 'sim'")) continue;
        if (!(key in esFlat)) missing.push(`${key} (${file.slice(SRC.length + 1)})`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('existen las claves que se construyen en tiempo de ejecución', () => {
    const dynamic = [
      ...INCIDENT_KINDS.map((k) => `prompt.fix.${k}`),
      ...THROTTLE_IDS.map((id) => `map.throttleHint.${id}`),
      ...[0, 1, 2, 3].map((n) => `map.riskLevel.${n}`),
      ...['online', 'off', 'shorted', 'broken', 'noPower'].map((s) => `power.state.${s}`),
      ...['engines', 'lifeSupport', 'shields', 'nav'].map((s) => `power.role.${s}`),
      ...['helm', 'map', 'power', 'airlock'].map((s) => `station.${s}`),
      ...['move', 'run', 'look', 'interact', 'click', 'repair', 'alt', 'jump', 'down', 'view', 'pause'].flatMap((k) => [`keys.${k}`, `help.${k}`]),
      ...['fire', 'leak', 'short', 'impact', 'power', 'landing', 'o2', 'terrain', 'storm', 'tools'].map((k) => `help.tips.${k}`),
      ...CREDITS.flatMap((c) => [`credits.${c.id}`, c.modifiedKey]),
      ...Object.values(SFX_META).flatMap((m) => (m.captionKey ? [m.captionKey] : [])),
      'prompt.repair', 'prompt.repairNoSpares', 'prompt.evade', 'prompt.helm', 'prompt.throttle', 'prompt.map', 'prompt.power',
      // Superficie (fase 2): los construyen `promptFor` y `surfacePromptFor`.
      'prompt.land', 'prompt.landNoFuel', 'prompt.takeOff', 'prompt.takeOffHeavy', 'prompt.takeOffNoFuel', 'prompt.jettison',
      'prompt.airlockExit', 'prompt.airlockSealed', 'prompt.full', 'prompt.enter', 'prompt.enterCargo',
      // Herramientas de minería y minijuegos (parte 2).
      'prompt.deployTool', 'prompt.noToolLeft', 'prompt.toolAirborne', 'prompt.toolsLeft', 'prompt.collectReady', 'prompt.collectAirborne',
      'prompt.toolPickUp', 'prompt.toolStorm', 'prompt.toolWorking', 'prompt.retrieveTool', 'prompt.toolsOut', 'prompt.readyOut',
      ...['simpleDodge', 'simpleRepairs', 'wideAim'].map((k) => `settings.${k}`),
      'prompt.evadeDodge', 'prompt.dodging', 'prompt.grazes', 'prompt.hits', 'keys.move',
      ...['fire', 'short', 'leak'].map((k) => `prompt.fix.${k}`),
      // Terminal de estación (fase 3): suministros, unidades y estilos de la línea de efecto.
      ...SUPPLY_IDS.map((id) => `shop.supply.${id}`),
      ...['kg', 'm', 'mps', 'kw'].map((u) => `shop.unit.${u}`),
      'shop.abs', 'shop.pct', 'shop.rel', 'shop.kw', 'prompt.terminal', 'prompt.credits',
    ];
    for (const key of dynamic) expect(key in esFlat, key).toBe(true);
  });

  it('poca letra: ningún texto de la interfaz de juego pasa de 110 caracteres', () => {
    for (const flat of [esFlat, enFlat]) {
      for (const [key, value] of Object.entries(flat)) {
        // Fase 4: el hangar, las tarjetas de misión, el glosario y el menú también son de una línea.
        if (/^(hud|prompt|map|power|end|pause|station|marker|help|descent|sound|shop|design|missions|glossary|menu)\./.test(key)) expect(value.length, key).toBeLessThanOrEqual(110);
      }
    }
  });
});
