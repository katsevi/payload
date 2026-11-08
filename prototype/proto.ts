/**
 * Prototipo de compromisos de la fase 0 (CLI) — usa el motor REAL de packages/shared.
 *
 * Uso (desde la raíz del repo):
 *   pnpm proto                                   # todos los diseños de prototype/designs/
 *   pnpm proto --design prototype/designs/ok-cubesat-leo.json
 *   pnpm proto --design ok-cubesat-leo --design fail-data-uhf   # nombre corto = prototype/designs/<n>.json
 *   pnpm proto --seed 7                          # semilla de la simulación (por defecto la del escenario)
 *   pnpm proto --lang en                         # textos en inglés
 *   pnpm proto --events                          # lista también los eventos notables de la operación
 *   pnpm proto --brief                           # solo la tabla resumen
 *
 * Un diseño es un JSON con formato MissionDesign:
 *   { "scenarioId": "leo-earth-observation", "componentIds": [...], "orbitId": "LEO", "launcherId": "launcher-colibri" }
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeBudgets,
  formatMessage,
  getScenario,
  reviewGoNoGo,
  runMission,
  type Locale,
  type MessageRef,
  type MissionDesign,
  type ResourceStatus,
} from '../packages/shared/src/index.ts';

const here: string = typeof __dirname !== 'undefined' ? __dirname : dirname(fileURLToPath(import.meta.url));
const designsDir = join(here, 'designs');
// pnpm ejecuta el script desde packages/shared; INIT_CWD es el directorio desde el que se lanzó.
const userCwd = process.env.INIT_CWD ?? process.cwd();

// ─── Argumentos ─────────────────────────────────────────────────────────────

const argv = process.argv.slice(2).filter((a) => a !== '--');
const designArgs: string[] = [];
let seed: number | undefined;
let lang: Locale = 'es';
let showEvents = false;
let brief = false;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]!;
  if (a === '--design' || a === '-d') designArgs.push(argv[++i] ?? '');
  else if (a === '--seed' || a === '-s') seed = Number(argv[++i]);
  else if (a === '--lang') lang = argv[++i] === 'en' ? 'en' : 'es';
  else if (a === '--events') showEvents = true;
  else if (a === '--brief') brief = true;
  else if (a === '--help' || a === '-h') {
    console.log(readFileSync(join(here, 'proto.ts'), 'utf8').split('*/')[0]);
    process.exit(0);
  } else {
    console.error(`Argumento desconocido: ${a} (usa --help)`);
    process.exit(1);
  }
}
if (seed !== undefined && !Number.isFinite(seed)) {
  console.error('--seed debe ser un número');
  process.exit(1);
}

function resolveDesignPath(arg: string): string {
  const candidates = [
    isAbsolute(arg) ? arg : resolve(userCwd, arg),
    resolve(process.cwd(), arg),
    join(designsDir, arg),
    join(designsDir, `${arg}.json`),
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    console.error(`No encuentro el diseño "${arg}". Probé:\n  ${candidates.join('\n  ')}`);
    process.exit(1);
  }
  return found;
}

const designPaths = designArgs.length
  ? designArgs.map(resolveDesignPath)
  : readdirSync(designsDir)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .map((f) => join(designsDir, f));

// ─── Formato ────────────────────────────────────────────────────────────────

