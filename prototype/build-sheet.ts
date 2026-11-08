/**
 * Genera prototype/payload-prototipo.xlsx: prototipo de compromisos de Payload en hoja de cálculo.
 *
 * Uso (desde la raíz del repo):
 *   pnpm --filter @payload/shared exec tsx ../../prototype/build-sheet.ts
 *   ... build-sheet.ts --catalog <dir>   (dir con componentes/orbitas/lanzadores/escenarios .json)
 *   ... build-sheet.ts --out <archivo.xlsx>
 *
 * Lee el catálogo real (packages/shared/catalog) y NO contiene datos de catálogo propios.
 * La hoja "Diseño" usa fórmulas reales de Excel; el modelo es una simplificación del motor
 * (ver hoja "Léame"): sirve para probar compromisos, no para sustituir a computeBudgets().
 */
import ExcelJS from 'exceljs';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  MissionDesign,
  ComponentDef,
  OrbitDef,
  LauncherDef,
  ScenarioDef,
  OrbitId,
} from '../packages/shared/src/types';

const here: string =
  typeof __dirname !== 'undefined' ? __dirname : dirname(fileURLToPath(import.meta.url));

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const catalogDir = resolve(arg('catalog') ?? join(here, '..', 'packages', 'shared', 'catalog'));
const designArg = arg('design') ?? join(here, 'designs', 'ok-cubesat-leo.json');
const outFile = resolve(arg('out') ?? join(here, 'payload-prototipo.xlsx'));

function load<T>(file: string, key: string): T[] {
  const p = join(catalogDir, file);
  if (!existsSync(p)) {
    throw new Error(`No existe ${p}. Pasa --catalog <dir> o espera a que exista el catálogo real.`);
  }
  const raw: unknown = JSON.parse(readFileSync(p, 'utf8'));
  if (Array.isArray(raw)) return raw as T[];
  const inner = (raw as Record<string, unknown>)[key];
  if (Array.isArray(inner)) return inner as T[];
  throw new Error(`${p}: se esperaba un arreglo (o un objeto con la clave "${key}")`);
}

const components = load<ComponentDef>('componentes.json', 'components');
const orbits = load<OrbitDef>('orbitas.json', 'orbits');
const launchers = load<LauncherDef>('lanzadores.json', 'launchers');
const scenarios = load<ScenarioDef>('escenarios.json', 'scenarios');

const ORBIT_IDS: OrbitId[] = ['LEO', 'SSO', 'MEO', 'GEO', 'HEO', 'TLI'];

// ─── Utilidades de hoja ─────────────────────────────────────────────────────

const HEAD_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF1F2A44' },
};
const INPUT_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFFFF6D6' },
};

function colName(n: number): string {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function styleHeader(row: ExcelJS.Row): void {
  row.eachCell((c) => {
    c.fill = HEAD_FILL;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.alignment = { vertical: 'middle', wrapText: true };
  });
  row.height = 32;
}

interface Col<T> {
  header: string;
  width?: number;
  get: (t: T) => string | number | null | undefined;
}

function tableSheet<T>(wb: ExcelJS.Workbook, name: string, rows: T[], cols: Col<T>[]): ExcelJS.Worksheet {
  const ws = wb.addWorksheet(name);
  ws.addRow(cols.map((c) => c.header));
  styleHeader(ws.getRow(1));
  cols.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.width ?? 12;
  });
  for (const r of rows) {
    ws.addRow(cols.map((c) => c.get(r) ?? null));
  }
  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 1 }];
  return ws;
}

// ─── Hojas de catálogo ──────────────────────────────────────────────────────

const wb = new ExcelJS.Workbook();
wb.creator = 'Payload · prototipo de fase 0';
const rd = wb.addWorksheet('Léame');
const ds = wb.addWorksheet('Diseño', { views: [{ state: 'frozen', ySplit: 1 }] });

type CompCol = Col<ComponentDef> & { key: string };
const compCols: CompCol[] = [
  { key: 'id', header: 'id', width: 22, get: (c) => c.id },
  { key: 'subsystem', header: 'Subsistema', width: 12, get: (c) => c.subsystem },
  { key: 'name', header: 'Nombre', width: 30, get: (c) => c.name.es },
  { key: 'level', header: 'Nivel', width: 10, get: (c) => c.level },
  { key: 'massKg', header: 'Masa (kg)', get: (c) => c.massKg },
  { key: 'powerW', header: 'Consumo (W)', get: (c) => c.powerW },
  { key: 'costMUSD', header: 'Costo (M USD)', get: (c) => c.costMUSD },
  { key: 'data', header: 'Datos (Mbit/día)', get: (c) => c.dataMbitPerDay },
  { key: 'science', header: 'Valor científico', get: (c) => c.scienceValue },
  { key: 'reliability', header: 'Fiabilidad', get: (c) => c.reliability },
  { key: 'devMonths', header: 'Desarrollo (meses)', get: (c) => c.devMonths },
  { key: 'solarW', header: 'Generación solar (W)', get: (c) => c.solarGenerationW },
  { key: 'batWh', header: 'Batería (Wh)', get: (c) => c.batteryCapacityWh },
  { key: 'dod', header: 'DoD máx.', get: (c) => c.maxDepthOfDischarge },
  { key: 'downMbps', header: 'Bajada (Mbit/s)', get: (c) => c.downlinkMbps },
  { key: 'storage', header: 'Almacén (Mbit)', get: (c) => c.storageMbit },
  { key: 'maxMass', header: 'Masa máx. soportada (kg)', get: (c) => c.maxSupportedMassKg },
  { key: 'slots', header: 'Puntos de montaje', get: (c) => c.mountSlots },
  { key: 'pointing', header: 'Precisión apuntado (°)', get: (c) => c.pointingAccuracyDeg },
  { key: 'thermalW', header: 'Disipación (W)', get: (c) => c.thermalDissipationW },
  { key: 'res500', header: 'Resolución a 500 km (m)', get: (c) => c.groundResolutionAt500KmM },
  { key: 'reqPointing', header: 'Apuntado requerido (°)', get: (c) => c.requiredPointingDeg },
  { key: 'why', header: '¿Por qué?', width: 60, get: (c) => c.why.es },
];
const CC: Record<string, string> = {};
compCols.forEach((c, i) => (CC[c.key] = colName(i + 1)));
tableSheet(wb, 'Componentes', components, compCols);

