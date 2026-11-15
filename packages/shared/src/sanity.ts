/**
 * Cordura de la tripulación (fase 8, `docs/diseno/cordura-tripulacion.md`). Funciones PURAS: la partida
 * (`run.ts`) las usa para el drenaje, las bandas y los debuffs, y el cliente las llama para pintar lo mismo que cobra
 * el motor. Todo es opcional: sin `catalog.psych` o con `enabled: false`, `getPsychRules` devuelve null y nada cambia.
 *
 * La cordura nunca mata ni pierde la partida: solo frena el trabajo, empeora la esquiva y provoca lapsus pequeños.
 */
import { getModules } from './design';
import { boughtEffects } from './economy';
import { createRng, deriveSeed } from './rng';
import type { Catalog, CrewMember, MissionDesign, PsychRules, RunState, SanityBand, ScienceRules, UpgradeEffect } from './types';
import { contactWindow } from './science';

/** Sal del flujo de los lapsus (no toca `wearRng` ni ningún otro flujo). */
export const PSYCH_SALT = 0x5a71;

const BANDS: readonly SanityBand[] = ['stable', 'tense', 'critical', 'breakdown'];

/** Reglas de cordura del catálogo, o null si no hay o están apagadas. */
export function getPsychRules(cat: Catalog): PsychRules | null {
  return cat.psych?.enabled ? cat.psych : null;
}

function applyEffect(value: number, e: UpgradeEffect): number {
  return value * (e.mult ?? 1) + (e.add ?? 0);
}

/**
 * Reglas con las mejoras `crew` compradas y los módulos del diseño (efectos `target: 'crew'`). Pura: no muta `base`.
 * `sanityDrainMult` se acumula en `drainMult` (1 por defecto); el resto ajusta el campo que nombra.
 */
export function effectivePsychRules(base: PsychRules, upgrades: Record<string, number>, cat: Catalog, design?: MissionDesign): PsychRules {
  const r: PsychRules = {
    ...base,
    rest: { ...base.rest }, call: { ...base.call }, station: { ...base.station }, drainMult: base.drainMult ?? 1,
  };
  const effects: UpgradeEffect[] = [];
  if (design) {
    for (const id of design.moduleIds) {
      const m = getModules(cat).find((x) => x.id === id);
      if (m) for (const e of m.effects) if (e.target === 'crew') effects.push(e);
    }
  }
  effects.push(...boughtEffects(upgrades, cat, 'crew'));
  for (const e of effects) {
    switch (e.field) {
      case 'sanityDrainMult': r.drainMult = Math.max(0, applyEffect(r.drainMult ?? 1, e)); break;
      case 'restRecoverPctPerS': r.rest.recoverPctPerS = Math.max(0, applyEffect(r.rest.recoverPctPerS, e)); break;
      case 'callRecoverPct': r.call.recoverPct = Math.max(0, applyEffect(r.call.recoverPct, e)); break;
      case 'callCooldownS': r.call.cooldownS = Math.max(0, applyEffect(r.call.cooldownS, e)); break;
      case 'sleepPenalty': r.sleepPenalty = Math.max(0, applyEffect(r.sleepPenalty, e)); break;
      case 'monotonyMax': r.monotonyMax = Math.max(0, applyEffect(r.monotonyMax, e)); break;
      case 'stationRecoverCapPct': r.station.capPct = Math.max(0, applyEffect(r.station.capPct, e)); break;
      default: break;
    }
  }
  return r;
}

/** Valor de cada campo `UPGRADE_FIELDS.crew` en unas reglas (para previsualizar el efecto de una mejora, como `effectiveSurfaceRules` con el traje). */
export function crewFieldValues(r: PsychRules): Record<string, number> {
  return {
    sanityDrainMult: r.drainMult ?? 1, restRecoverPctPerS: r.rest.recoverPctPerS, callRecoverPct: r.call.recoverPct, callCooldownS: r.call.cooldownS,
    sleepPenalty: r.sleepPenalty, monotonyMax: r.monotonyMax, stationRecoverCapPct: r.station.capPct,
  };
}

export function bandIndex(b: SanityBand): 0 | 1 | 2 | 3 {
  return BANDS.indexOf(b) as 0 | 1 | 2 | 3;
}

/**
 * Banda con histéresis: se baja al cruzar el umbral y se sube solo al superarlo en `hysteresisPct`.
 * (64.9 → tensa; 69.9 sigue tensa; 70 → estable con los umbrales por defecto.)
 */
export function sanityBandFor(pct: number, prev: SanityBand, r: PsychRules): SanityBand {
  const b = r.bands;
  const entering = pct < b.breakdown ? 3 : pct < b.critical ? 2 : pct < b.tense ? 1 : 0;
  let idx: number = bandIndex(prev);
  if (entering > idx) return BANDS[entering]!;
  const exit = [Infinity, b.tense + b.hysteresisPct, b.critical + b.hysteresisPct, b.breakdown + b.hysteresisPct];
  while (idx > 0 && pct >= exit[idx]! - 1e-9) idx--;
  return BANDS[idx]!;
}

export interface SanityDebuffs {
  work: number;
  evadeDamage: number;
  suitO2: number;
  jetpack: number;
  carry: number;
  lapsePerS: number;
}

