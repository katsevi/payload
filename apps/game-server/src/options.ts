/**
 * Opciones de creación de la sala `mission` (`client.create` / `client.joinOrCreate`). Puro: sin
 * Colyseus, para poder probarlo aparte. El adaptador (MissionRoom) traduce los errores a `ServerError`.
 *
 *   scenarioId  obligatorio: un escenario del catálogo que NO sea el de la Academia (la Academia es solitario).
 *   private     opcional: sala privada (no aparece en el emparejamiento; se entra con el código = roomId).
 *   attempt     opcional, SOLO desarrollo y tests: intento inicial (entero ≥ 0). Como la semilla es
 *               defaultSeed + intento, elegir el intento es elegir la semilla: sin permiso se ignora (intento 0).
 *   seed        opcional, SOLO desarrollo y tests: fija la semilla del intento inicial; cada `redesign` suma 1.
 *               Sin permiso se ignora.
 *   name        lo lee `onJoin` (nombre del jugador), no la creación.
 * Permiso de desarrollo (`seedOptionAllowed`): `PAYLOAD_ALLOW_SEED=1` o `NODE_ENV=test`.
 */
import { catalog as defaultCatalog, type Catalog } from '@payload/shared';

export interface MissionCreateOptions {
  scenarioId: string;
  private: boolean;
  attempt: number;
  /** Semilla fija del intento inicial (solo desarrollo/tests); null = defaultSeed + intento. */
  seed: number | null;
}

/** Códigos estables de error de creación (el cliente los muestra con sus propias claves `ui`). */
export type CreateOptionsErrorCode = 'invalid-scenario' | 'academy-scenario' | 'invalid-attempt' | 'invalid-seed';

export class CreateOptionsError extends Error {
  constructor(readonly code: CreateOptionsErrorCode) {
    super(code);
    this.name = 'CreateOptionsError';
  }
}

/** Intento máximo aceptado (protege la semilla de valores absurdos). */
export const MAX_ATTEMPT = 1_000_000;
/** Semillas válidas: enteros de 32 bits sin signo (lo que usa `createRng`). */
export const MAX_SEED = 0xffff_ffff;

/** Escenario de la Academia (solo solitario): el de `catalog.academy` o el de respaldo del cliente. */
export function academyScenarioId(cat: Catalog = defaultCatalog): string {
  return cat.academy?.scenarioId ?? 'academy-cubesat-leo';
}

/** ¿Se permiten las opciones de desarrollo `seed` y `attempt` (eligen la semilla)? Desarrollo y tests. */
export function seedOptionAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PAYLOAD_ALLOW_SEED === '1' || env.NODE_ENV === 'test';
}

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/**
 * Valida las opciones de creación. Lanza `CreateOptionsError` con un código estable. `allowDevOptions`
 * (= `seedOptionAllowed()`) habilita `attempt` y `seed`; sin él se ignoran (intento 0, semilla del escenario).
 */
export function parseCreateOptions(raw: unknown, allowDevOptions: boolean, cat: Catalog = defaultCatalog): MissionCreateOptions {
  const o = isObject(raw) ? raw : {};
  const scenarioId = o.scenarioId;
  if (typeof scenarioId !== 'string' || !cat.scenarios.some((s) => s.id === scenarioId)) {
    throw new CreateOptionsError('invalid-scenario');
  }
  if (scenarioId === academyScenarioId(cat)) throw new CreateOptionsError('academy-scenario');

  let attempt = 0;
  if (o.attempt !== undefined && allowDevOptions) {
    if (typeof o.attempt !== 'number' || !Number.isInteger(o.attempt) || o.attempt < 0 || o.attempt > MAX_ATTEMPT) {
      throw new CreateOptionsError('invalid-attempt');
    }
    attempt = o.attempt;
  }

  let seed: number | null = null;
  if (o.seed !== undefined && allowDevOptions) {
    if (typeof o.seed !== 'number' || !Number.isInteger(o.seed) || o.seed < 0 || o.seed > MAX_SEED) {
      throw new CreateOptionsError('invalid-seed');
    }
    seed = o.seed;
  }

  return { scenarioId, private: o.private === true, attempt, seed };
}
