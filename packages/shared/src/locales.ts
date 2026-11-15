// Traducciones de los mensajes del motor (namespace i18n `sim`).
//
// Además de locales/{es,en}.json, se añade al importar un subárbol `catalog.<id>` con el nombre
// localizado de cada nave, tipo de destino, mundo, material, herramienta y mejora, generado desde el catálogo (el contenido no se
// duplica en los JSON) y un subárbol `guided.<missionId>.<paso>` con los textos en vuelo de las misiones guiadas.
// Las plantillas anidan nombres con i18next:
//   "¡Fuego en $t(system.{{system}})!"   con params { system: 'reactor' }
// i18next interpola primero ({{system}} → id) y luego resuelve $t(system.<id>) → nombre.
import es from '../locales/es.json';
import en from '../locales/en.json';
import { catalog } from './catalog';
import type { Locale } from './types';

function catalogNames(locale: Locale): Record<string, string> {
  const names: Record<string, string> = {};
  const surface = catalog.surface;
  for (const entry of [...catalog.ships, ...catalog.nodeKinds, ...(surface?.worlds ?? []), ...(surface?.materials ?? []), ...(surface?.tools ?? []), ...(catalog.upgrades ?? []), ...(catalog.roles ?? [])]) names[entry.id] = entry.name[locale];
  // Fase 4: misiones, módulos, instrumentos, lanzadores, zonas y cuerpos del sistema solar.
  const solar = catalog.solarSystem;
  for (const entry of [
    ...(catalog.missions ?? []), ...(catalog.modules ?? []), ...(catalog.instruments ?? []), ...(catalog.launchers ?? []),
    ...(solar?.zones ?? []), ...(solar?.bodies ?? []), ...(catalog.design?.difficulties ?? []),
  ]) names[entry.id] = entry.name[locale];
  return names;
}

/**
 * Textos en vuelo de las misiones guiadas (`guided.flightSteps`): `guided.<missionId>.<paso>.text` y `.hint`. Los usa
 * `currentObjective` como `MessageRef` (con los mismos params que el paso genérico).
 */
function guidedFlightTexts(locale: Locale): Record<string, Record<string, { text: string; hint?: string }>> {
  const out: Record<string, Record<string, { text: string; hint?: string }>> = {};
  for (const m of catalog.missions ?? []) {
    const steps = m.guided?.flightSteps;
    if (!steps) continue;
    out[m.id] = Object.fromEntries(steps.map((s) => [s.check, { text: s.text[locale], ...(s.hint ? { hint: s.hint[locale] } : {}) }]));
  }
  return out;
}

export const simLocales: Record<Locale, Record<string, unknown>> = {
  es: { ...es, catalog: catalogNames('es'), guided: guidedFlightTexts('es') },
  en: { ...en, catalog: catalogNames('en'), guided: guidedFlightTexts('en') },
};
