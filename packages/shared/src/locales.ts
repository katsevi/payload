// Traducciones de los mensajes del motor (namespace i18n `sim`).
//
// Además de locales/{es,en}.json, se añade al importar un subárbol `catalog.<id>` con el nombre
// localizado de cada componente, órbita y lanzador, generado desde el catálogo (el contenido no
// se duplica en los JSON). Las plantillas usan anidamiento de i18next para mostrar nombres:
//   "$t(catalog.{{component}}) consume {{powerW}} W"   con params { component: 'payload-thermal-camera' }
// i18next interpola primero ({{component}} → id) y luego resuelve $t(catalog.<id>) → nombre.
import es from '../locales/es.json';
import en from '../locales/en.json';
import { catalog } from './catalog';
import type { Locale } from './types';

function catalogNames(locale: Locale): Record<string, string> {
  const names: Record<string, string> = {};
  for (const entry of [...catalog.components, ...catalog.orbits, ...catalog.launchers]) names[entry.id] = entry.name[locale];
  return names;
}

export const simLocales: Record<Locale, Record<string, unknown>> = {
  es: { ...es, catalog: catalogNames('es') },
  en: { ...en, catalog: catalogNames('en') },
};
