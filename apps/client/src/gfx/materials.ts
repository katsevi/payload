/**
 * Biblioteca de materiales compartidos de la nave. Se crean una vez; los modelos procedurales los
 * referencian para que piezas de distintos puestos acaben fusionadas en pocas llamadas de dibujo.
 */
import { DoubleSide, MeshBasicMaterial, MeshStandardMaterial, type ColorRepresentation } from 'three';
import { once } from './build';
import { brushedMaps, deckMaps, hazardTexture, panelMaps, type SurfaceMaps } from './textures';

function surface(maps: SurfaceMaps, color: ColorRepresentation, metalness: number, normalScale = 1): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ color, map: maps.albedo, normalMap: maps.normal, roughnessMap: maps.rough, roughness: 1, metalness });
  m.normalScale.setScalar(normalScale);
  return m;
}

export const mats = once(() => {
  const panel = panelMaps();
  const deck = deckMaps();
  const brushed = brushedMaps();
  const dish = surface(brushed, '#b4bdcc', 0.9, 0.6);
  dish.side = DoubleSide;
  return {
    /** Chapa fina que se ve por las dos caras (plato de la antena). */
    dish,
    /** Paredes claras del casco. */
    wall: surface(panel, '#b4c0d4', 0.35),
    /** Zócalos, mamparos y paneles secundarios. */
    wallDark: surface(panel, '#5f6d86', 0.45),
    ceiling: surface(panel, '#333d50', 0.5),
    deck: surface(deck, '#8d97a8', 0.5),
    deckDark: surface(deck, '#4a5363', 0.55),
    /** Carcasas de la maquinaria. */
    machine: surface(panel, '#53627c', 0.6),
    machineDark: surface(panel, '#2b3445', 0.6),
    /** Metal cepillado claro: marcos, cantos, pasamanos. */
    trim: surface(brushed, '#98a3b6', 0.9, 0.6),
    steel: surface(brushed, '#808a9a', 0.85, 0.6),
    copper: surface(brushed, '#d08a4c', 1, 0.6),
    /** Pintura naranja de servicio: tuberías, válvulas y palancas. */
    orange: surface(brushed, '#e07a2c', 0.3, 0.4),
    tank: surface(brushed, '#dfe6ea', 0.25, 0.4),
    green: surface(brushed, '#3f9278', 0.3, 0.4),
    dark: new MeshStandardMaterial({ color: '#12151b', roughness: 0.6, metalness: 0.45 }),
    screen: new MeshStandardMaterial({ color: '#04070c', roughness: 0.12, metalness: 0.7 }),
    hazard: new MeshStandardMaterial({ map: hazardTexture(), roughness: 0.6, metalness: 0.2 }),
    /** Cristal: casi invisible de frente, con reflejo del entorno en ángulo rasante. */
    glass: new MeshStandardMaterial({ color: '#b9dcff', transparent: true, opacity: 0.1, roughness: 0.03, metalness: 1, depthWrite: false, side: DoubleSide }),
    /** Guías luminosas (suelo, puertas, molduras). `ZoneLights` las atenúa en un apagón. */
    guide: new MeshBasicMaterial({ color: '#38e1c0', toneMapped: false }),
    /** Detalles encendidos fijos (pilotos pequeños de los equipos). */
    led: new MeshBasicMaterial({ color: '#7fd4ff', toneMapped: false }),
  };
});

export type Mats = ReturnType<typeof mats>;