// Órbitas: datos + columnas calculadas con fórmulas (Kepler)
const orbSheet = tableSheet<OrbitDef>(wb, 'Órbitas', orbits, [
  { header: 'id', width: 8, get: (o) => o.id },
  { header: 'Nombre', width: 28, get: (o) => o.name.es },
  { header: 'Perigeo (km)', get: (o) => o.perigeeKm },
  { header: 'Apogeo (km)', get: (o) => o.apogeeKm },
  { header: 'Inclinación (°)', get: (o) => o.inclinationDeg },
  { header: 'Radiación (0-1)', get: (o) => o.radiationFactor },
  { header: 'Vida por arrastre (años)', get: (o) => o.dragLifetimeYears },
  { header: 'Revisita (días)', get: (o) => o.revisitDays },
]);
const OR = { first: 2, last: orbits.length + 1 };
const orbCalc = ['Altitud media (km)', 'Semieje a (km)', 'Periodo (min)', 'Fracción de eclipse', 'Eclipse (min)', 'Órbitas por día', 'Contacto (min/día/estación)'];
orbCalc.forEach((h, i) => {
  const c = orbSheet.getCell(1, 9 + i);
  c.value = h;
  orbSheet.getColumn(9 + i).width = 15;
});
styleHeader(orbSheet.getRow(1));
for (let r = OR.first; r <= OR.last; r++) {
  orbSheet.getCell(`I${r}`).value = { formula: `(C${r}+D${r})/2` };
  orbSheet.getCell(`J${r}`).value = { formula: `'Diseño'!$B$12+I${r}` };
  orbSheet.getCell(`K${r}`).value = { formula: `2*PI()*SQRT(J${r}^3/'Diseño'!$B$13)/60` };
  orbSheet.getCell(`L${r}`).value = { formula: `ASIN('Diseño'!$B$12/('Diseño'!$B$12+I${r}))/PI()` };
  orbSheet.getCell(`M${r}`).value = { formula: `K${r}*L${r}` };
  orbSheet.getCell(`N${r}`).value = { formula: `1440/K${r}` };
  orbSheet.getCell(`O${r}`).value = {
    formula:
      `IF(AND(ABS(D${r}-C${r})<100,ABS(K${r}-1436.07)<10),1440,` +
      `MIN(1440,1440*(1-COS(MAX(0,ACOS('Diseño'!$B$12*COS(RADIANS('Diseño'!$B$10))/('Diseño'!$B$12+I${r}))-RADIANS('Diseño'!$B$10))))/2*'Diseño'!$B$11))`,
  };
  orbSheet.getCell(`K${r}`).numFmt = '0.0';
  orbSheet.getCell(`L${r}`).numFmt = '0.000';
  orbSheet.getCell(`M${r}`).numFmt = '0.0';
  orbSheet.getCell(`N${r}`).numFmt = '0.0';
  orbSheet.getCell(`O${r}`).numFmt = '0.0';
}
orbSheet.getCell(`A${OR.last + 2}`).value =
  'Columnas I-O: fórmulas de Excel. Periodo T = 2π√(a³/μ); eclipse (peor caso, beta = 0) = asin(R/(R+h))/π. Contacto por estación (col. O) = 1440·(1−cos λ)/2·K con λ = acos(R·cos ε/(R+h)) − ε (ε = elevación mínima, K = factor de latitud; GEO = 1440). Órbitas elípticas: altitud media (igual que el motor).';

// Lanzadores: capacidad por órbita en columnas
const launchCols: Col<LauncherDef>[] = [
  { header: 'id', width: 22, get: (l) => l.id },
  { header: 'Nombre', width: 28, get: (l) => l.name.es },
  { header: 'Costo (M USD)', get: (l) => l.costMUSD },
  { header: 'Fiabilidad', get: (l) => l.reliability },
  { header: 'Espera (meses)', get: (l) => l.leadTimeMonths },
  ...ORBIT_IDS.map<Col<LauncherDef>>((o) => ({
    header: o,
    width: 9,
    get: (l) => l.capacityKg[o] ?? null,
  })),
];
tableSheet(wb, 'Lanzadores', launchers, launchCols);
const LR = { first: 2, last: launchers.length + 1 };
wb.getWorksheet('Lanzadores')!.getCell(`A${LR.last + 2}`).value =
  'Columnas F-K: capacidad de carga en kg por órbita; celda vacía = el lanzador no llega a esa órbita.';

