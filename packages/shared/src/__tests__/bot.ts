/**
 * Tripulante simulado para los tests de balance y de mensajes. Juega como UNA persona: ir de un
 * puesto a otro cuesta tiempo (`walkS`), así que no puede atenderlo todo a la vez.
 *   - `crew`: esquiva impactos, apaga fuegos, sella fugas, repara y gestiona la energía. Nunca aterriza.
 *   - `idle`: solo elige destino y salta (nadie repara nada): sirve de grupo de control.
 *   - `explore` (con `crew`): además aterriza donde puede y sale a recoger materiales (fase 2).
 *     Como el motor no simula movimiento, «camina» informando posiciones (4,75 m/s nominales; el ritmo
 *     real de cada salida es 0,55-1 × eso y el bot no lo sabe: calcula la vuelta a ojo).
 *       · `prudent`: recoge lo más rentable, evita el terreno inestable, cuenta con las tormentas, vuelve
 *         con 12-18 % de margen de O₂ y, si la nave va justa de combustible, prioriza el hielo.
 *       · `greedy`: va a por lo raro aunque esté en terreno inestable, apura el O₂ (2-12 %), solo ve la
 *         tormenta cuando la tiene encima y frena tarde a veces.
 *       · `thorough` («hasta vaciar»): como el prudente con 25 % de margen, pero repite salidas mientras
 *         quede botín y el relleno le deje el traje al menos a 2/3 (sirve para buscar estrategias dominantes).
 *     `landings` resume cada aterrizaje: valor, salidas, tiempo en tierra, O₂ de la nave al despegar, averías.
 *     `returnMarginPct` fija el margen (curva «una veta más» del informe de balance).
 */
import {
  cargoMassKg, createRng, createRun, FIXED_STEP_S, getMaterial, getNode, getNodeKind, getWorld, lodeBonusApplies, referenceBrake, suitRefill,
  type CrewMember, type Deposit, type MissionDesign, type Rng, type Run, type RunAction, type RunEvent, type RunState, type SurfaceState, type SystemId,
} from '../index';

/** `thorough` («hasta vaciar»): como el prudente, pero repite salidas seguras mientras quede botín y la nave lo permita. */
export type ExploreStyle = 'prudent' | 'greedy' | 'thorough';

export interface BotOptions {
  skill: 'crew' | 'idle';
  /** Solo con `crew`: aterriza y explora (fase 2). */
  explore?: ExploreStyle;
  /** Segundos que tarda en llegar a otro puesto. */
  walkS?: number;
  /** Sectores a superar antes de parar. */
  sectors?: number;
  maxSeconds?: number;
  /**
   * Solo con `explore`: margen fijo de O₂ (%) con el que decide volver (sustituye al del estilo).
   * Sirve para medir «una veta más»: menos margen = más valor por salida y más muertes.
   */
  returnMarginPct?: number;
  /**
   * Habilidad en los minijuegos de la nave (sin él, esquiva limpia sin informar roces y repara a ritmo 1,
   * como en la fase 1). `medium`: jugador medio; `simple`: modo de interacciones simples; `clumsy`: torpe.
   */
  shipSkill?: ShipSkill;
  /**
   * Fase 3 (por defecto, sí): compra mejoras en las estaciones y el explorador no sube lastre (lo que no rinde un
   * suministro necesario y vale < 1 crédito/kg) con la bodega ya cargada. La curva «una veta más»
   * (`returnMarginPct`) lo apaga para medir el compromiso del O₂ con el traje de serie y la conducta de la fase 2.
   */
  economyPolicy?: boolean;
  /** Fase 4: juega con la nave diseñada sobre el mapa del sistema solar (sin él, la partida clásica). */
  design?: MissionDesign;
}

export type ShipSkill = 'medium' | 'simple' | 'clumsy';

/** Roces de la esquiva (probabilidad de 0, 1, 2, 3 y 4 roces) y ritmo de reparación por habilidad. */
export const SHIP_SKILLS: Record<ShipSkill, { grazes: readonly number[]; repairRate: number }> = {
  medium: { grazes: [0.55, 0.25, 0.12, 0.05, 0.03], repairRate: 0.85 },
  simple: { grazes: [0, 1, 0, 0, 0], repairRate: 0.9 },
  clumsy: { grazes: [0.2, 0.25, 0.25, 0.15, 0.15], repairRate: 0.6 },
};

export interface EvaRecord {
  durationS: number;
  /** Volvió vivo a la nave. */
  returned: boolean;
  /** Puntos que guardó en la bodega al volver. */
  value: number;
  /** Kilos que traía. */
  kg: number;
  worldId: string;
  /** 1 = primera salida en ese mundo. */
  index: number;
  /** O₂ del traje al volver (0 si murió). */
  suitO2Pct: number;
  /** Segundos de la salida sin moverse (esperando a las herramientas, recogiendo, colocando). */
  idleS: number;
  /** Por qué volvió: sin O₂ para otra veta, carga llena, avería a bordo (prudente) o murió. */
  endReason: 'o2' | 'full' | 'incident' | 'dead';
}

