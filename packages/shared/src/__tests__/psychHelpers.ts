/** Ayudas de los tests de la cordura (fase 8): catálogo con `psych.enabled` y ajustes. */
import { catalog, parseCatalog, type Catalog, type Run } from '../index';

/** Catálogo del juego con la cordura activa; `patch` modifica la copia antes de validarla. */
export function psychCatalog(patch?: (raw: Catalog) => void): Catalog {
  const raw = JSON.parse(JSON.stringify(catalog)) as Catalog;
  raw.psych = { ...(JSON.parse(JSON.stringify(catalog.psych)) as NonNullable<Catalog['psych']>), enabled: true }; // copia profunda: los tests la modifican
  patch?.(raw);
  return parseCatalog(raw);
}

/** Sin averías, impactos ni desgaste: aísla la mecánica de cordura. */
export function calmPsychCatalog(patch?: (raw: Catalog) => void): Catalog {
  return psychCatalog((raw) => {
    for (const k of raw.nodeKinds) {
      k.hazardPerLy = { impact: 0, short: 0, fire: 0, leak: 0 };
      delete k.cache;
    }
    raw.hazards.wear.chancePerS = 0;
    patch?.(raw);
  });
}

export function stepSeconds(run: Run, seconds: number, dt = 0.1): void {
  for (let t = 0; t < seconds - 1e-9; t += dt) run.step(dt);
}

/** Catálogo con la cordura apagada explícitamente (el por defecto puede traerla activa). */
export function psychOffCatalog(): Catalog {
  const raw = JSON.parse(JSON.stringify(catalog)) as Catalog;
  raw.psych = { ...raw.psych!, enabled: false };
  return parseCatalog(raw);
}
