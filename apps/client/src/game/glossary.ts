/**
 * Glosario OPCIONAL de la fase 4 (regla 6: nunca lectura obligatoria): una línea por término, en el hangar y en el
 * mapa, con la tecla G o «?». Nunca se abre solo ni bloquea. Textos en `glossary.<id>.term` / `glossary.<id>.line`.
 */
export const GLOSSARY_TERMS = [
  'au', 'solar', 'rtg', 'goNoGo', 'slot', 'launcher', 'dryMass', 'structure', 'chemical', 'ion', 'reliability', 'range', 'science', 'radiation',
] as const;
export type GlossaryTerm = (typeof GLOSSARY_TERMS)[number];

/** ¿Esta tecla abre o cierra el glosario? (G o «?»; nunca con modificadores de sistema). */
export function isGlossaryKey(e: { code: string; key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; repeat?: boolean }): boolean {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return false;
  return e.code === 'KeyG' || e.key === '?';
}