/** Un aterrizaje completo (del contacto al despegue). */
export interface LandingRecord {
  worldId: string;
  evas: number;
  /** Puntos guardados en la bodega en este mundo. */
  value: number;
  /** Segundos en tierra (null si no despegó). */
  surfaceS: number | null;
  /** O₂ de la nave al despegar (null si no despegó). */
  shipO2AtTakeOffPct: number | null;
  /** Averías que surgieron en tierra. */
  incidents: number;
}

export interface BotResult {
  state: RunState;
  events: RunEvent[];
  evas: EvaRecord[];
  landings: LandingRecord[];
  /** Fase 4: llegó (atracó) alguna vez al nodo destino de la misión (`missionTarget`). */
  targetReached: boolean;
}

/**
 * Velocidad a la que «camina» el explorador simulado (m/s). Una persona corre a 5,5 m/s y tiene
 * jetpack; con rodeos y paradas, 4,75 m/s es representativo.
 */
export const BOT_WALK_MPS = 4.75;

type Post = SystemId | 'helm' | 'map';

function chooseJump(run: Run): string | null {
  const s = run.state;
  const here = getNode(s.sector, s.locationId)!;
  let best: { id: string; value: number } | null = null;
  for (const id of here.links) {
    const node = getNode(s.sector, id)!;
    const est = run.estimateJump(id);
    if (!est || !est.byThrottle.eco.enoughFuel) continue;
    const forward = node.column > here.column ? 100 : s.visitedIds.includes(id) ? -200 : -50;
    const station = node.kind === 'station' && (s.ship.hull < 60 || s.ship.fuel < 55) ? 60 : 0;
    const goal = id === s.sector.goalId ? 500 : 0;
    // Fase 4: con misión diseñada, el destino de la misión atrae (en partidas clásicas ningún nodo lo lleva).
    const target = node.missionTarget && !s.visitedIds.includes(id) ? 120 : 0;
    const value = forward + station + goal + target - est.riskLevel * 22 - est.distanceLy + (node.cache ? 10 : 0);
    if (!best || value > best.value) best = { id, value };
  }
  return best?.id ?? null;
}

export function playRun(seed: number, options: BotOptions): BotResult {
  // Explorar lleva su tiempo: con el tope de la fase 1 (3600 s) el bot no acababa partidas que iba ganando.
  const { skill, walkS = 3.5, sectors = 1, explore, returnMarginPct, shipSkill } = options;
  // Flujo propio para los minijuegos: sin `shipSkill` no se tira nada (la fase 1 queda idéntica).
  const skillRng = shipSkill ? createRng(seed ^ 0x5c11) : null;
  const skillDef = shipSkill ? SHIP_SKILLS[shipSkill] : null;
  const workS = FIXED_STEP_S * (skillDef?.repairRate ?? 1);
  const evadeAction = (): RunAction => {
    if (!skillDef || !skillRng) return { type: 'evade' };
    let roll = skillRng.next();
    let grazes = skillDef.grazes.length - 1;
    for (let k = 0; k < skillDef.grazes.length; k++) {
      roll -= skillDef.grazes[k]!;
      if (roll < 0) {
        grazes = k;
        break;
      }
    }
    return { type: 'evade', grazes };
  };
  const maxSeconds = options.maxSeconds ?? (explore ? 7200 : 3600);
  const run = createRun(options.design ? { seed, design: options.design } : { seed });
  const s = run.state;
  const events: RunEvent[] = [];
  const explorer = skill === 'crew' && explore ? new Explorer(run, explore, seed, returnMarginPct, options.economyPolicy !== false) : null;
  let post: Post = 'map';
  let walkLeftS = 0;
  let planLeftS = 2;
  let lastVisit = '';
  let targetReached = false;
  const checkTarget = () => {
    if (!targetReached && s.phase !== 'transit' && getNode(s.sector, s.locationId)?.missionTarget) targetReached = true;
  };

  const goTo = (target: Post): boolean => {
    if (post !== target) {
      post = target;
      walkLeftS = walkS;
    }
    return walkLeftS <= 0;
  };

  for (let t = 0; t < maxSeconds; t += FIXED_STEP_S) {
    checkTarget();
    if (s.phase === 'lost') break;
    if (s.phase === 'won') {
      if (s.stats.sectorsCleared >= sectors) break;
      run.apply({ type: 'next-sector' });
    }
    walkLeftS = Math.max(0, walkLeftS - FIXED_STEP_S);

    if (skill === 'crew') {
      const ship = s.ship;
      // Energía: si hay sobrecarga, primero fuera sensores y luego escudos; se recuperan cuando sobra.
      if (ship.overloaded) {
        if (ship.systems.nav.enabled) run.apply({ type: 'toggle-system', systemId: 'nav', enabled: false });
        else if (ship.systems.shields.enabled) run.apply({ type: 'toggle-system', systemId: 'shields', enabled: false });
      } else {
        const spare = ship.powerSupplyKw - ship.powerDemandKw;
        // Con nave diseñada (fase 4) los consumos varían: se vuelve a encender solo si cabe lo que pide (+2 kW).
        const draw = s.missionDesign ? run.effectiveShip().systemDrawKw : null;
        const needShields = draw ? draw.shields + 2 : 32;
        const needNav = draw ? draw.nav + 2 : 12;
        if (!ship.systems.shields.enabled && spare >= needShields) run.apply({ type: 'toggle-system', systemId: 'shields', enabled: true });
        else if (!ship.systems.nav.enabled && spare >= needNav) run.apply({ type: 'toggle-system', systemId: 'nav', enabled: true });
      }

      const warning = s.warnings.find((w) => !w.evaded);
      const urgent = [...s.incidents].sort((a, b) => rank(a.kind) - rank(b.kind))[0];
      const damaged = (['reactor', 'engines', 'lifeSupport', 'shields', 'nav'] as const).find((id) => ship.systems[id].healthPct < 45);
      if (warning && warning.etaS >= 0 && warning.etaS < walkS + 4) {
        if (goTo('helm')) run.apply(evadeAction());
      } else if (urgent) {
        if (goTo(urgent.systemId)) run.apply({ type: 'work-incident', incidentId: urgent.id, seconds: workS });
      } else if (damaged && ship.spares > 0) {
        if (goTo(damaged)) run.apply({ type: 'repair-system', systemId: damaged, seconds: workS });
      }
    }

    if (explorer && explorer.act()) {
      run.step(FIXED_STEP_S);
      const fresh = run.takeEvents();
      explorer.observe(fresh);
      explorer.countIncidents(fresh);
      fresh.push(...run.takeEvents()); // lo que provoque observe() (caídas)
      explorer.recordDeath();
      events.push(...fresh);
      continue;
    }

    if (s.phase === 'docked') {
      // Una visita a la terminal por llegada (como una persona: entra, compra y se va).
      const visit = `${s.sector.index}:${s.stats.jumps}:${s.locationId}`;
      if (visit !== lastVisit) {
        lastVisit = visit;
        shop(run, skill === 'crew' && options.economyPolicy !== false ? (explore ? EXPLORER_UPGRADES : CREW_UPGRADES) : []);
      }
      planLeftS -= FIXED_STEP_S;
      const busy = skill === 'crew' && s.incidents.length > 0;
      if (planLeftS <= 0 && !busy) {
        const to = chooseJump(run);
        if (to) {
          const est = run.estimateJump(to)!;
          run.apply({ type: 'set-throttle', throttle: est.byThrottle.cruise.fuel < s.ship.fuel - 25 ? 'cruise' : 'eco' });
          if (run.apply({ type: 'jump', toId: to }).ok) planLeftS = 2;
        }
      }
    }
    run.step(FIXED_STEP_S);
    events.push(...run.takeEvents());
  }
  checkTarget();
  return { state: run.snapshot(), events, evas: explorer?.evas ?? [], landings: explorer?.landings ?? [], targetReached };
}

