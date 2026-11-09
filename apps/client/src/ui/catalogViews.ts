/**
 * Vistas puras del catálogo para la interfaz (sin React): escenarios de campaña y búsqueda en el glosario.
 * Todo se lee dinámicamente de `catalog`: añadir escenarios o términos no requiere tocar el cliente.
 */
import { catalog, type Catalog, type GlossaryEntry, type Locale, type ScenarioDef } from '@payload/shared';
import { academyScenarioId } from '../academy/academyLogic';

/** Escenarios de la campaña: todos los del catálogo menos el de la Academia, en el orden del JSON. */
export function campaignScenarios(cat: Catalog = catalog): ScenarioDef[] {
  const academy = academyScenarioId(cat);
  return cat.scenarios.filter((s) => s.id !== academy);
}

/** Minúsculas y sin tildes, para buscar "orbita" y encontrar "Órbita". */
export function normalizeSearch(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/**
 * Entradas del glosario que contienen la búsqueda en el término o la definición (idioma actual,
 * con el término en cualquier idioma como respaldo), ordenadas por término. Búsqueda vacía: todas.
 */
export function filterGlossary(query: string, locale: Locale, cat: Catalog = catalog): GlossaryEntry[] {
  const q = normalizeSearch(query);
  const entries = [...(cat.glossary ?? [])].sort((a, b) => a.term[locale].localeCompare(b.term[locale], locale));
  if (!q) return entries;
  return entries.filter((g) =>
    [g.term[locale], g.definition[locale], ...Object.values(g.term)].some((txt) => normalizeSearch(txt).includes(q)),
  );
}
