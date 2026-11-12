/**
 * Roca procedural compartida: la usan el campo de asteroides del espacio y las rocas de la superficie.
 */
import { IcosahedronGeometry, MeshStandardMaterial, Vector3 } from 'three';
import { valueNoise3 } from '../game/noise';
import { once } from './build';
import { rockMaps } from './textures';

/** Roca de radio ~1: un icosaedro abollado. Facetada a propósito (se ve tallada con la luz rasante). */
export const rockGeometry = once(() => {
  const g = new IcosahedronGeometry(1, 3);
  const pos = g.getAttribute('position');
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const r = 0.72 + 0.5 * valueNoise3(v.x * 1.4 + 5, v.y * 1.4 + 9, v.z * 1.4 + 2) + 0.16 * valueNoise3(v.x * 4 + 1, v.y * 4 + 3, v.z * 4 + 7);
    pos.setXYZ(i, v.x * r, v.y * r, v.z * r);
  }
  g.computeVertexNormals();
  return g;
});

/** Roca más tosca y barata (menos caras) para las piedras pequeñas del suelo. */
export const pebbleGeometry = once(() => {
  const g = new IcosahedronGeometry(1, 1);
  const pos = g.getAttribute('position');
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const r = 0.7 + 0.55 * valueNoise3(v.x * 1.7 + 3, v.y * 1.7 + 1, v.z * 1.7 + 8);
    pos.setXYZ(i, v.x * r, v.y * r * 0.7, v.z * r);
  }
  g.computeVertexNormals();
  return g;
});

export const rockMaterial = once(() => {
  const maps = rockMaps();
  return new MeshStandardMaterial({ color: '#c4b6a4', map: maps.albedo, normalMap: maps.normal, roughnessMap: maps.rough, roughness: 1, metalness: 0.05, flatShading: true });
});