/** Prioridad de mejoras del bot (fase 3): primero lo que le salva la nave; el explorador, antes el equipo de salida. */
/**
 * Mejoras que considera el bot (fase 3), de más a menos prioridad base. La prioridad real depende del estado con el
 * que llega a la estación (`upgradeScore`): casco bajo → blindaje, depósito bajo → depósito y estabilizadores, etc.
 */
export const CREW_UPGRADES = [
  'hull-plating', 'shield-capacitor', 'fuel-tank', 'reactor-heatsink', 'engine-stabilizers', 'jump-drive', 'life-support-boost',
];
export const EXPLORER_UPGRADES = [
  'eva-o2-tank', 'cargo-backpack', 'hull-plating', 'shield-capacitor', 'fuel-tank', 'reactor-heatsink', 'engine-stabilizers', 'jump-drive',
  'life-support-boost', 'jetpack-thrusters',
];
/** Créditos que el bot guarda tras comprar mejoras (para repostar en la siguiente estación). */
export const BOT_CREDIT_RESERVE = 40;
/** Con esta carga (kg) en la bodega, el explorador deja de subir lo que apenas vale (lastre para los saltos). */
const DEAD_WEIGHT_CARGO_KG = 60;

/** Cómo llega la nave a la estación (antes de comprar suministros): decide qué mejora le hace más falta. */
interface ArrivalState {
  hullFrac: number;
  fuelFrac: number;
  oxygenPct: number;
  engineHealthPct: number;
  reactorHealthPct: number;
}

/**
 * Prioridad de una mejora: la base (orden en `wanted`) más lo que pide el estado de llegada, menos el precio.
 * Nunca compra una que deje la nave en sobrecarga a crucero con todo encendido (salvo el propio disipador).
 */
function upgradeScore(id: string, base: number, price: number, level: number, a: ArrivalState): number {
  let bonus = 0;
  if (id === 'hull-plating' && a.hullFrac < 0.6) bonus += 3;
  if (id === 'shield-capacitor' && a.hullFrac < 0.75) bonus += 1.5;
  if (id === 'fuel-tank' && a.fuelFrac < 0.4) bonus += 3;
  if (id === 'engine-stabilizers' && (a.engineHealthPct < 70 || a.fuelFrac < 0.4)) bonus += 2;
  if (id === 'jump-drive' && a.fuelFrac >= 0.4 && a.hullFrac >= 0.6) bonus += 3; // nave sana: ir más rápido
  if (id === 'reactor-heatsink' && a.reactorHealthPct < 85) bonus += 3;
  if (id === 'life-support-boost' && a.oxygenPct < 75) bonus += 2.5;
  // Rendimientos decrecientes: cada nivel ya comprado baja su prioridad (reparte la compra entre mejoras).
  return base + bonus - price / 100 - 3 * level;
}

