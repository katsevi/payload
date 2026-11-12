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
  createRng, createRun, FIXED_STEP_S, getMaterial, getNode, getNodeKind, getWorld, referenceBrake, suitRefill,
  type CrewMember, type Deposit, type Rng, type Run, type RunEvent, type RunState, type SurfaceState, type SystemId,
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
}

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
    const value = forward + station + goal - est.riskLevel * 22 - est.distanceLy + (node.cache ? 10 : 0);
    if (!best || value > best.value) best = { id, value };
  }
  return best?.id ?? null;
}

export function playRun(seed: number, options: BotOptions): BotResult {
  // Explorar lleva su tiempo: con el tope de la fase 1 (3600 s) el bot no acababa partidas que iba ganando.
  const { skill, walkS = 3.5, sectors = 1, explore, returnMarginPct } = options;
  const maxSeconds = options.maxSeconds ?? (explore ? 7200 : 3600);
  const run = createRun({ seed });
  const s = run.state;
  const events: RunEvent[] = [];
  const explorer = skill === 'crew' && explore ? new Explorer(run, explore, seed, returnMarginPct) : null;
  let post: Post = 'map';
  let walkLeftS = 0;
  let planLeftS = 2;

  const goTo = (target: Post): boolean => {
    if (post !== target) {
      post = target;
      walkLeftS = walkS;
    }
    return walkLeftS <= 0;
  };

  for (let t = 0; t < maxSeconds; t += FIXED_STEP_S) {
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
        if (!ship.systems.shields.enabled && spare >= 32) run.apply({ type: 'toggle-system', systemId: 'shields', enabled: true });
        else if (!ship.systems.nav.enabled && spare >= 12) run.apply({ type: 'toggle-system', systemId: 'nav', enabled: true });
      }

      const warning = s.warnings.find((w) => !w.evaded);
      const urgent = [...s.incidents].sort((a, b) => rank(a.kind) - rank(b.kind))[0];
      const damaged = (['reactor', 'engines', 'lifeSupport', 'shields', 'nav'] as const).find((id) => ship.systems[id].healthPct < 45);
      if (warning && warning.etaS >= 0 && warning.etaS < walkS + 4) {
        if (goTo('helm')) run.apply({ type: 'evade' });
      } else if (urgent) {
        if (goTo(urgent.systemId)) run.apply({ type: 'work-incident', incidentId: urgent.id, seconds: FIXED_STEP_S });
      } else if (damaged && ship.spares > 0) {
        if (goTo(damaged)) run.apply({ type: 'repair-system', systemId: damaged, seconds: FIXED_STEP_S });
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
      const here = getNode(s.sector, s.locationId)!;
      if (getNodeKind(here.kind).service && !s.servicedIds.includes(here.id)) run.apply({ type: 'service' });
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
  return { state: run.snapshot(), events, evas: explorer?.evas ?? [], landings: explorer?.landings ?? [] };
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
  private endReason: EvaRecord['endReason'] = 'o2';

  constructor(private readonly run: Run, private readonly style: ExploreStyle, seed: number, private readonly fixedMargin?: number) {
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
    else if (m.alive) this.outside(s.surface, m);
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
    const ship = this.run.catalog.ships.find((x) => x.id === s.ship.shipId)!;
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
    const rules = this.run.catalog.surface!.rules;
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
      .filter((d) => d.units > 0 && !surface.zones.some((z) => !z.collapsed && Math.hypot(d.x - z.x, d.z - z.z) <= z.radiusM))
      .reduce((sum, d) => sum + d.units * d.valuePerUnit, 0);
    const iceLeft = surface.deposits.some((d) => d.units > 0 && (getMaterial(d.materialId).yields?.fuel ?? 0) > 0);
    const worth = this.evasHere === 0 || loot >= (thorough ? 20 : 80) || (this.fuelNeed() > 10 && iceLeft);
    // «Hasta vaciar» sale mientras el relleno le deje el traje al menos a 2/3; los demás, con la nave sobrada.
    const rules = this.run.catalog.surface!.rules;
    const shipAllows = thorough ? suitRefill(rules, s.crew[0]!.suitO2Pct, s.ship.oxygenPct).suitO2Pct >= 66 : s.ship.oxygenPct > 60;
    if (this.evasHere < maxEvas && worth && shipAllows) {
      if (stormSoon && this.careful) return; // espera a cubierto
      if (this.run.apply({ type: 'eva-exit' }).ok) {
        // El codicioso apura distinto cada vez: a veces calcula de menos.
        const roll = this.rng.next(); // se tira siempre (mismo flujo con o sin margen fijo)
        // Una persona no apura siempre igual: el prudente vuelve con 12-18 % y el codicioso con 2-12 %.
        this.margin = this.fixedMargin ?? (this.style === 'greedy' ? roll * 10 + 2 : this.style === 'thorough' ? 25 : 12 + roll * 6);
        this.daring = this.style === 'greedy' && this.rng.next() < 0.5;
        this.pace = 0.55 + 0.45 * this.rng.next();
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
    const rules = this.run.catalog.surface!.rules;
    const world = getWorld(surface.worldId);
    const storm = includeStorm && world.storms && (surface.storm.active || surface.storm.warned) ? world.storms.o2DrainPctPerS * Math.max(surface.storm.intensity, world.storms.intensity.max) : 0;
    return rules.suit.o2DrainPctPerS + storm;
  }

  private outside(surface: SurfaceState, m: CrewMember): void {
    const rules = this.run.catalog.surface!.rules;
    const prudent = this.careful;
    // El codicioso solo cuenta con la tormenta cuando ya la tiene encima.
    const rate = this.o2Rate(surface, prudent || surface.storm.active);
    const homeDist = Math.hypot(m.x, m.z);
    const margin = this.margin;
    const needHome = (homeDist / BOT_WALK_MPS) * rate + margin;

    if (this.heading === 'out' && m.suitO2Pct <= needHome) this.goHome('o2');
    // El prudente vuelve si la radio avisa de una avería a bordo.
    if (prudent && this.s.incidents.length > 0 && this.heading === 'out') this.goHome('incident');
    if (this.heading === 'home') {
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
          this.evas.push({ durationS: duration, returned: true, value, kg, worldId: surface.worldId, index: this.evasHere, suitO2Pct: m.suitO2Pct, endReason: this.endReason });
        }
        return;
      }
      this.moveToward(surface, m, 0, 0);
      return;
    }

    // Elegir veta: la más rentable que quepa y a la que dé tiempo a ir, recoger y volver.
    const room = rules.suit.carryCapacityKg - m.carriedKg;
    let best: { d: Deposit; score: number } | null = null;
    for (const d of surface.deposits) {
      if (d.units <= 0) continue;
      const mat = getMaterial(d.materialId);
      if (mat.massKg > room + 1e-9) continue;
      const inZone = surface.zones.some((z) => !z.collapsed && Math.hypot(d.x - z.x, d.z - z.z) <= z.radiusM);
      if (!this.daring && inZone) continue;
      const go = Math.hypot(d.x - m.x, d.z - m.z) / BOT_WALK_MPS;
      const back = Math.hypot(d.x, d.z) / BOT_WALK_MPS;
      const cost = (go + mat.collectS + back) * rate + margin;
      if (cost > m.suitO2Pct) continue;
      // Ir primero a lo lejano y volver recogiendo: solo pesa lo que te aleja de la nave.
      const away = Math.max(0, back - homeDist / BOT_WALK_MPS);
      // La capacidad es poca: también cuenta lo que vale cada kilo.
      // Si la nave va justa de combustible, el hielo vale más (lo que rinde a bordo).
      // Lo raro se revaloriza con la racha que ya lleva encima.
      const worth = d.valuePerUnit * (mat.streak ? m.streakMult : 1) + (this.fuelNeed(m) > 0 ? (mat.yields?.fuel ?? 0) * 8 : 0);
      const perKg = Math.sqrt(worth / mat.massKg);
      const score = (worth * perKg * (this.daring ? 1.5 + (d.risky ? 1 : 0) : 1)) / (go + away + mat.collectS + 4);
      if (!best || score > best.score) best = { d, score };
    }
    if (!best) {
      const fits = surface.deposits.some((d) => d.units > 0 && getMaterial(d.materialId).massKg <= room);
      this.goHome(room < 6 || !fits ? 'full' : 'o2');
      return;
    }
    if (this.target !== best.d.id && this.target !== null) {
      const cur = surface.deposits.find((d) => d.id === this.target);
      if (cur && cur.units > 0 && getMaterial(cur.materialId).massKg <= room) best = { d: cur, score: 0 };
    }
    this.target = best.d.id;
    const d = best.d;
    if (Math.hypot(d.x - m.x, d.z - m.z) <= rules.suit.collectRangeM * 0.8) {
      this.climbing = false;
      if (!m.grounded) this.run.apply({ type: 'set-position', x: m.x, z: m.z, grounded: true }); // recoger exige suelo
      const r = this.run.apply({ type: 'collect', depositId: d.id, seconds: FIXED_STEP_S });
      if (!r.ok) this.target = null;
      return;
    }
    this.moveToward(surface, m, d.x, d.z);
  }

  /** Camina hacia (x, z); sobre terreno inestable, salvo que se arriesgue, cruza con el jetpack. */
  private moveToward(surface: SurfaceState, m: CrewMember, x: number, z: number): void {
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
    if (m && !m.alive && m.location === 'eva' && !this.evas.some((e) => !e.returned)) this.evas.push({ durationS: m.evaS, returned: false, value: 0, kg: 0, worldId: this.s.surface?.worldId ?? '', index: this.evasHere, suitO2Pct: 0, endReason: 'dead' });
  }
}