const tty = process.stdout.isTTY;
const color = (code: number, s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const green = (s: string) => color(32, s);
const amber = (s: string) => color(33, s);
const red = (s: string) => color(31, s);
const bold = (s: string) => color(1, s);
const dim = (s: string) => color(2, s);
const t = (m: MessageRef) => formatMessage(m, lang);
const L = (es: string, en: string) => (lang === 'es' ? es : en);

const statusColor = (s: ResourceStatus, text: string) => (s === 'ok' ? green(text) : s === 'tight' ? amber(text) : red(text));
const num = (x: number, d = 1) => (Math.abs(x) >= 1000 ? Math.round(x).toLocaleString('en-US') : x.toFixed(d));

/** Tabla con columnas alineadas; las celdas pueden traer códigos de color ANSI. */
function table(headers: string[], rows: string[][]): string {
  const visible = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '').length;
  const widths = headers.map((h, i) => Math.max(visible(h), ...rows.map((r) => visible(r[i] ?? ''))));
  const pad = (s: string, w: number, right: boolean) => {
    const fill = ' '.repeat(Math.max(0, w - visible(s)));
    return right ? fill + s : s + fill;
  };
  const line = (cells: string[]) =>
    '  ' + cells.map((c, i) => pad(c, widths[i]!, i > 0 && i < cells.length - 1 && /^[-\d.,%]/.test(c.replace(/\x1b\[[0-9;]*m/g, '')))).join('  ');
  return [bold(line(headers)), '  ' + widths.map((w) => '─'.repeat(w)).join('  '), ...rows.map(line)].join('\n');
}

// ─── Ejecución ──────────────────────────────────────────────────────────────

interface Summary {
  name: string;
  go: boolean;
  limiting: string;
  status: string;
  days: string;
  dataPerDay: string;
  score: string;
}
const summaries: Summary[] = [];

for (const path of designPaths) {
  const name = basename(path, '.json');
  let design: MissionDesign;
  try {
    design = JSON.parse(readFileSync(path, 'utf8')) as MissionDesign;
  } catch (e) {
    console.error(red(`${name}: JSON inválido (${(e as Error).message})`));
    continue;
  }
  const scenario = getScenario(design.scenarioId);
  const budgets = computeBudgets(design);
  const review = reviewGoNoGo(design);
  const result = runMission(design, undefined, seed !== undefined ? { seed } : {});

  summaries.push({
    name,
    go: review.go,
    limiting: budgets.limiting ? t({ key: `resource.${budgets.limiting}` }) : '-',
    status: result.status,
    days: result.daysOperated.toFixed(1),
    dataPerDay: num(result.dataDownlinkedMbit / scenario.operationDays, 0),
    score: result.score.total.toFixed(1),
  });
  if (brief) continue;

  console.log('\n' + bold('═'.repeat(100)));
  console.log(bold(`${name}`) + dim(`  ·  ${scenario.name[lang]}  ·  ${design.orbitId ?? '-'}  ·  ${design.launcherId ?? '-'}  ·  ${design.componentIds.length} ${L('piezas', 'parts')}  ·  seed ${result.seed}`));

  // Presupuestos
  console.log('\n' + bold(L('Presupuestos', 'Budgets')) + (budgets.limiting ? dim(`  (${L('limita', 'limiting')}: ${t({ key: `resource.${budgets.limiting}` })})`) : ''));
  console.log(
    table(
      [L('Recurso', 'Resource'), L('Usado', 'Used'), L('Disponible', 'Available'), L('Unidad', 'Unit'), L('Margen', 'Margin'), L('Estado', 'Status')],
      budgets.resources.map((r) => [
        t({ key: `resource.${r.id}` }),
        num(r.used),
        num(r.available),
        t({ key: `unit.${r.unit}` }),
        statusColor(r.status, `${(r.margin * 100).toFixed(0)}%`),
        statusColor(r.status, t({ key: `status.${r.status}` })),
      ]),
    ),
  );
  const o = budgets.orbit;
  if (o) {
    console.log(dim(`  ${L('Órbita', 'Orbit')}: T = ${o.periodMin.toFixed(1)} min · ${L('sombra', 'shadow')} ${o.eclipseMin.toFixed(1)} min (${(o.eclipseFraction * 100).toFixed(0)}%) · ${L('contacto', 'contact')} ${o.contactMinPerDayPerStation.toFixed(1)} min/${L('día', 'day')}/${L('estación', 'station')} · ${L('resolución', 'resolution')} ${budgets.totals.groundResolutionM?.toFixed(1) ?? '-'} m · ${L('vida', 'lifetime')} ${budgets.totals.lifetimeYears.toFixed(1)} ${L('años', 'years')}`));
  }

  // Go/No-Go
  console.log('\n' + bold('Go/No-Go: ') + (review.go ? green('GO') : red('NO-GO')));
  for (const i of review.issues) {
    const tag = i.severity === 'blocker' ? red('✖ blocker') : i.severity === 'warning' ? amber('▲ warning') : green('● info   ');
    console.log(`  ${tag}  ${t(i.message)}`);
  }

  // Simulación
  console.log('\n' + bold(L('Simulación', 'Simulation')) + dim(` (${L('aunque sea No-Go, para ver qué pasaría', 'even if No-Go, to see what would happen')})`));
  const st = result.status === 'complete' ? green(result.status) : result.status === 'failed' ? red(result.status) : amber(result.status);
  console.log(
    `  ${L('Lanzamiento', 'Launch')}: ${result.launchSuccess ? green('OK') : red(L('FALLO', 'FAILED'))} · ${L('estado', 'status')}: ${st} · ${L('días', 'days')}: ${result.daysOperated.toFixed(1)}/${scenario.operationDays}` +
      ` · ${L('bajados', 'downlinked')}: ${num(result.dataDownlinkedMbit, 0)} Mbit · ${L('perdidos', 'lost')}: ${num(result.dataLostMbit, 0)} Mbit · ${L('batería mín.', 'min battery')}: ${result.minBatteryPct.toFixed(0)}%`,
  );
  const sc = result.score;
  console.log(`  ${L('Puntuación', 'Score')}: ${bold(sc.total.toFixed(1))}  (${L('objetivos', 'objectives')} ${sc.objectives} · ${L('ciencia', 'science')} ${sc.science} · ${L('eficiencia', 'efficiency')} ${sc.efficiency} · ${L('colaboración', 'collaboration')} ${sc.collaboration})`);

  if (showEvents) {
    const notable = result.events.filter((e) => !/^(eclipse|contact)-/.test(e.type));
    console.log('\n' + bold(L('Eventos', 'Events')) + dim(` (${result.events.length - notable.length} ${L('de eclipse/contacto omitidos', 'eclipse/contact events omitted')})`));
    for (const e of notable) console.log(`  ${dim(`${(e.tSeconds / 3600).toFixed(1).padStart(6)} h`)}  ${t(e.message)}`);
  }

  // Informe
  console.log('\n' + bold(L('Informe', 'Report')));
  for (const e of result.report) {
    const tag = e.severity === 'success' ? green('✔') : e.severity === 'failure' ? red('✖') : e.severity === 'warning' ? amber('▲') : dim('•');
    console.log(`  ${tag} ${t(e.message)}`);
    for (const c of e.causes) console.log(dim(`      ← ${t(c)}`));
    if (e.suggestion) console.log(`      → ${t(e.suggestion)}`);
  }
}

// ─── Resumen ────────────────────────────────────────────────────────────────

console.log('\n' + bold(L('Resumen', 'Summary')) + dim(seed !== undefined ? ` (seed ${seed})` : ` (${L('semilla del escenario', 'scenario seed')})`));
console.log(
  table(
    [L('Diseño', 'Design'), 'Go', L('Limita', 'Limiting'), L('Resultado', 'Result'), L('Días', 'Days'), 'Mbit/' + L('día', 'day'), L('Puntos', 'Score')],
    summaries.map((s) => [
      s.name,
      s.go ? green('GO') : red('NO-GO'),
      s.limiting,
      s.status === 'complete' ? green(s.status) : s.status === 'failed' ? red(s.status) : amber(s.status),
      s.days,
      s.dataPerDay,
      s.score,
    ]),
  ),
);