/**
 * Política simple en la terminal de estación (fase 3): vende toda la bodega, pide la ayuda de emergencia,
 * llena el depósito, repone hasta 3 repuestos, repara el casco y, con lo que sobre por encima de la
 * reserva, compra mejoras de `wanted` que ofrezca la estación, la de más prioridad primero (`upgradeScore`).
 */
function shop(run: Run, wanted: readonly string[]): void {
  const q = run.stationQuote();
  if (!q) return;
  const s = run.state;
  const ship = run.effectiveShip();
  const arrival: ArrivalState = {
    hullFrac: s.ship.hull / ship.hullMax,
    fuelFrac: s.ship.fuel / ship.fuelCapacity,
    oxygenPct: s.ship.oxygenPct,
    engineHealthPct: s.ship.systems.engines.healthPct,
    reactorHealthPct: s.ship.systems.reactor.healthPct,
  };
  if (q.sellTotal > 0) run.apply({ type: 'sell' });
  if (q.emergency.available) run.apply({ type: 'service' });
  if (s.ship.fuel < ship.fuelCapacity - 0.5) run.apply({ type: 'buy-supply', supply: 'fuel' });
  if (s.ship.spares < 3) run.apply({ type: 'buy-supply', supply: 'spares', amount: 3 - s.ship.spares });
  if (s.ship.hull < ship.hullMax - 0.5) run.apply({ type: 'buy-supply', supply: 'hull' });
  for (let guard = 0; guard < 8; guard++) {
    let best: { id: string; score: number } | null = null;
    for (const u of run.stationQuote()!.upgrades) {
      const rank = wanted.indexOf(u.upgradeId);
      if (rank < 0 || u.price === null || u.price > s.credits - BOT_CREDIT_RESERVE) continue;
      if (u.overloadsAtCruise && u.upgradeId !== 'reactor-heatsink') continue;
      const score = upgradeScore(u.upgradeId, wanted.length - rank, u.price, u.level, arrival);
      if (!best || score > best.score) best = { id: u.upgradeId, score };
    }
    if (!best || !run.apply({ type: 'buy-upgrade', upgradeId: best.id }).ok) break;
  }
}

function rank(kind: string): number {
  return kind === 'fire' ? 0 : kind === 'leak' ? 1 : 2;
}

/**
 * Explorador de superficie. `act()` decide qué hacer en este paso; devuelve true si se ocupa él
 * (descenso, superficie o la decisión de aterrizar) y el bot general no debe saltar.
 */
class Explorer {
  readonly evas: EvaRecord[] = [];
  readonly landings: LandingRecord[] = [];
  private readonly rng: Rng;
  private target: number | null = null;
  private heading: 'out' | 'home' = 'out';
  private evasHere = 0;
  private climbing = false;
  /** Margen de frenado del codicioso en el descenso en curso (a veces llega tarde). */
  private brakeMargin = 0.6;
  /** Margen de O₂ (%) con el que decide volver en la salida en curso. */
  private margin = 15;
  /** En esta salida se mete en terreno inestable a por lo valioso. */
  private daring = false;
  /**
   * Ritmo real de esta salida frente al nominal (terreno, rodeos): 0,55-1. El bot planifica con
   * `BOT_WALK_MPS` y no lo sabe, como una persona que calcula la vuelta a ojo.
   */
  private pace = 1;
  /** Segundos quieto en la salida en curso (y si en este paso se movió). */
  private idleS = 0;
  private moved = false;
  private endReason: EvaRecord['endReason'] = 'o2';

  constructor(
    private readonly run: Run,
    private readonly style: ExploreStyle,
    seed: number,
    private readonly fixedMargin?: number,
    private readonly avoidDeadWeight = true,
  ) {
    this.rng = createRng(seed ^ 0x5eed);
  }

  private get s(): RunState {
    return this.run.state;
  }

  /** Prudente o «hasta vaciar»: cuentan con las tormentas, evitan el terreno inestable, frenan bien. */
  private get careful(): boolean {
    return this.style !== 'greedy';
  }

  countIncidents(events: RunEvent[]): void {
    const cur = this.landings.at(-1);
    if (cur && cur.surfaceS === null && (this.s.phase === 'surface' || this.s.phase === 'landing')) cur.incidents += events.filter((e) => e.type === 'incident').length;
  }