// Escenarios
const scCols: Col<ScenarioDef>[] = [
  { header: 'id', width: 22, get: (s) => s.id },
  { header: 'Nombre', width: 28, get: (s) => s.name.es },
  { header: 'Tipo', width: 18, get: (s) => s.missionType },
  { header: 'Dificultad', get: (s) => s.difficulty },
  { header: 'Presupuesto (M USD)', get: (s) => s.budgetMUSD },
  { header: 'Desarrollo máx. (meses)', get: (s) => s.maxDevMonths },
  { header: 'Resolución máx. (m)', get: (s) => s.requirements.maxGroundResolutionM },
  { header: 'Bajada mín. (Mbit/día)', get: (s) => s.requirements.minDownlinkMbitPerDay },
  { header: 'Vida mín. (años)', get: (s) => s.requirements.minLifetimeYears },
  { header: 'Revisita máx. (días)', get: (s) => s.requirements.maxRevisitDays },
  { header: 'Ciencia mín.', get: (s) => s.requirements.minScienceValue },
  { header: 'Órbitas permitidas', width: 22, get: (s) => s.allowedOrbits.join(',') },
  { header: 'Lanzadores permitidos', width: 40, get: (s) => s.allowedLaunchers.join(',') },
  { header: 'Estaciones terrestres', get: (s) => s.groundStations },
  { header: 'Días de operación', get: (s) => s.operationDays },
  { header: 'Costo operación (M USD/año)', get: (s) => s.operationsCostMUSDPerYear },
  { header: 'Componentes permitidos', width: 40, get: (s) => s.allowedComponents?.join(',') },
  { header: 'Briefing', width: 70, get: (s) => s.briefing.es },
];
tableSheet(wb, 'Escenarios', scenarios, scCols);
const SR = { first: 2, last: scenarios.length + 1 };

// ─── Hoja Diseño ────────────────────────────────────────────────────────────

ds.getColumn(1).width = 36;
ds.getColumn(2).width = 16;
ds.getColumn(3).width = 14;
for (let c = 4; c <= 18; c++) ds.getColumn(c).width = 14;
ds.getColumn(4).width = 34;

ds.getCell('A1').value = 'Payload · Prototipo de compromisos (hoja de cálculo)';
ds.getCell('A1').font = { bold: true, size: 14 };
ds.getCell('D1').value = 'Celdas amarillas = tus decisiones. Todo lo demás son fórmulas.';
ds.getCell('D1').font = { italic: true };

const sec = (cell: string, text: string) => {
  const c = ds.getCell(cell);
  c.value = text;
  c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  c.fill = HEAD_FILL;
};
const label = (r: number, text: string) => (ds.getCell(`A${r}`).value = text);
const input = (ref: string, value: ExcelJS.CellValue) => {
  const c = ds.getCell(ref);
  c.value = value;
  c.fill = INPUT_FILL;
  c.font = { bold: true, color: { argb: 'FF0B3D91' } };
  c.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  return c;
};

// Selección (B3:B6)
sec('A2', 'Selección');
sec('B2', '');
label(3, 'Escenario');
label(4, 'Órbita');
label(5, 'Lanzador');
label(6, 'Estaciones terrestres');
const scIds = `Escenarios!$A$${SR.first}:$A$${SR.last}`;
input('B3', scenarios[0]?.id ?? '').dataValidation = { type: 'list', allowBlank: false, formulae: [scIds] };
input('B4', '').dataValidation = {
  type: 'list',
  allowBlank: true,
  formulae: [`'Órbitas'!$A$${OR.first}:$A$${OR.last}`],
};
input('B5', '').dataValidation = {
  type: 'list',
  allowBlank: true,
  formulae: [`Lanzadores!$A$${LR.first}:$A$${LR.last}`],
};
input('B6', { formula: `INDEX(Escenarios!$N$${SR.first}:$N$${SR.last},MATCH($B$3,${scIds},0))` });
ds.getCell('C3').value = '← lista';
ds.getCell('C4').value = '← lista';
ds.getCell('C5').value = '← lista';
ds.getCell('C6').value = '(editable)';

// Parámetros (B9:B13)
sec('A8', 'Parámetros del modelo');
sec('B8', '');
label(9, 'Umbral "Justo" (margen < x)');
input('B9', 0.15).numFmt = '0%';
ds.getCell('C9').value = 'TIGHT_MARGIN del motor';
label(10, 'Elevación mínima de la estación (°)');
input('B10', 10);
label(11, 'Factor de latitud de estaciones (K)');
input('B11', 2);
ds.getCell('C10').value = 'como el motor';
ds.getCell('C11').value = 'como el motor';
label(12, 'Radio de la Tierra (km)');
ds.getCell('B12').value = 6371;
label(13, 'μ Tierra (km³/s²)');
ds.getCell('B13').value = 398600;

// Órbita seleccionada
sec('A15', 'Órbita seleccionada (Kepler)');
sec('B15', '');
const orbLook = (col: string) =>
  `IF($B$4="","",INDEX('Órbitas'!$${col}$${OR.first}:$${col}$${OR.last},MATCH($B$4,'Órbitas'!$A$${OR.first}:$A$${OR.last},0)))`;
