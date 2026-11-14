/**
 * Ciencia, datos y ventanas de contacto (fase 5, ADR 0018). Funciones puras: la partida (`run.ts`) llama a
 * `stepScience` en cada paso fijo con lo que necesita saber de la nave, y `missionReport` explica el resultado.
 *
 * - Observar: atracada junto a un cuerpo (o posada en él) los instrumentos generan datos (MB de juego) y
 *   ciencia mientras la navegación esté en línea; cada cuerpo da de sí unos segundos.
 * - Almacenar: un único búfer con la capacidad de las computadoras; lleno, lo nuevo se pierde.
 * - Bajar: en las ventanas de contacto (periódicas, desfase por semilla), con alcance de alguna antena y sin
 *   estar posada. Solo lo entregado puntúa y está a salvo.
 */
import { catalog as defaultCatalog } from './catalog';
import { getDifficulty, getInstruments, getMissions, getModules, missionAtDifficulty } from './design';
import { deriveSeed } from './rng';
import type {
  Catalog, EventTone, MessageRef, MissionDesign, MissionOutcome, MissionReport, ReportLink, RunEventSubtype, RunEventType, RunState,
  ScienceRules, ScienceState,
} from './types';

const CONTACT_SALT = 0xc0a7;
const EPS = 1e-9;
/** El aviso de almacenamiento lleno se rearma al quedar libre esta fracción de la capacidad. */
const STORAGE_REARM_FRAC = 0.1;

const round1 = (n: number): number => Math.round(n * 10) / 10;

export function getScienceRules(cat: Catalog = defaultCatalog): ScienceRules {
  if (!cat.science) throw new Error('El catálogo no tiene reglas de ciencia (usa parseCatalog)');
  return cat.science;
}

/** Lo que el diseño aporta a la ciencia de la partida (se calcula una vez al crearla). */
export interface ScienceProfile {
  /** MB/s que generan todos los instrumentos observando. */
  observeMbPerS: number;
  /** Ciencia por segundo en el destino en órbita (lugar = 1): Σ valor × tipo / `observeMaxS`. */
  sciencePerS: number;
  capacityMb: number;
  /** Antenas: tasa (Mbps) y alcance (UA de distancia al Sol). */
  antennas: { rateMbps: number; rangeAu: number }[];
  requiredScience: number;
  targetBodyId: string | null;
}

export function scienceProfile(design: MissionDesign, cat: Catalog = defaultCatalog): ScienceProfile {
  const rules = getScienceRules(cat);
  const offKind = cat.design?.offKindScienceMult ?? 0.5;
  const baseMission = getMissions(cat).find((m) => m.id === design.missionId);
  const mission = baseMission && missionAtDifficulty(baseMission, getDifficulty(design.difficultyId, cat));
  const wanted = new Set([...(mission?.requirements.requiredKinds ?? []), ...(mission ? [mission.scienceKind] : [])]);
  const instruments = design.instrumentIds.flatMap((id) => getInstruments(cat).filter((i) => i.id === id));
  const modules = design.moduleIds.flatMap((id) => getModules(cat).filter((m) => m.id === id));
  const scienceValue = instruments.reduce((s, i) => s + i.scienceValue * (wanted.has(i.scienceKind) ? 1 : offKind), 0);
  return {
    observeMbPerS: instruments.reduce((s, i) => s + Math.max(rules.minObserveMbPerS, i.dataRateMbps * rules.observeMbPerMbps), 0),
    sciencePerS: scienceValue / rules.observeMaxS,
    capacityMb: modules.reduce((s, m) => s + (m.kind === 'computer' ? (m.storageGb ?? 0) * rules.storageMbPerGb : 0), 0),
    antennas: modules.filter((m) => m.kind === 'comms').map((m) => ({ rateMbps: m.dataRateMbps ?? 0, rangeAu: m.commsRangeAu ?? 0 })),
    requiredScience: mission?.requirements.minScience ?? 0,
    targetBodyId: design.destinationId,
  };
}