  act(): boolean {
    const s = this.s;
    if (s.phase === 'docked') {
      // Tras gastar O₂ en tierra, espera atracada a que el soporte vital lo reponga antes de saltar.
      if (s.ship.oxygenPct < 85 && s.landedIds.includes(s.locationId) && s.incidents.length === 0 && s.ship.systems.lifeSupport.online) return true;
      return this.maybeLand();
    }
    if (s.phase === 'landing') {
      this.brake();
      return true;
    }
    if (s.phase !== 'surface' || !s.surface) return false;
    const m = s.crew[0]!;
    if (m.location === 'ship') this.aboard(s.surface);
    else if (m.alive) {
      this.moved = false;
      this.outside(s.surface, m);
      if (!this.moved) this.idleS += FIXED_STEP_S;
    }
    return true;
  }

  /** Lee los eventos del paso (caídas por terreno que se hunde). */
  observe(events: RunEvent[]): void {
    const s = this.s;
    const m = s.crew[0];
    if (!s.surface || !m || !m.alive || m.location !== 'eva') return;
    if (events.some((e) => e.type === 'terrain-collapsed')) {
      const zone = s.surface.zones.find((z) => z.collapsed && Math.hypot(m.x - z.x, m.z - z.z) <= z.radiusM);
      if (zone) {
        const world = getWorld(s.surface.worldId);
        this.run.apply({ type: 'fall-impact', speedMps: Math.sqrt(2 * world.gravityMps2 * world.unstable.pitDepthM) });
        this.climbing = true;
      }
    }
  }

  private maybeLand(): boolean {
    const s = this.s;
    if (s.incidents.length > 0 || s.ship.hull < 45) return false;
    const est = this.run.estimateLanding();
    if (!est || est.alreadyLanded || !est.enoughFuel) return false;
    // Reserva para seguir viaje (el codicioso apura más). El prudente cuenta con el salto que de verdad
    // hará después (no el más barato) y con alguna maniobra evasiva por el camino.
    // Planetas y lunas no dan combustible (bajar es una apuesta de puntos): el prudente solo baja con margen.
    const costsFuel = getWorld(est.worldId).kind !== 'asteroid';
    const reserve = this.style === 'greedy' ? this.reserve() + 2 : this.nextJumpFuel() * 1.3 + 16 + (costsFuel ? 20 : 0);
    if (s.ship.fuel - est.totalFuel * (this.style === 'greedy' ? 1.1 : 1.5) < reserve) return false;
    if (!this.run.apply({ type: 'land' }).ok) return false;
    this.evasHere = 0;
    this.landings.push({ worldId: this.s.surface!.worldId, evas: 0, value: 0, surfaceS: null, shipO2AtTakeOffPct: null, incidents: 0 });
    this.brakeMargin = 0.7 + 0.32 * this.rng.next();
    return true;
  }

  /** Combustible en económico del salto que elegiría el bot desde aquí. */
  private nextJumpFuel(): number {
    const to = chooseJump(this.run);
    return (to ? this.run.estimateJump(to)?.byThrottle.eco.fuel : undefined) ?? this.reserve();
  }

  /** Combustible que le falta a la nave para ir holgada (el prudente recoge hielo si va justo). */
  private fuelNeed(m?: CrewMember): number {
    if (!this.careful) return 0;
    const s = this.s;
    const ship = this.run.effectiveShip();
    const carried = m ? Object.entries(m.carried).reduce((sum, [id, n]) => sum + (getMaterial(id).yields?.fuel ?? 0) * n, 0) : 0;
    return Math.max(0, ship.fuelCapacity * 0.7 - s.ship.fuel - carried);
  }

  /** Combustible del salto más barato desde aquí, en económico. */
  private reserve(): number {
    const s = this.s;
    const here = getNode(s.sector, s.locationId)!;
    return Math.min(...here.links.map((id) => this.run.estimateJump(id)?.byThrottle.eco.fuel ?? Infinity));
  }

  private brake(): void {
    const surface = this.s.surface!;
    const d = surface.descent!;
    const world = getWorld(surface.worldId);
    // El prudente sigue el perfil de referencia; el codicioso apura la frenada (y a veces llega tarde).
    const rules = this.run.effectiveSurfaceRules();
    const want = this.style === 'greedy' ? referenceBrake(world, rules, d.altitudeM, d.speedMps, this.brakeMargin) : referenceBrake(world, rules, d.altitudeM, d.speedMps);
    if (want !== d.brake) this.run.apply({ type: 'set-descent-brake', on: want });
  }