const orbRows: [string, string, string][] = [
  ['Altitud media (km)', 'I', '0'],
  ['Periodo (min)', 'K', '0.0'],
  ['Fracción de eclipse', 'L', '0.000'],
  ['Eclipse (min)', 'M', '0.0'],
  ['Órbitas por día', 'N', '0.0'],
  ['Contacto (min/día/estación)', 'O', '0.0'],
  ['Revisita (días)', 'H', '0'],
];
orbRows.forEach(([text, col, fmt], i) => {
  label(16 + i, text);
  const c = ds.getCell(`B${16 + i}`);
  c.value = { formula: orbLook(col) };
  c.numFmt = fmt;
});
// B16 alt media, B17 T, B18 ecl frac, B19 ecl min, B20 orb/día, B21 contacto, B22 revisita
label(23, 'Radiación (0-1)');
ds.getCell('B23').value = { formula: orbLook('F') };
label(24, 'Vida por arrastre (años; 99 = ilimitada)');
ds.getCell('B24').value = { formula: `IF($B$4="","",IF(${orbLook('G')}="",99,${orbLook('G')}))` };
label(25, 'Altitud de perigeo (km, para resolución)');
ds.getCell('B25').value = { formula: orbLook('C') };

// Escenario seleccionado
sec('A26', 'Escenario y derivados');
sec('B26', '');
const scLook = (col: string) => {
  const idx = `INDEX(Escenarios!$${col}$${SR.first}:$${col}$${SR.last},MATCH($B$3,${scIds},0))`;
  return `IF(${idx}="","",${idx})`;
};
const scRows: [string, string][] = [
  ['Presupuesto (M USD)', 'E'],
  ['Desarrollo máx. (meses)', 'F'],
  ['Resolución máx. (m)', 'G'],
  ['Bajada mín. (Mbit/día)', 'H'],
  ['Vida mín. (años)', 'I'],
  ['Revisita máx. (días)', 'J'],
  ['Ciencia mín.', 'K'],
  ['Órbitas permitidas', 'L'],
  ['Lanzadores permitidos', 'M'],
];
scRows.forEach(([text, col], i) => {
  label(27 + i, text);
  ds.getCell(`B${27 + i}`).value = { formula: scLook(col) };
});
// B27 pres, B28 dev, B29 res, B30 bajada, B31 vida, B32 revisita, B33 ciencia, B34 orbs, B35 lanz
const lcapRaw = `INDEX(Lanzadores!$F$${LR.first}:$K$${LR.last},MATCH($B$5,Lanzadores!$A$${LR.first}:$A$${LR.last},0),MATCH($B$4,Lanzadores!$F$1:$K$1,0))`;
const lcost = `INDEX(Lanzadores!$C$${LR.first}:$C$${LR.last},MATCH($B$5,Lanzadores!$A$${LR.first}:$A$${LR.last},0))`;
const llead = `INDEX(Lanzadores!$E$${LR.first}:$E$${LR.last},MATCH($B$5,Lanzadores!$A$${LR.first}:$A$${LR.last},0))`;

// Tabla de componentes
const CT = 46; // fila de encabezado
const first = CT + 1;
const last = CT + components.length;
const TOT = last + 1;
const rg = (col: string) => `$${col}$${first}:$${col}$${last}`;

label(36, 'Capacidad del lanzador en la órbita (kg)');
ds.getCell('B36').value = { formula: `IF(OR($B$4="",$B$5=""),"",IFERROR(N(${lcapRaw}),0))` };
label(37, 'Masa máx. de la estructura (kg)');
ds.getCell('B37').value = { formula: `IF(COUNT(${rg('M')})=0,"",MAX(${rg('M')}))` };
label(38, 'Vida por fiabilidad y radiación (años)');
ds.getCell('B38').value = {
  formula:
    `IF(OR($B$4="",SUM(${rg('B')})=0),"",IF(PRODUCT(${rg('Q')})^(1+2*$B$23)>=1,30,` +
    `MIN(30,5*LN(0.7)/LN(PRODUCT(${rg('Q')})^(1+2*$B$23)))))`,
};
ds.getCell('B38').numFmt = '0.0';
label(39, 'Costo de operación (M USD/año; 1 si no se define)');
ds.getCell('B39').value = { formula: `IF(${scLook('P')}="",1,${scLook('P')})` };
label(40, 'Componentes permitidos (vacío = todos)');
ds.getCell('B40').value = { formula: scLook('Q') };
label(41, 'Piezas montadas / puntos de montaje');
ds.getCell('B41').value = { formula: `SUM(${rg('B')})-SUMIFS(${rg('B')},${rg('C')},"structure")` };
ds.getCell('C41').value = { formula: `IF(COUNT(${rg('S')})=0,"",MAX(${rg('S')}))` };
label(42, 'Estructuras montadas');
ds.getCell('B42').value = { formula: `SUMIFS(${rg('B')},${rg('C')},"structure")` };

sec('A44', 'Tabla de componentes: escribe la cantidad (0, 1, 2...) en la columna B');
const headers = [
  'Componente', 'Cantidad', 'Subsistema', 'id', 'Masa (kg)', 'Consumo (W)', 'Costo (M USD)', 'Datos (Mbit/día)',
  'Ciencia', 'Solar (W)', 'Batería útil (Wh)', 'Bajada (Mbit/s)', 'Masa soportada (kg)', 'Resolución a 500 km (m)',
  'Apuntado nave (°)', 'Apuntado req. (°)', 'Fiab.^cant.', 'Desarrollo (meses)', 'Puntos de montaje',
  'Almacén (Mbit)', 'Disipación (W)', 'Permitido (1/0)',
];
headers.forEach((h, i) => (ds.getCell(CT, i + 1).value = h));
styleHeader(ds.getRow(CT));