export function newScienceState(profile: ScienceProfile): ScienceState {
  return {
    requiredScience: profile.requiredScience,
    storedMb: 0, storedScience: 0, capacityMb: profile.capacityMb,
    deliveredMb: 0, deliveredScience: 0, lostMb: 0, lostScience: 0, lostWithShipScience: 0,
    observedS: {}, observing: null, observeMbPerS: 0,
    contact: false, downlinkMbPerS: 0, inWindow: false, windowChangeInS: 0, inRange: false,
    targetVisited: false, objectiveMet: false, over: false, fullWarned: false,
    blockedS: 0, outOfRangeS: 0, fullS: 0,
  };
}

/** Ventana de contacto en el instante `timeS`: dentro o no y segundos hasta el próximo cambio. Determinista. */
export function contactWindow(seed: number, timeS: number, rules: ScienceRules): { inWindow: boolean; changeInS: number } {
  const offset = deriveSeed(seed, CONTACT_SALT) % Math.max(1, Math.round(rules.contactPeriodS));
  const phase = (((timeS + offset) % rules.contactPeriodS) + rules.contactPeriodS) % rules.contactPeriodS;
  const inWindow = phase < rules.contactWindowS - EPS;
  return { inWindow, changeInS: inWindow ? rules.contactWindowS - phase : rules.contactPeriodS - phase };
}

/** Tasa de bajada (MB/s) a esa distancia al Sol: antenas con alcance × factor de distancia a la Tierra. */
export function downlinkMbPerS(profile: ScienceProfile, sunDistanceAu: number, rules: ScienceRules): { inRange: boolean; mbPerS: number } {
  const usable = profile.antennas.filter((a) => a.rangeAu + EPS >= sunDistanceAu && a.rateMbps > 0);
  if (usable.length === 0) return { inRange: false, mbPerS: 0 };
  const dEarth = Math.max(rules.rateRefAu, Math.abs(sunDistanceAu - 1));
  const factor = Math.pow(rules.rateRefAu / dEarth, rules.rateFalloffExp);
  return { inRange: true, mbPerS: usable.reduce((s, a) => s + a.rateMbps, 0) * rules.downlinkMbPerMbps * factor };
}

/** Puntos que da la ciencia (lo entregado y, al terminar con éxito, el bonus). */
export function sciencePoints(sci: ScienceState, rules: ScienceRules): number {
  return Math.round(sci.deliveredScience * rules.scorePerScience) + (sci.over && sci.objectiveMet ? rules.successBonus : 0);
}

export interface ScienceEvent {
  type: RunEventType;
  tone: EventTone;
  key: string;
  params?: MessageRef['params'];
  subtype?: RunEventSubtype;
}

/** Lo que la partida sabe en este paso y la ciencia necesita. */
export interface ScienceContext {
  seed: number;
  timeS: number;
  /** Cuerpo observable aquí (atracada junto a él o posada en él; null = ninguno). */
  bodyId: string | null;
  /** Posada en la superficie (sin enlace; observación de superficie). */
  onSurface: boolean;
  /** En descenso o en tierra: el cuerpo tapa la Tierra. */
  noLink: boolean;
  navOnline: boolean;
  sunDistanceAu: number;
}

/** Entrega en la Tierra `mb` de los datos a bordo (con su parte de ciencia). */
function deliver(sci: ScienceState, mb: number): void {
  if (sci.storedMb <= EPS || mb <= 0) return;
  const take = Math.min(sci.storedMb, mb);
  const science = sci.storedScience * (take / sci.storedMb);
  sci.storedMb -= take;
  sci.storedScience -= science;
  if (sci.storedMb < 1e-6) {
    sci.storedMb = 0;
    sci.storedScience = 0;
  }
  sci.deliveredMb += take;
  sci.deliveredScience += science;
}