  private aboard(surface: SurfaceState): void {
    const s = this.s;
    if (s.incidents.length > 0) return; // el bot general las atiende (sigue a bordo)
    const thorough = this.style === 'thorough';
    const maxEvas = thorough ? Infinity : this.style === 'greedy' ? 3 : 2;
    const stormSoon = surface.storm.active || (surface.storm.nextInS !== null && surface.storm.nextInS < 70);
    // Repetir salida solo si queda botín que merezca la pena al alcance (sin contar lo que pisa terreno inestable).
    const loot = surface.deposits
      .filter((d) => d.units > 0 && !this.ballast(d.materialId) && !surface.zones.some((z) => !z.collapsed && Math.hypot(d.x - z.x, d.z - z.z) <= z.radiusM))
      .reduce((sum, d) => sum + d.units * d.valuePerUnit, 0);
    const iceLeft = surface.deposits.some((d) => d.units > 0 && (getMaterial(d.materialId).yields?.fuel ?? 0) > 0);
    const worth = this.evasHere === 0 || loot >= (thorough ? 20 : 80) || (this.fuelNeed() > 10 && iceLeft);
    // «Hasta vaciar» sale mientras el relleno le deje el traje al menos a 2/3; los demás, con la nave sobrada.
    const rules = this.run.effectiveSurfaceRules();
    const shipAllows = thorough ? suitRefill(rules, s.crew[0]!.suitO2Pct, s.ship.oxygenPct).suitO2Pct >= 66 : s.ship.oxygenPct > 60;
    // Sin herramienta útil para lo que queda (se perdieron fuera), salir no sirve de nada.
    const m0 = s.crew[0]!;
    const canMine = surface.deposits.some((d) => d.units > 0 && !this.ballast(d.materialId) && (m0.tools[getMaterial(d.materialId).tool] ?? 0) > 0);
    if (this.evasHere < maxEvas && worth && shipAllows && canMine) {
      if (stormSoon && this.careful) return; // espera a cubierto
      if (this.run.apply({ type: 'eva-exit' }).ok) {
        // El codicioso apura distinto cada vez: a veces calcula de menos.
        const roll = this.rng.next(); // se tira siempre (mismo flujo con o sin margen fijo)
        // Una persona no apura siempre igual: el prudente vuelve con 12-18 % y el codicioso con 2-12 %.
        this.margin = this.fixedMargin ?? (this.style === 'greedy' ? roll * 10 + 2 : this.style === 'thorough' ? 25 : 12 + roll * 6);
        this.daring = this.style === 'greedy' && this.rng.next() < 0.5;
        this.pace = 0.55 + 0.45 * this.rng.next();
        this.idleS = 0;
        this.evasHere++;
        this.heading = 'out';
        this.target = null;
        this.climbing = false;
      }
      return;
    }
    // Si despegar con la carga deja sin combustible para el siguiente salto, se suelta.
    const est = this.run.estimateTakeOff();
    if (est && est.loadedKg > 0 && s.ship.fuel - est.fuel < this.reserve() && s.ship.fuel - est.fuelEmpty >= this.reserve()) this.run.apply({ type: 'jettison' });
    const o2 = s.ship.oxygenPct;
    const elapsed = surface.elapsedS;
    let r = this.run.apply({ type: 'take-off' });
    if (!r.ok && r.reason.key === 'reject.takeOffHeavy') {
      this.run.apply({ type: 'jettison' });
      r = this.run.apply({ type: 'take-off' });
    }
    const cur = this.landings.at(-1);
    if (r.ok && cur) Object.assign(cur, { shipO2AtTakeOffPct: o2, surfaceS: elapsed });
    // Sin combustible para despegar: otra salida a por hielo.
    if (!r.ok && r.reason.key === 'reject.takeOffFuel') this.evasHere = 0;
  }

  private o2Rate(surface: SurfaceState, includeStorm: boolean): number {
    const rules = this.run.effectiveSurfaceRules();
    const world = getWorld(surface.worldId);
    const storm = includeStorm && world.storms && (surface.storm.active || surface.storm.warned) ? world.storms.o2DrainPctPerS * Math.max(surface.storm.intensity, world.storms.intensity.max) : 0;
    return rules.suit.o2DrainPctPerS + storm;
  }

  private outside(surface: SurfaceState, m: CrewMember): void {
    const rules = this.run.effectiveSurfaceRules();
    const prudent = this.careful;
    // El codicioso solo cuenta con la tormenta cuando ya la tiene encima.
    const rate = this.o2Rate(surface, prudent || surface.storm.active);
    // Si hay una herramienta en la veta que completa un filón, apura un poco más antes de irse.
    const lodePending = surface.tools.some((t) => lodeBonusApplies(surface.deposits, surface.deposits.find((d) => d.id === t.depositId)!, m));
    const margin = lodePending ? Math.max(2, this.margin - 4) : this.margin;
    const range = rules.suit.collectRangeM * 0.8;
    // Volver pasando a recoger las herramientas colocadas.
    const needHome = (this.tourS(m.x, m.z, surface.tools) * rate) + margin;

    if (this.heading === 'out' && m.suitO2Pct <= needHome) this.goHome('o2');
    // El prudente vuelve si la radio avisa de una avería a bordo.
    if (prudent && this.s.incidents.length > 0 && this.heading === 'out') this.goHome('incident');
    if (this.heading === 'home') {
      this.headHome(surface, m, rate);
      return;
    }

    const room = rules.suit.carryCapacityKg - m.carriedKg;
    const near = (x: number, z: number) => Math.hypot(x - m.x, z - m.z) <= range;
    // 1) En una herramienta con algo listo (o agotada): recoger (la agotada vuelve sola a la mochila).
    const here = surface.tools.find((t) => near(t.x, t.z) && (t.ready > 0 || t.stopped === 'depleted'));
    if (here) {
      this.ground(m);
      const r = this.run.apply({ type: 'collect', depositId: here.depositId });
      if (!r.ok && r.reason.key === 'reject.overCapacity') this.goHome('full');
      return;
    }
    // 2) Herramienta libre en la mochila: colocarla en la veta más rentable a la que dé tiempo.
    const best = this.bestDeposit(surface, m, rate, room);
    if (best) {
      this.target = best.id;
      if (near(best.x, best.z)) {
        this.ground(m);
        if (!this.run.apply({ type: 'deploy-tool', depositId: best.id }).ok) this.target = null;
        return;
      }
      this.moveToward(surface, m, best.x, best.z);
      return;
    }
    // 3) Todo colocado: esperar junto a la que antes tenga algo que recoger.
    const fitsSome = surface.tools.some((t) => getMaterial(t.materialId).massKg <= room + 1e-9);
    if (surface.tools.length > 0 && fitsSome) {
      const v = BOT_WALK_MPS;
      const next = (t: (typeof surface.tools)[number]) => {
        const walk = Math.hypot(t.x - m.x, t.z - m.z) / v;
        if (t.ready > 0 || t.stopped === 'depleted') return walk;
        const left = (1 - t.progress) * getMaterial(t.materialId).collectS / this.toolSpeed(t.toolId);
        return Math.max(walk, t.stopped === 'storm' ? left + 60 : left);
      };
      const t = surface.tools.filter((x) => getMaterial(x.materialId).massKg <= room + 1e-9).reduce((a, b) => (next(b) < next(a) ? b : a));
      if (!near(t.x, t.z)) this.moveToward(surface, m, t.x, t.z);
      return;
    }
    // 4) Nada más que hacer fuera.
    const fits = surface.deposits.some((d) => d.units > 0 && getMaterial(d.materialId).massKg <= room);
    this.goHome(room < 6 || !fits ? 'full' : 'o2');
  }

