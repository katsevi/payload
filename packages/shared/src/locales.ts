// Traducciones de los mensajes del motor (namespace i18n `sim`).
//
// Además de locales/{es,en}.json, se añade al importar un subárbol `catalog.<id>` con el nombre
// localizado de cada nave, tipo de destino, mundo, material y herramienta, generado desde el catálogo (el contenido no se
// duplica en los JSON). Las plantillas anidan nombres con i18next:
//   "¡Fuego en $t(system.{{system}})!"   con params { system: 'reactor' }
// i18next interpola primero ({{system}} → id) y luego resuelve $t(system.<id>) → nombre.
import es from '../locales/es.json';
import en from '../locales/en.json';
import { catalog } from './catalog';
import type { Locale } from './types';

function catalogNames(locale: Locale): Record<string, string> {
  const names: Record<string, string> = {};
  const surface = catalog.surface;
  for (const entry of [...catalog.ships, ...catalog.nodeKinds, ...(surface?.worlds ?? []), ...(surface?.materials ?? []), ...(surface?.tools ?? [])]) names[entry.id] = entry.name[locale];
  return names;
}

export const simLocales: Record<Locale, Record<string, unknown>> = {
  es: { ...es, catalog: catalogNames('es') },
  en: { ...en, catalog: catalogNames('en') },
};