// Cantidades del diseño precargado
const designPath = existsSync(designArg) ? designArg : join(here, 'designs', `${designArg.replace(/\.json$/, '')}.json`);
const preload: MissionDesign | null = existsSync(designPath)
  ? (JSON.parse(readFileSync(designPath, 'utf8')) as MissionDesign)
  : null;
const qtyOf = (id: string) => preload?.componentIds.filter((x) => x === id).length ?? 0;
if (preload) {
  ds.getCell('B3').value = preload.scenarioId;
  ds.getCell('B4').value = preload.orbitId ?? '';
  ds.getCell('B5').value = preload.launcherId ?? '';
}

components.forEach((comp, i) => {
  const r = first + i;
  const cr = i + 2;
  const k = (key: string) => `Componentes!$${CC[key]}$${cr}`;
  const onlyIf = (key: string) => `IF(AND($B${r}>0,${k(key)}<>""),${k(key)},"")`;
  ds.getCell(`A${r}`).value = { formula: `Componentes!$${CC.name}$${cr}` };
  const q = input(`B${r}`, qtyOf(comp.id));
  q.dataValidation = {
    type: 'whole', operator: 'between', formulae: [0, 20], showErrorMessage: true,
    errorTitle: 'Cantidad', error: 'Entero entre 0 y 20',
  };
  ds.getCell(`C${r}`).value = { formula: k('subsystem') };
  ds.getCell(`D${r}`).value = { formula: k('id') };
  ds.getCell(`E${r}`).value = { formula: `$B${r}*${k('massKg')}` };
  ds.getCell(`F${r}`).value = { formula: `$B${r}*${k('powerW')}` };
  ds.getCell(`G${r}`).value = { formula: `$B${r}*${k('costMUSD')}` };
  ds.getCell(`H${r}`).value = { formula: `$B${r}*${k('data')}` };
  ds.getCell(`I${r}`).value = { formula: `$B${r}*${k('science')}` };
  ds.getCell(`J${r}`).value = { formula: `$B${r}*${k('solarW')}` };
  ds.getCell(`K${r}`).value = { formula: `$B${r}*${k('batWh')}*IF(${k('dod')}="",1,${k('dod')})` };
  ds.getCell(`L${r}`).value = { formula: onlyIf('downMbps') };
  ds.getCell(`M${r}`).value = { formula: onlyIf('maxMass') };
  ds.getCell(`N${r}`).value = { formula: onlyIf('res500') };
  ds.getCell(`O${r}`).value = { formula: onlyIf('pointing') };
  ds.getCell(`P${r}`).value = { formula: onlyIf('reqPointing') };
  ds.getCell(`Q${r}`).value = { formula: `${k('reliability')}^$B${r}` };
  ds.getCell(`R${r}`).value = { formula: `IF($B${r}>0,${k('devMonths')},"")` };
  ds.getCell(`S${r}`).value = { formula: onlyIf('slots') };
  ds.getCell(`T${r}`).value = { formula: `$B${r}*${k('storage')}` };
  ds.getCell(`U${r}`).value = { formula: `$B${r}*${k('thermalW')}` };
  ds.getCell(`V${r}`).value = {
    formula: `IF($B${r}=0,1,IF($B$40="",1,IF(ISNUMBER(SEARCH(","&${k('id')}&",",","&$B$40&",")),1,0)))`,
  };
  ds.getCell(`Q${r}`).numFmt = '0.000';
});
ds.getCell(`A${TOT}`).value = 'Totales (suma o máximo según la columna)';
ds.getCell(`A${TOT}`).font = { bold: true };
for (const col of ['E', 'F', 'G', 'H', 'I', 'J', 'K', 'T', 'U']) {
  const c = ds.getCell(`${col}${TOT}`);
  c.value = { formula: `SUM(${col}${first}:${col}${last})` };
  c.font = { bold: true };
}
for (const col of ['L', 'M', 'R', 'S']) {
  const c = ds.getCell(`${col}${TOT}`);
  c.value = { formula: `IF(COUNT(${rg(col)})=0,"",MAX(${rg(col)}))` };
  c.font = { bold: true };
}

const MASS = `$E$${TOT}`;
const POWER = `$F$${TOT}`;
const COST = `$G$${TOT}`;
const DATA = `$H$${TOT}`;
const SCI = `$I$${TOT}`;
const SOLAR = `$J$${TOT}`;
const BAT = `$K$${TOT}`;
const BESTMBPS = `N($L$${TOT})`;
const STORAGE = `$T$${TOT}`;
const THERMAL = `$U$${TOT}`;
const COUNT = `SUM(${rg('B')})`;
const bestRes = `IF(COUNT(${rg('N')})=0,"",MIN(${rg('N')}))`;
const bestPoint = `IF(COUNT(${rg('O')})=0,"",MIN(${rg('O')}))`;
const needPoint = `IF(COUNT(${rg('P')})=0,"",MIN(${rg('P')}))`;
const hasSub = (sub: string) => `COUNTIFS(${rg('C')},"${sub}",${rg('B')},">0")>0`;
const hasPayload = hasSub('payload');
const contactTotal = `IF($B$21="","",MIN(1440,$B$21*$B$6))`;
const downCap = `IF($B$21="","",${contactTotal}*60*${BESTMBPS})`;

