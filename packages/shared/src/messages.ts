/**
 * Utilidades para mostrar MessageRef. El motor nunca devuelve texto final; estas funciones
 * ayudan al prototipo, a los tests y al servidor a convertir una MessageRef en texto.
 *
 * Convención de parámetros: `component`, `structure`, `launcher` y `orbit` llevan el **id** del
 * catálogo. Las plantillas de locales/{es,en}.json los muestran con anidamiento de i18next,
 * `$t(catalog.{{component}})`, y `simLocales` incluye el subárbol `catalog.<id>` con los nombres
 * localizados. Así el cliente solo tiene que hacer `t(ref.key, { ns: 'sim', ...ref.params })`.
 *
 * `formatMessage` reproduce ese comportamiento sin i18next. `resolveMessageParams` devuelve los
 * params con los nombres ya resueltos para usos fuera de las plantillas (p. ej. etiquetas propias);
 * NO lo pases a t(), porque las plantillas esperan ids.
 */
import { catalog } from './catalog';
import { simLocales } from './locales';
import type { Catalog, Locale, MessageRef } from './types';

/** Parámetros de MessageRef que contienen ids del catálogo. */
export const CATALOG_ID_PARAMS = ['component', 'structure', 'launcher', 'orbit'] as const;

function catalogName(id: string, locale: Locale, cat: Catalog): string | undefined {
  const entry = cat.components.find((c) => c.id === id) ?? cat.launchers.find((l) => l.id === id) ?? cat.orbits.find((o) => o.id === id);
  return entry?.name[locale];
}

/** Devuelve los parámetros con los ids del catálogo sustituidos por su nombre localizado. */
export function resolveMessageParams(
  message: MessageRef,
  locale: Locale,
  cat: Catalog = catalog,
): Record<string, string | number> {
  const out: Record<string, string | number> = { ...(message.params ?? {}) };
  for (const p of CATALOG_ID_PARAMS) {
    const v = out[p];
    if (typeof v !== 'string') continue;
    const name = catalogName(v, locale, cat);
    if (name !== undefined) out[p] = name;
  }
  return out;
}

/** Busca una clave con puntos ("budget.mass.launcher") en el árbol de traducciones. */
export function lookupSimKey(key: string, locale: Locale): string | undefined {
  let node: unknown = simLocales[locale];
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : undefined;
}

/** Interpolación compatible con i18next ({{param}}). Si la clave no existe devuelve la clave. */
export function formatMessage(message: MessageRef, locale: Locale, cat: Catalog = catalog): string {
  const template = lookupSimKey(message.key, locale);
  if (template === undefined) return message.key;
  const params = message.params ?? {};
  // 1) Interpolación {{param}} con los valores crudos (ids incluidos), como i18next.
  const interpolated = template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, name: string) =>
    name in params ? String(params[name]) : `{{${name}}}`,
  );
  // 2) Anidamiento $t(clave): resuelve p. ej. $t(catalog.payload-thermal-camera) → nombre.
  //    Los nombres del catálogo salen de `cat` (por si se usa un catálogo distinto del de serie).
  return interpolated.replace(/\$t\(([^()]+)\)/g, (_m, key: string) => {
    if (key.startsWith('catalog.')) {
      const name = catalogName(key.slice('catalog.'.length), locale, cat);
      if (name !== undefined) return name;
    }
    return lookupSimKey(key, locale) ?? key;
  });
}

/** Aplana un árbol de traducciones a claves con puntos (para tests de paridad). */
export function flattenKeys(tree: unknown, prefix = ''): string[] {
  if (tree === null || typeof tree !== 'object') return prefix ? [prefix] : [];
  return Object.entries(tree as Record<string, unknown>).flatMap(([k, v]) =>
    flattenKeys(v, prefix ? `${prefix}.${k}` : k),
  );
}
