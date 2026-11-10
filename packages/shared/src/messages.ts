/**
 * Utilidades para mostrar MessageRef. El motor nunca devuelve texto final; estas funciones ayudan
 * a los tests, a los scripts y al servidor a convertir una MessageRef en texto sin i18next.
 *
 * Convención de parámetros: `system` lleva un `SystemId` y las plantillas lo muestran con
 * anidamiento de i18next, `$t(system.{{system}})`. Los nombres propios (`node`) van tal cual.
 * El cliente solo tiene que hacer `t(ref.key, { ns: 'sim', ...ref.params })`.
 */
import { simLocales } from './locales';
import type { Locale, MessageRef } from './types';

/** Busca una clave con puntos ("event.incident.fire") en el árbol de traducciones. */
export function lookupSimKey(key: string, locale: Locale): string | undefined {
  let node: unknown = simLocales[locale];
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : undefined;
}

/** Interpolación compatible con i18next ({{param}} y $t(clave)). Si la clave no existe devuelve la clave. */
export function formatMessage(message: MessageRef, locale: Locale): string {
  const template = lookupSimKey(message.key, locale);
  if (template === undefined) return message.key;
  const params = message.params ?? {};
  const interpolated = template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, name: string) =>
    name in params ? String(params[name]) : `{{${name}}}`,
  );
  return interpolated.replace(/\$t\(([^()]+)\)/g, (_m, key: string) => lookupSimKey(key, locale) ?? key);
}

/** Aplana un árbol de traducciones a claves con puntos (para tests de paridad). */
export function flattenKeys(tree: unknown, prefix = ''): string[] {
  if (tree === null || typeof tree !== 'object') return prefix ? [prefix] : [];
  return Object.entries(tree as Record<string, unknown>).flatMap(([k, v]) =>
    flattenKeys(v, prefix ? `${prefix}.${k}` : k),
  );
}