// Tabla de resultados
sec('D2', 'Presupuestos de ingeniería');
['E', 'F', 'G', 'H', 'I'].forEach((c, i) => {
  const cell = ds.getCell(`${c}2`);
  cell.value = ['Usado / requerido', 'Disponible', 'Margen', 'Estado', 'Si se excede'][i];
  cell.fill = HEAD_FILL;
  cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
});
sec('J2', '¿Por qué?');
for (const c of ['K', 'L', 'M', 'N']) ds.getCell(`${c}2`).fill = HEAD_FILL;
ds.mergeCells('J2:N2');

interface Res {
  name: string;
  kind: 'No-Go' | 'Aviso' | 'Aviso (req.)';
  used: string;
  avail: string;
  fmt: string;
  why: string;
}
const resources: Res[] = [
  {
    name: 'Masa (kg)', kind: 'No-Go', used: MASS,
    avail: 'IF(AND($B$36="",$B$37=""),"",MIN($B$36,$B$37))', fmt: '#,##0.0',
    why: 'La masa total debe caber en el menor de: capacidad del lanzador en esa órbita y masa máxima de la estructura.',
  },
  {
    name: 'Energía media: consumo vs generación (W)', kind: 'No-Go', used: POWER,
    avail: 'IF($B$18="","",' + `${SOLAR}*(1-$B$18))`, fmt: '0.0',
    why: 'Los paneles solo generan en luz: generación media = paneles × (1 − fracción de eclipse). Debe cubrir el consumo medio.',
  },
  {
    name: 'Batería en eclipse (Wh)', kind: 'No-Go', used: `IF($B$19="","",${POWER}*$B$19/60)`, avail: BAT, fmt: '0.0',
    why: 'En eclipse solo hay batería: consumo × minutos de sombra / 60 debe caber en la capacidad útil (capacidad × DoD).',
  },
  {
    name: 'Presupuesto: componentes + lanzador + operación (M USD)', kind: 'No-Go',
    used: `${COST}+IF($B$5="",0,${lcost})+IF($B$31="",0,$B$39*$B$31)`, avail: 'IF($B$27="","",$B$27)', fmt: '0.00',
    why: 'Incluye costo de operación = costo por año del escenario × años de vida mínima.',
  },
  {
    name: 'Tiempo: pieza más lenta + 0,25/pieza + espera del lanzador (meses)', kind: 'No-Go',
    used: `IF(COUNT(${rg('R')})=0,0,MAX(${rg('R')})+0.25*${COUNT})+IF($B$5="",0,${llead})`, avail: 'IF($B$28="","",$B$28)', fmt: '0.00',
    why: 'La pieza más lenta marca el ritmo, cada pieza añade 0,25 meses de integración y hay que esperar la ventana del lanzador.',
  },
  {
    name: 'Datos de 1 día vs almacenamiento (Mbit)', kind: 'Aviso', used: DATA, avail: STORAGE, fmt: '#,##0',
    why: 'La computadora debe poder guardar al menos un día de datos hasta el siguiente contacto.',
  },
  {
    name: 'Datos generados vs bajada posible (Mbit/día)', kind: 'Aviso', used: DATA, avail: downCap, fmt: '#,##0',
    why: 'Lo que no se baja se pierde: tiempo de contacto × estaciones × tasa de la mejor antena.',
  },
  {
    name: 'Requisito: datos bajados vs mínimo del escenario (Mbit/día)', kind: 'Aviso (req.)',
    used: 'IF($B$30="","",$B$30)', avail: `IF(${downCap}="","",MIN(${DATA},${downCap}))`, fmt: '#,##0',
    why: 'Datos realmente bajados = lo menor entre lo generado y lo que cabe en los contactos.',
  },
  {
    name: 'Requisito: resolución lograda vs máxima (m)', kind: 'Aviso (req.)',
    used: `IF(OR(${bestRes}="",$B$25=""),"",${bestRes}*$B$25/500)`, avail: 'IF($B$29="","",$B$29)', fmt: '0.0',
    why: 'La resolución escala con la altitud de perigeo (mejor instrumento × altitud/500). Menor es mejor.',
  },
  {
    name: 'Requisito: valor científico', kind: 'Aviso (req.)', used: 'IF($B$33="","",$B$33)', avail: `IF(${hasPayload},${SCI},"")`, fmt: '0',
    why: 'Suma del valor científico de los instrumentos frente al mínimo del escenario.',
  },
  {
    name: 'Requisito: vida útil (años)', kind: 'Aviso', used: 'IF($B$31="","",$B$31)',
    avail: 'IF(OR($B$24="",$B$38=""),"",MIN($B$24,$B$38))', fmt: '0.0',
    why: 'Vida = mínimo entre arrastre atmosférico y fiabilidad degradada por radiación.',
  },
  {
    name: 'Requisito: revisita (días)', kind: 'Aviso (req.)', used: 'IF($B$22="","",$B$22)', avail: 'IF($B$32="","",$B$32)', fmt: '0.0',
    why: 'Días entre pasadas sobre el mismo punto; el escenario fija un máximo.',
  },
  {
    name: 'Apuntado: precisión de la nave vs requerida (°)', kind: 'Aviso (req.)', used: bestPoint, avail: needPoint, fmt: '0.00',
    why: 'El control de actitud debe ser al menos tan fino como el instrumento más exigente (menor es mejor).',
  },
  {
    name: 'Térmico: consumo vs disipación (W)', kind: 'Aviso (req.)', used: `IF(${POWER}>0,${POWER},"")`, avail: THERMAL, fmt: '0.0',
    why: 'El calor que genera el consumo debe poder disiparse.',
  },
];
const RES_FIRST = 3;
resources.forEach((rs, i) => {
  const r = RES_FIRST + i;
  ds.getCell(`D${r}`).value = rs.name;
  ds.getCell(`E${r}`).value = { formula: `IF(${rs.used}="","",${rs.used})` };
  ds.getCell(`F${r}`).value = { formula: `IF(${rs.avail}="","",${rs.avail})` };
  ds.getCell(`G${r}`).value = {
    formula: `IF(OR(E${r}="",F${r}=""),"",IF(F${r}=0,IF(E${r}=0,0,-1),(F${r}-E${r})/F${r}))`,
  };
  ds.getCell(`H${r}`).value = {
    formula: `IF(G${r}="","—",IF(G${r}<0,"Excedido",IF(G${r}<$B$9,"Justo","OK")))`,
  };
  ds.getCell(`I${r}`).value = rs.kind;
  ds.getCell(`E${r}`).numFmt = rs.fmt;
  ds.getCell(`F${r}`).numFmt = rs.fmt;
  ds.getCell(`G${r}`).numFmt = '0%';
  ds.getCell(`J${r}`).value = rs.why;
  ds.getCell(`J${r}`).alignment = { wrapText: true, vertical: 'top' };
  ds.mergeCells(`J${r}:N${r}`);
  ds.getRow(r).height = 30;
});
const RES_LAST = RES_FIRST + resources.length - 1;
const KIND_RANGE = `$I$${RES_FIRST}:$I$${RES_LAST}`;
const STATUS_RANGE = `$H$${RES_FIRST}:$H$${RES_LAST}`;