  /** Con la política de la fase 3, ese material sería lastre ahora (no sale a por él ni lo cuenta como botín). */
  private ballast(materialId: string): boolean {
    return this.avoidDeadWeight && this.deadWeight(materialId);
  }

  /** Material que solo sería lastre ahora: sus suministros no caben y vale menos de 1 crédito/kg. */
  private deadWeight(materialId: string): boolean {
    const mat = getMaterial(materialId);
    const ship = this.run.effectiveShip();
    const s = this.s;
    const usefulFuel = (mat.yields?.fuel ?? 0) > 0 && s.ship.fuel < ship.fuelCapacity - (mat.yields?.fuel ?? 0);
    const usefulSpares = (mat.yields?.spares ?? 0) > 0 && s.ship.spares < ship.maxSpares;
    const price = this.run.catalog.economy?.sellPrices[materialId] ?? 0;
    // Con la bodega aún ligera se sube igual (se vende); el lastre solo pesa cuando ya hay carga.
    return !usefulFuel && !usefulSpares && price / mat.massKg < 1 && cargoMassKg(s.ship.cargo, this.run.catalog) >= DEAD_WEIGHT_CARGO_KG;
  }

  private toolSpeed(toolId: string): number {
    return this.run.catalog.surface!.tools.find((t) => t.id === toolId)!.speedMult;
  }

  private ground(m: CrewMember): void {
    this.climbing = false;
    if (!m.grounded) this.run.apply({ type: 'set-position', x: m.x, z: m.z, grounded: true }); // colocar y recoger exigen suelo
  }

  /** Segundos de ir desde (x, z) por las herramientas colocadas (la más cercana cada vez) y volver a la nave. */
  private tourS(x: number, z: number, tools: readonly { x: number; z: number }[]): number {
    let left = [...tools];
    let px = x;
    let pz = z;
    let dist = 0;
    while (left.length > 0) {
      const t = left.reduce((a, b) => (Math.hypot(b.x - px, b.z - pz) < Math.hypot(a.x - px, a.z - pz) ? b : a));
      dist += Math.hypot(t.x - px, t.z - pz);
      px = t.x;
      pz = t.z;
      left = left.filter((o) => o !== t);
    }
    return (dist + Math.hypot(px, pz)) / BOT_WALK_MPS;
  }

