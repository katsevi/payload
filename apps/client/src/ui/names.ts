/**
 * Nombres y unidades que dependen de si la partida es con diseño (sistema solar) o clásica (sector abstracto).
 * Los cuerpos reales se nombran con `catalog.<bodyId>` del motor; los puntos de paso con su nombre inventado.
 */
import type { SectorNode } from '@payload/shared';
import i18n from '../i18n';
import { fmt } from './common';

export function nodeName(node: Pick<SectorNode, 'name' | 'bodyId'> | undefined | null): string {
  if (!node) return '';
  return node.bodyId ? (i18n.t(`catalog.${node.bodyId}`, { ns: 'sim', defaultValue: node.name }) as string) : node.name;
}

/** Distancia del mapa: años luz en la partida clásica; unidades de ruta en el sistema solar (no son años luz). */
export function distanceText(value: number, solar: boolean): string {
  return i18n.t(solar ? 'map.units' : 'map.ly', { value: fmt(value, 0) }) as string;
}