/** Comprueba el objetivo tras una entrega. */
function checkObjective(sci: ScienceState, events: ScienceEvent[]): void {
  if (!sci.objectiveMet && sci.requiredScience > 0 && sci.deliveredScience + EPS >= sci.requiredScience) {
    sci.objectiveMet = true;
    events.push({ type: 'objective-met', tone: 'ok', key: 'event.objectiveMet', params: { science: Math.round(sci.deliveredScience) } });
  }
}

/** Un paso fijo de la ciencia. Muta `sci` y devuelve los eventos. */
export function stepScience(sci: ScienceState, profile: ScienceProfile, rules: ScienceRules, ctx: ScienceContext, dt: number): ScienceEvent[] {
  const events: ScienceEvent[] = [];
  if (sci.over) return events;

  // Observación
  sci.observing = null;
  sci.observeMbPerS = 0;
  if (ctx.bodyId && profile.observeMbPerS > 0) {
    const isTarget = ctx.bodyId === profile.targetBodyId;
    const key = ctx.onSurface ? `${ctx.bodyId}:surface` : ctx.bodyId;
    const cap = isTarget ? rules.observeMaxS : rules.otherObserveMaxS;
    const done = sci.observedS[key] ?? 0;
    if (done < cap - EPS) {
      if (!ctx.navOnline) sci.blockedS += dt;
      else {
        const s = Math.min(dt, cap - done);
        const place = isTarget ? (ctx.onSurface ? rules.surfaceMult : rules.targetMult) : rules.otherBodyMult;
        const mb = profile.observeMbPerS * s;
        const science = profile.sciencePerS * place * s;
        sci.observedS[key] = round1(done + s) >= cap - EPS ? cap : done + s;
        sci.observing = ctx.bodyId;
        sci.observeMbPerS = profile.observeMbPerS;
        const free = Math.max(0, sci.capacityMb - sci.storedMb);
        const fits = Math.min(1, mb > 0 ? free / mb : 1);
        sci.storedMb += mb * fits;
        sci.storedScience += science * fits;
        if (fits < 1) {
          sci.lostMb += mb * (1 - fits);
          sci.lostScience += science * (1 - fits);
          sci.fullS += dt;
          if (!sci.fullWarned) {
            sci.fullWarned = true;
            events.push({ type: 'storage-full', tone: 'warn', key: 'event.storageFull' });
          }
        }
        if (sci.observedS[key]! >= cap - EPS) {
          events.push({ type: 'observation-done', tone: 'ok', key: ctx.onSurface ? 'event.observationDoneSurface' : 'event.observationDone', params: { body: ctx.bodyId } });
        }
      }
    }
  }

  // Enlace con la Tierra
  const win = contactWindow(ctx.seed, ctx.timeS, rules);
  const link = downlinkMbPerS(profile, ctx.sunDistanceAu, rules);
  const wasContact = sci.contact;
  sci.inWindow = win.inWindow;
  sci.windowChangeInS = round1(win.changeInS);
  sci.inRange = link.inRange;
  sci.contact = win.inWindow && link.inRange && ctx.navOnline && !ctx.noLink;
  sci.downlinkMbPerS = sci.contact ? link.mbPerS : 0;
  if (sci.storedMb > EPS && !link.inRange) sci.outOfRangeS += dt;
  if (sci.contact && !wasContact && sci.storedMb > EPS) events.push({ type: 'contact-start', tone: 'info', key: 'event.contactStart', params: { mb: Math.round(sci.storedMb) } });
  if (sci.contact) deliver(sci, sci.downlinkMbPerS * dt);
  if (sci.fullWarned && sci.capacityMb - sci.storedMb >= sci.capacityMb * STORAGE_REARM_FRAC) sci.fullWarned = false;
  checkObjective(sci, events);
  return events;
}

