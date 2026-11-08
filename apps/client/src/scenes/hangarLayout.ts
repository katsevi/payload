import type { ComponentDef, SubsystemId } from '@payload/shared';

export const SUBSYSTEM_ORDER: SubsystemId[] = ['structure', 'power', 'battery', 'comms', 'obc', 'adcs', 'thermal', 'payload'];

export const SUBSYSTEM_COLOR: Record<SubsystemId, string> = {
  structure: '#8d99a8',
  power: '#2f6bff',
  battery: '#f2b134',
  comms: '#e0508a',
  obc: '#3ddc84',
  adcs: '#a070ff',
  thermal: '#f5f5f5',
  payload: '#38e1c0',
};

export const ROOM = { half: 13, height: 8 };
export const SHIP_POS: [number, number, number] = [0, 0, 0];
export const SHIP_REACH = 4.6;
export const CONSOLE_POS: [number, number, number] = [10.5, 0, 4];
export const CONSOLE_REACH = 3;
export const SHELF_Z = -12.4;
export const PLAYER_START: [number, number, number] = [0, 0, 9];

export interface ShelfDef {
  subsystem: SubsystemId;
  x: number;
}
export interface BoxItem {
  id: string;
  subsystem: SubsystemId;
  pos: [number, number, number];
}

export const SHELVES: ShelfDef[] = SUBSYSTEM_ORDER.map((subsystem, i) => ({ subsystem, x: -10.15 + i * 2.9 }));

const LEVELS = [0.55, 1.25, 1.95];
const COLS = [-0.93, -0.31, 0.31, 0.93];

/** Reparte las cajas de componentes por estante (cada subsistema en su estante). */
export function layoutBoxes(components: ComponentDef[]): BoxItem[] {
  const out: BoxItem[] = [];
  for (const shelf of SHELVES) {
    const list = components.filter((c) => c.subsystem === shelf.subsystem);
    list.slice(0, LEVELS.length * COLS.length).forEach((c, i) => {
      const level = Math.floor(i / COLS.length);
      const col = i % COLS.length;
      out.push({
        id: c.id,
        subsystem: shelf.subsystem,
        pos: [shelf.x + (COLS[col] ?? 0), (LEVELS[level] ?? 0.55) + 0.28, SHELF_Z + 0.25],
      });
    });
  }
  return out;
}