  /** Mejor veta libre para una herramienta que lleva en la mochila (o null). */
  private bestDeposit(surface: SurfaceState, m: CrewMember, rate: number, room: number): Deposit | null {
    const homeDist = Math.hypot(m.x, m.z);
    let best: { d: Deposit; score: number } | null = null;
    for (const d of surface.deposits) {
      if (d.units <= 0 || surface.tools.some((t) => t.depositId === d.id)) continue;
      const mat = getMaterial(d.materialId);
      if ((m.tools[mat.tool] ?? 0) <= 0 || mat.massKg > room + 1e-9) continue;
      // Fase 3: la carga pesa en cada salto. Lo que no rinde un suministro que haga falta y se vende a menos de
      // 1 crédito/kg (la mena con los repuestos llenos) no compensa subirlo.
      if (this.ballast(mat.id)) continue;
      const inZone = surface.zones.some((z) => !z.collapsed && Math.hypot(d.x - z.x, d.z - z.z) <= z.radiusM);
      if (!this.daring && inZone) continue;
      const go = Math.hypot(d.x - m.x, d.z - m.z) / BOT_WALK_MPS;
      // Ir, esperar una unidad y volver pasando por las demás herramientas.
      const cost = (go + mat.collectS / this.toolSpeed(mat.tool) + this.tourS(d.x, d.z, surface.tools)) * rate + this.margin;
      if (cost > m.suitO2Pct) continue;
      const back = Math.hypot(d.x, d.z) / BOT_WALK_MPS;
      const away = Math.max(0, back - homeDist / BOT_WALK_MPS);
      // Si la nave va justa de combustible, el hielo vale más; lo raro se revaloriza con la racha.
      const lodeMult = lodeBonusApplies(surface.deposits, d, m) ? (this.run.effectiveSurfaceRules().lodes?.completeMult ?? 1) : 1;
      const worth = d.valuePerUnit * (mat.streak ? m.streakMult : 1) * lodeMult + (this.fuelNeed(m) > 0 ? (mat.yields?.fuel ?? 0) * 8 : 0);
      const units = Math.min(d.units, Math.floor(room / mat.massKg));
      const perKg = Math.sqrt(worth / mat.massKg);
      const score = (worth * perKg * Math.sqrt(units) * (this.daring ? 1.5 + (d.risky ? 1 : 0) : 1)) / (go + away + 4);
      if (!best || score > best.score || (d.id === this.target && score > best.score * 0.8)) best = { d, score };
    }
    return best?.d ?? null;
  }

  /** De vuelta: pasa a retirar las herramientas si el O₂ da para el rodeo; si no, las abandona. */
  private headHome(surface: SurfaceState, m: CrewMember, rate: number): void {
    const rules = this.run.effectiveSurfaceRules();
    const homeDist = Math.hypot(m.x, m.z);
    // Para desviarse a por una herramienta exige el mismo margen con el que decidió volver.
    const reserve = this.careful ? this.margin * 0.5 : this.margin;
    // Con una avería a bordo no hay rodeos: las herramientas se abandonan.
    const urgent = this.s.incidents.length > 0;
    const t = surface.tools.length > 0 && !urgent ? surface.tools.reduce((a, b) => (Math.hypot(b.x - m.x, b.z - m.z) < Math.hypot(a.x - m.x, a.z - m.z) ? b : a)) : null;
    if (t) {
      const detour = ((Math.hypot(t.x - m.x, t.z - m.z) + Math.hypot(t.x, t.z)) / BOT_WALK_MPS) * rate + reserve;
      if (m.suitO2Pct > detour) {
        if (Math.hypot(t.x - m.x, t.z - m.z) <= rules.suit.collectRangeM * 0.8) {
          this.ground(m);
          this.run.apply({ type: 'retrieve-tool', depositId: t.depositId });
          return;
        }
        this.moveToward(surface, m, t.x, t.z);
        return;
      }
    }
    if (homeDist <= rules.suit.airlockRangeM * 0.8) {
      const value = m.carriedValue;
      const duration = m.evaS;
      const kg = m.carriedKg;
      if (this.run.apply({ type: 'eva-enter' }).ok) {
        const cur = this.landings.at(-1);
        if (cur) {
          cur.evas++;
          cur.value += value;
        }
        this.evas.push({ durationS: duration, returned: true, value, kg, worldId: surface.worldId, index: this.evasHere, suitO2Pct: m.suitO2Pct, endReason: this.endReason, idleS: this.idleS });
      }
      return;
    }
    this.moveToward(surface, m, 0, 0);
  }

  /** Camina hacia (x, z); sobre terreno inestable, salvo que se arriesgue, cruza con el jetpack. */
  private moveToward(surface: SurfaceState, m: CrewMember, x: number, z: number): void {
    this.moved = true;
    const dx = x - m.x;
    const dz = z - m.z;
    const dist = Math.hypot(dx, dz);
    const k = dist > 0 ? Math.min(1, (BOT_WALK_MPS * this.pace * FIXED_STEP_S) / dist) : 0;
    const nx = m.x + dx * k;
    const nz = m.z + dz * k;
    const overZone = surface.zones.some((zn) => !zn.collapsed && Math.hypot(nx - zn.x, nz - zn.z) <= zn.radiusM);
    const fly = (overZone && !this.daring && m.jetpackPct > 5) || (this.climbing && m.jetpackPct > 5);
    if (fly) this.run.apply({ type: 'jetpack', seconds: FIXED_STEP_S });
    if (this.climbing && !surface.zones.some((zn) => zn.collapsed && Math.hypot(nx - zn.x, nz - zn.z) <= zn.radiusM)) this.climbing = false;
    this.run.apply({ type: 'set-position', x: nx, z: nz, grounded: !fly });
  }

  private goHome(reason: EvaRecord['endReason']): void {
    this.heading = 'home';
    this.endReason = reason;
  }

  /** Para el informe: el tripulante murió fuera durante la salida en curso. */
  recordDeath(): void {
    const m = this.s.crew[0];
    if (m && !m.alive && m.location === 'eva' && !this.evas.some((e) => !e.returned)) this.evas.push({ durationS: m.evaS, returned: false, value: 0, kg: 0, worldId: this.s.surface?.worldId ?? '', index: this.evasHere, suitO2Pct: 0, endReason: 'dead', idleS: this.idleS });
  }
}