// Reglas bloqueantes
const RULE_HEAD = RES_LAST + 2;
sec(`D${RULE_HEAD}`, 'Reglas bloqueantes');
for (const c of ['E', 'F', 'G']) ds.getCell(`${c}${RULE_HEAD}`).fill = HEAD_FILL;
const hh = ds.getCell(`H${RULE_HEAD}`);
hh.value = 'Estado';
hh.fill = HEAD_FILL;
hh.font = { bold: true, color: { argb: 'FFFFFFFF' } };
ds.getCell(`I${RULE_HEAD}`).fill = HEAD_FILL;
sec(`J${RULE_HEAD}`, '¿Por qué?');
for (const c of ['K', 'L', 'M', 'N']) ds.getCell(`${c}${RULE_HEAD}`).fill = HEAD_FILL;
ds.mergeCells(`J${RULE_HEAD}:N${RULE_HEAD}`);

const okx = (cond: string) => `IF(${cond},"OK","Excedido")`;
const rules: { name: string; ok: string; why: string }[] = [
  { name: 'Órbita elegida y permitida', ok: okx(`AND($B$4<>"",ISNUMBER(SEARCH(","&$B$4&",",","&$B$34&",")))`), why: 'Hay que elegir una órbita y el escenario limita cuáles.' },
  { name: 'Lanzador elegido y permitido', ok: okx(`AND($B$5<>"",ISNUMBER(SEARCH(","&$B$5&",",","&$B$35&",")))`), why: 'Hay que elegir un lanzador y el escenario limita cuáles.' },
  { name: 'El lanzador llega a la órbita', ok: `IF($B$36="","—",${okx('$B$36>0')})`, why: 'Si la capacidad en esa órbita es 0, el lanzador no llega.' },
  {
    name: 'Subsistemas obligatorios',
    ok: okx(`AND(${hasSub('structure')},${hasSub('power')},${hasSub('battery')},${hasSub('comms')},${hasSub('obc')},${hasSub('payload')})`),
    why: 'Estructura, paneles, batería, comunicaciones, computadora e instrumento.',
  },
  { name: 'Una sola estructura', ok: okx('$B$42<=1'), why: 'Una nave tiene un único chasis.' },
  { name: 'Puntos de montaje suficientes', ok: `IF($C$41="",${okx('$B$41=0')},${okx('$B$41<=$C$41')})`, why: 'Cada pieza (menos la estructura) ocupa un punto de montaje.' },
  { name: 'Componentes permitidos por el escenario', ok: okx(`COUNTIF(${rg('V')},0)=0`), why: 'El escenario puede restringir el catálogo.' },
];
rules.forEach((rl, i) => {
  const r = RULE_HEAD + 1 + i;
  ds.getCell(`D${r}`).value = rl.name;
  ds.getCell(`H${r}`).value = { formula: rl.ok };
  ds.getCell(`J${r}`).value = rl.why;
  ds.mergeCells(`J${r}:N${r}`);
});
const RULE_LAST = RULE_HEAD + rules.length;
const RULE_RANGE = `$H$${RULE_HEAD + 1}:$H$${RULE_LAST}`;

// Veredicto: solo los bloqueantes dan No-Go; el resto son avisos (igual que review.ts)
const VR = RULE_LAST + 2;
ds.getCell(`D${VR}`).value = 'VEREDICTO Go / No-Go';
ds.getCell(`D${VR}`).font = { bold: true };
ds.getCell(`H${VR}`).value = {
  formula:
    `IF(OR(COUNTIFS(${KIND_RANGE},"No-Go",${STATUS_RANGE},"Excedido")>0,COUNTIF(${RULE_RANGE},"Excedido")>0),"No-Go",` +
    `IF(OR(COUNTIF(${STATUS_RANGE},"Excedido")>0,COUNTIFS(${KIND_RANGE},"<>Aviso (req.)",${STATUS_RANGE},"Justo")>0),"Go con avisos","Go"))`,
};
ds.getCell(`H${VR}`).font = { bold: true };
ds.getCell(`J${VR}`).value =
  'No-Go solo por bloqueantes (marcados "No-Go" y reglas). Requisitos y demás recursos en rojo son avisos; el ámbar solo avisa en los presupuestos que el motor trata como tight (no en requisitos). No incluye el aviso de tormenta solar del motor.';