/** Fin de la misión al volver a la Tierra: entrega lo que quede (si las reglas lo dicen) y la cierra. */
export function finishMission(sci: ScienceState, rules: ScienceRules): ScienceEvent[] {
  const events: ScienceEvent[] = [];
  if (sci.over) return events;
  if (rules.homeDeliversAll) deliver(sci, sci.storedMb);
  checkObjective(sci, events);
  sci.over = true;
  sci.observing = null;
  sci.observeMbPerS = 0;
  sci.contact = false;
  sci.downlinkMbPerS = 0;
  const success = sci.objectiveMet;
  events.push({
    type: 'mission-complete', tone: success ? 'ok' : 'warn', key: success ? 'event.missionSuccess' : 'event.missionPartial',
    params: { science: Math.round(sci.deliveredScience), required: sci.requiredScience }, subtype: success ? 'success' : 'partial',
  });
  return events;
}

/** Al perder la nave: lo que quedaba a bordo se pierde con ella. */
export function loseWithShip(sci: ScienceState): void {
  sci.lostWithShipScience = sci.storedScience;
  sci.contact = false;
  sci.downlinkMbPerS = 0;
  sci.observing = null;
  sci.observeMbPerS = 0;
}

/**
 * Informe post-misión: resultado y cadena de causas (como mucho 6 eslabones, una línea cada uno), derivados
 * del estado. `null` en una partida sin diseño.
 */
export function missionReport(state: RunState): MissionReport | null {
  const sci = state.science;
  const design = state.missionDesign;
  if (!sci || !design) return null;
  const outcome: MissionOutcome = state.phase === 'lost' ? 'lost' : sci.over ? (sci.objectiveMet ? 'success' : 'partial') : 'in-progress';
  const body = design.destinationId ?? '';
  const delivered = Math.round(sci.deliveredScience);
  const links: ReportLink[] = [
    sci.targetVisited
      ? { id: 'target', ok: true, message: { key: 'report.target.ok', params: { body } } }
      : { id: 'target', ok: false, message: { key: 'report.target.bad', params: { body } } },
    sci.blockedS < 1
      ? { id: 'power', ok: true, message: { key: 'report.power.ok' } }
      : { id: 'power', ok: false, message: { key: 'report.power.bad', params: { seconds: Math.round(sci.blockedS) } } },
    sci.lostMb < 0.5
      ? { id: 'storage', ok: true, message: { key: 'report.storage.ok' } }
      : { id: 'storage', ok: false, message: { key: 'report.storage.bad', params: { mb: Math.round(sci.lostMb), science: Math.round(sci.lostScience) } } },
    state.phase === 'lost' && sci.lostWithShipScience >= 0.5
      ? { id: 'link', ok: false, message: { key: 'report.link.aboard', params: { science: Math.round(sci.lostWithShipScience) } } }
      : sci.outOfRangeS >= 1
        ? { id: 'link', ok: false, message: { key: 'report.link.outOfRange', params: { seconds: Math.round(sci.outOfRangeS) } } }
        : { id: 'link', ok: true, message: { key: 'report.link.ok', params: { mb: Math.round(sci.deliveredMb) } } },
    sci.objectiveMet
      ? { id: 'science', ok: true, message: { key: 'report.science.ok', params: { science: delivered, required: sci.requiredScience } } }
      : { id: 'science', ok: false, message: { key: 'report.science.bad', params: { science: delivered, required: sci.requiredScience } } },
    state.phase === 'lost'
      ? { id: 'survival', ok: false, message: { key: `report.survival.${state.lossReason ?? 'hull'}` } }
      : { id: 'survival', ok: true, message: { key: 'report.survival.ok' } },
  ];
  return {
    outcome,
    headline: { key: `report.outcome.${outcome}`, params: { science: delivered, required: sci.requiredScience } },
    links,
    rootCause: links.find((l) => !l.ok)?.id ?? null,
    deliveredScience: delivered,
    requiredScience: sci.requiredScience,
  };
}