/** Multiplicadores por banda del tripulante (todo 1 y sin lapsus si no hay reglas o no hay cordura). */
export function sanityDebuffs(m: Pick<CrewMember, 'sanityBand'> | null | undefined, r: PsychRules | null): SanityDebuffs {
  if (!r || !m) return { work: 1, evadeDamage: 1, suitO2: 1, jetpack: 1, carry: 1, lapsePerS: 0 };
  const i = bandIndex(m.sanityBand ?? 'stable');
  const d = r.debuffs;
  return { work: d.work[i]!, evadeDamage: d.evadeDamage[i]!, suitO2: d.suitO2[i]!, jetpack: d.jetpack[i]!, carry: d.carry[i]!, lapsePerS: d.lapsePerS[i]! };
}

export interface DrainContext {
  context: 'transit' | 'docked' | 'surfaceAboard' | 'eva';
  sectorIndex: number;
  /** Con diseño (fase 4): distancia al Sol en UA; sustituye a la distancia por sector. */
  sunDistanceAu?: number;
  radiation: boolean;
  sinceNoveltyS: number;
  awakeS: number;
  cohesionPct?: number;
  /** Producto de mitigaciones (provisiones, mejoras y módulos, aura del gestor). 1 = sin mitigar. */
  mitigation: number;
  activeIncidents: number;
  lowShipO2: boolean;
  stormEva: boolean;
  suitCritical: boolean;
}

/** Cordura que pierde un tripulante por segundo (`base × D × (1+I) × S × R × C × M + H`). Nunca negativa. */
export function sanityDrainPctPerS(ctx: DrainContext, r: PsychRules): number {
  const base = r.base[ctx.context];
  const D = ctx.sunDistanceAu !== undefined ? 1 + r.distPerAu * Math.max(0, ctx.sunDistanceAu - 1) : 1 + r.distPerSector * Math.max(0, ctx.sectorIndex - 1);
  const I = r.monotonyMax * Math.min(1, Math.max(0, ctx.sinceNoveltyS) / r.monotonyRampS);
  const S = 1 + r.sleepPenalty * Math.min(1, Math.max(0, (ctx.awakeS - r.awakeGraceS) / r.awakeRampS));
  const R = ctx.radiation ? r.radiationMult : 1;
  const low = r.cohesion.lowPct;
  const C = ctx.cohesionPct !== undefined && ctx.cohesionPct < low ? 1 + r.cohesion.drainMax * ((low - ctx.cohesionPct) / low) : 1;
  const st = r.stressors;
  const H =
    st.perIncident * Math.min(st.maxIncidents, Math.max(0, ctx.activeIncidents)) +
    (ctx.lowShipO2 ? st.lowShipO2 : 0) + (ctx.stormEva ? st.stormEva : 0) + (ctx.suitCritical ? st.suitCritical : 0);
  return Math.max(0, base * D * (1 + I) * S * R * C * ctx.mitigation + H);
}

/** Minutos-luz por UA (retraso de la señal en un sentido). */
export function commsDelayMin(au: number): number {
  return Math.max(0, au) * 8.32;
}

/** Cordura que da una llamada a la Tierra completada: baja con el retraso; sube si solo queda uno vivo. */
export function callRecoveryPct(r: PsychRules, au: number, solo: boolean, crewMult: number): number {
  return (r.call.recoverPct * crewMult * (solo ? r.call.soloMult : 1)) / (1 + commsDelayMin(au) / r.call.delayHalfMin);
}

/** Tirada 0-1 de lapsus, SIN estado: depende solo de (semilla, paso, tripulante). */
export function psychRoll(seed: number, step: number, crewId: number): number {
  return createRng(deriveSeed(deriveSeed(deriveSeed(seed >>> 0, PSYCH_SALT), step), crewId)).next();
}

/**
 * Variación de la cohesión (%/s) con 2 o más vivos: deriva por desgaste medio del equipo y por cada tripulante en banda
 * crítica o de quiebre, más el empujón de dos en EVA a menos de `evaNearM`. 0 si hay menos de 2 vivos.
 */
export function cohesionDeltaPctPerS(crew: CrewMember[], r: PsychRules): number {
  const alive = crew.filter((c) => c.alive);
  if (alive.length < 2) return 0;
  const mean = alive.reduce((s, c) => s + (100 - (c.sanityPct ?? 100)) / 100, 0) / alive.length;
  let delta = -0.01 * mean * 2;
  for (const c of alive) if (bandIndex(c.sanityBand ?? 'stable') >= 2) delta -= 0.03;
  const eva = alive.filter((c) => c.location === 'eva');
  let near = false;
  for (let i = 0; i < eva.length && !near; i++) {
    for (let j = i + 1; j < eva.length; j++) {
      if (Math.hypot(eva[i]!.x - eva[j]!.x, eva[i]!.z - eva[j]!.z) <= r.cohesion.evaNearM) { near = true; break; }
    }
  }
  if (near) delta += r.cohesion.evaNearPctPerS;
  return delta;
}

/**
 * ¿Se puede llamar a la Tierra ahora? En partidas con diseño (fase 5) solo dentro de una ventana de contacto; sin
 * ciencia (o sin reglas de ciencia), siempre.
 */
export function contactWindowOpen(state: RunState, scienceRules?: ScienceRules | null): boolean {
  if (!state.science || !scienceRules) return true;
  return contactWindow(state.seed, state.stats.timeS, scienceRules).inWindow;
}