ds.getCell(`J${VR}`).alignment = { wrapText: true, vertical: 'top' };
ds.mergeCells(`J${VR}:N${VR}`);
ds.getRow(VR).height = 30;

const INFO = VR + 1;
ds.getCell(`D${INFO}`).value = 'Fiabilidad de los componentes (sin lanzador)';
ds.getCell(`H${INFO}`).value = { formula: `PRODUCT(${rg('Q')})` };
ds.getCell(`H${INFO}`).numFmt = '0.0%';
ds.getCell(`J${INFO}`).value = 'Informativo: más piezas = menos fiabilidad; la redundancia compensa.';
ds.mergeCells(`J${INFO}:N${INFO}`);

// Formato condicional verde / ámbar / rojo
const mk = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, bgColor: { argb }, fgColor: { argb } });
const green = mk('FFC6EFCE');
const amber = mk('FFFFEB9C');
const red = mk('FFFFC7CE');
const cf = (ref: string, cell: string) => {
  ds.addConditionalFormatting({
    ref,
    rules: [
      { type: 'expression', priority: 1, formulae: [`OR(${cell}="Excedido",${cell}="No-Go")`], style: { fill: red } },
      { type: 'expression', priority: 2, formulae: [`OR(${cell}="Justo",${cell}="Go con avisos")`], style: { fill: amber } },
      { type: 'expression', priority: 3, formulae: [`OR(${cell}="OK",${cell}="Go")`], style: { fill: green } },
    ],
  });
};
cf(`H${RES_FIRST}:H${RES_LAST}`, `H${RES_FIRST}`);
cf(`H${RULE_HEAD + 1}:H${RULE_LAST}`, `H${RULE_HEAD + 1}`);
cf(`H${VR}`, `H${VR}`);
ds.addConditionalFormatting({
  ref: `G${RES_FIRST}:G${RES_LAST}`,
  rules: [
    { type: 'expression', priority: 4, formulae: [`AND(ISNUMBER(G${RES_FIRST}),G${RES_FIRST}<0)`], style: { fill: red } },
    { type: 'expression', priority: 5, formulae: [`AND(ISNUMBER(G${RES_FIRST}),G${RES_FIRST}<$B$9)`], style: { fill: amber } },
    { type: 'expression', priority: 6, formulae: [`ISNUMBER(G${RES_FIRST})`], style: { fill: green } },
  ],
});

// Léame
rd.getColumn(1).width = 120;
[
  'Payload · prototipo de compromisos en hoja de cálculo',
  '',
  'Cómo usarla',
  '1. La hoja Diseño se abre con un diseño de ejemplo (por defecto prototype/designs/ok-cubesat-leo.json).',
  '2. Cambia escenario, órbita y lanzador (listas desplegables, celdas amarillas) y las cantidades de la columna B de la tabla de componentes.',
  '3. Mira los presupuestos (arriba a la derecha): verde = margen sano, ámbar = justo (< 15 %), rojo = excedido.',
  '4. Solo las filas "No-Go" y las reglas bloqueantes dan No-Go; el resto son avisos, igual que el motor.',
  '5. Para precargar otro diseño: build-sheet.ts --design <archivo.json | nombre en prototype/designs>.',
  '',
  'Qué hace cada hoja',
  'Componentes / Órbitas / Lanzadores / Escenarios: copia del catálogo (packages/shared/catalog). No se editan a mano:',
  '   se regeneran con build-sheet.ts. En Órbitas hay columnas con fórmulas de Kepler y de contacto.',
  '',
  'Qué replica del motor (packages/shared) y qué no',
  '- Replica: órbita (Kepler, eclipse peor caso, contacto con elevación mínima 10° y K = 2), masa = min(lanzador, estructura), energía, batería con DoD,',
  '  presupuesto con operación, tiempo (pieza más lenta + 0,25/pieza + espera), vida (arrastre y fiabilidad con radiación), bloqueantes y avisos de review.ts.',
  '- No replica: el aviso de tormenta solar (power-storm), la simulación de operación, la puntuación ni los eventos.',
  '- Referencia: pnpm proto (motor real). Si difieren, manda el motor.',
].forEach((t, i) => {
  const c = rd.getCell(`A${i + 1}`);
  c.value = t;
  c.alignment = { wrapText: true };
  if (i === 0) c.font = { bold: true, size: 14 };
  if (t === 'Cómo usarla' || t === 'Qué hace cada hoja' || t.startsWith('Qué replica')) c.font = { bold: true };
});

wb.views = [{ x: 0, y: 0, width: 20000, height: 20000, firstSheet: 0, activeTab: 1, visibility: 'visible' }];

wb.xlsx.writeFile(outFile).then(() => {
  console.log(
    `OK -> ${outFile}\n  catalogo: ${catalogDir}\n  diseno precargado: ${preload ? designPath : '(ninguno)'}\n  ${components.length} componentes, ${orbits.length} orbitas, ${launchers.length} lanzadores, ${scenarios.length} escenarios`,
  );
});
