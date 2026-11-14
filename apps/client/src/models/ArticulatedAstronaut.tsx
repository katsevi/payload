/**
 * Astronauta articulado procedural (fase 5, ADR 0018 § 9): cadera, rodillas, hombros, codos, tronco y cabeza como
 * grupos anidados que se giran cada frame con `applyAstronautPose` (sin React por frame). Dos niveles de detalle:
 * `high` (el jugador en 3ª persona) y `low` (los compañeros del cooperativo y lejos). Mira a +Z, con los pies en y = 0.
 *
 * El GLB del tripulante (`astronaut_by_jungle_jim.glb`) no tiene esqueleto y sus mallas van por material, no por
 * extremidad: articularlo exigiría riggearlo en Blender. Este modelo no usa assets (no hay licencia que registrar).
 */
import { useEffect, useMemo, type MutableRefObject } from 'react';
import { MeshStandardMaterial, type Group } from 'three';
import { once } from '../gfx/build';
import type { AstronautPose } from '../game/astronautPose';

export type AstronautLod = 'high' | 'low';

/** Articulaciones que se mueven (las rellenan los `ref` al montar). */
export interface AstronautRig {
  root: Group | null;
  spine: Group | null;
  head: Group | null;
  shoulderL: Group | null;
  shoulderR: Group | null;
  elbowL: Group | null;
  elbowR: Group | null;
  hipL: Group | null;
  hipR: Group | null;
  kneeL: Group | null;
  kneeR: Group | null;
}

export const newAstronautRig = (): AstronautRig => ({
  root: null, spine: null, head: null, shoulderL: null, shoulderR: null, elbowL: null, elbowR: null, hipL: null, hipR: null, kneeL: null, kneeR: null,
});

/** Aplica una pose (ver `game/astronautPose.ts`): solo rotaciones y la subida de la zancada. */
export function applyAstronautPose(rig: AstronautRig, pose: AstronautPose): void {
  if (rig.root) rig.root.position.y = pose.bobM;
  if (rig.spine) rig.spine.rotation.x = pose.spine;
  if (rig.head) rig.head.rotation.x = pose.head;
  if (rig.hipL) rig.hipL.rotation.x = pose.hipL;
  if (rig.hipR) rig.hipR.rotation.x = pose.hipR;
  if (rig.kneeL) rig.kneeL.rotation.x = pose.kneeL;
  if (rig.kneeR) rig.kneeR.rotation.x = pose.kneeR;
  if (rig.shoulderL) rig.shoulderL.rotation.set(pose.shoulderL, 0, pose.armSpread);
  if (rig.shoulderR) rig.shoulderR.rotation.set(pose.shoulderR, 0, -pose.armSpread);
  if (rig.elbowL) rig.elbowL.rotation.x = pose.elbowL;
  if (rig.elbowR) rig.elbowR.rotation.x = pose.elbowR;
}

/** Materiales del traje, compartidos por todos los astronautas (se crean una vez). */
const suitMats = once(() => ({
  suit: new MeshStandardMaterial({ color: '#e9edf2', roughness: 0.8, metalness: 0.05 }),
  shell: new MeshStandardMaterial({ color: '#f4f1ea', roughness: 0.45, metalness: 0.1 }),
  joint: new MeshStandardMaterial({ color: '#3a414d', roughness: 0.7, metalness: 0.3 }),
  boot: new MeshStandardMaterial({ color: '#2a2f38', roughness: 0.85, metalness: 0.1 }),
  visor: new MeshStandardMaterial({ color: '#c99a3a', roughness: 0.12, metalness: 0.95 }),
  lamp: new MeshStandardMaterial({ color: '#dff4ff', emissive: '#dff4ff', emissiveIntensity: 2, toneMapped: false }),
}));

// Medidas (m) para una persona de 1,8 m.
const HIP_Y = 0.95;
const HIP_X = 0.11;
const THIGH = 0.43;
const SHIN = 0.42;
const SHOULDER_Y = 1.4;
const SHOULDER_X = 0.27;
const UPPER_ARM = 0.29;
const FOREARM = 0.27;
const NECK_Y = 1.5;

interface LimbProps {
  lod: AstronautLod;
  set: (k: keyof AstronautRig) => (g: Group | null) => void;
  side: 'L' | 'R';
  accent: MeshStandardMaterial;
}

function Leg({ lod, set, side, accent }: LimbProps) {
  const m = suitMats();
  const x = side === 'L' ? HIP_X : -HIP_X;
  const seg = lod === 'high' ? 10 : 5;
  return (
    <group ref={set(side === 'L' ? 'hipL' : 'hipR')} position={[x, HIP_Y, 0]}>
      <mesh material={m.suit} position={[0, -THIGH / 2, 0]}>
        <capsuleGeometry args={[0.085, THIGH - 0.12, 2, seg]} />
      </mesh>
      <group ref={set(side === 'L' ? 'kneeL' : 'kneeR')} position={[0, -THIGH, 0]}>
        {lod === 'high' && (
          <mesh material={m.joint}>
            <sphereGeometry args={[0.08, 10, 8]} />
          </mesh>
        )}
        <mesh material={m.suit} position={[0, -SHIN / 2, 0]}>
          <capsuleGeometry args={[0.075, SHIN - 0.12, 2, seg]} />
        </mesh>
        {lod === 'high' && (
          <mesh material={accent} position={[0, -SHIN * 0.35, 0]}>
            <cylinderGeometry args={[0.082, 0.082, 0.03, 12]} />
          </mesh>
        )}
        {/* Bota: un poco hacia delante (+Z), apoyada en y = 0 con la pierna recta. */}
        <mesh material={m.boot} position={[0, -SHIN - 0.02, 0.04]}>
          <boxGeometry args={[0.13, 0.11, 0.26]} />
        </mesh>
      </group>
    </group>
  );
}

function Arm({ lod, set, side, accent }: LimbProps) {
  const m = suitMats();
  const x = side === 'L' ? SHOULDER_X : -SHOULDER_X;
  const seg = lod === 'high' ? 10 : 5;
  return (
    <group ref={set(side === 'L' ? 'shoulderL' : 'shoulderR')} position={[x, SHOULDER_Y, 0]}>
      {lod === 'high' && (
        <mesh material={m.shell}>
          <sphereGeometry args={[0.095, 12, 8]} />
        </mesh>
      )}
      <mesh material={m.suit} position={[0, -UPPER_ARM / 2, 0]}>
        <capsuleGeometry args={[0.065, UPPER_ARM - 0.1, 2, seg]} />
      </mesh>
      <group ref={set(side === 'L' ? 'elbowL' : 'elbowR')} position={[0, -UPPER_ARM, 0]}>
        <mesh material={m.suit} position={[0, -FOREARM / 2, 0]}>
          <capsuleGeometry args={[0.058, FOREARM - 0.1, 2, seg]} />
        </mesh>
        {lod === 'high' && (
          <mesh material={accent} position={[0, -FOREARM * 0.55, 0]}>
            <cylinderGeometry args={[0.062, 0.062, 0.025, 12]} />
          </mesh>
        )}
        {/* Guante. */}
        <mesh material={m.joint} position={[0, -FOREARM - 0.03, 0]}>
          <sphereGeometry args={[0.06, lod === 'high' ? 10 : 6, lod === 'high' ? 8 : 4]} />
        </mesh>
      </group>
    </group>
  );
}

/**
 * El astronauta. `rig` recibe las articulaciones (para posarlo por frame); `accent` es el color de las bandas y de la
 * mochila (el del rol en cooperativo).
 */
export function ArticulatedAstronaut({ lod = 'high', accent = '#e07a2c', rig }: { lod?: AstronautLod; accent?: string; rig: MutableRefObject<AstronautRig> }) {
  const m = suitMats();
  // Un material por color de acento (no por frame): el del rol o el naranja de serie.
  const accentMat = useMemo(() => new MeshStandardMaterial({ color: accent, roughness: 0.55, emissive: accent, emissiveIntensity: 0.25 }), [accent]);
  useEffect(() => () => accentMat.dispose(), [accentMat]);
  const set = (k: keyof AstronautRig) => (g: Group | null) => {
    rig.current[k] = g;
  };
  const seg = lod === 'high' ? 12 : 6;
  const limb = { lod, set, accent: accentMat };
  return (
    <group ref={set('root')}>
      <Leg {...limb} side="L" />
      <Leg {...limb} side="R" />
      {/* Tronco: gira en la cintura con la cabeza, los brazos y la mochila. */}
      <group ref={set('spine')} position={[0, HIP_Y, 0]}>
        <group position={[0, -HIP_Y, 0]}>
          <mesh material={m.suit} position={[0, 1.02, 0]}>
            <capsuleGeometry args={[0.17, 0.12, 2, seg]} />
          </mesh>
          <mesh material={m.shell} position={[0, 1.27, 0.01]}>
            <capsuleGeometry args={[0.215, 0.18, 3, seg]} />
          </mesh>
          {/* Mochila de soporte vital a la espalda (−Z), con la banda del color de acento. */}
          <mesh material={m.shell} position={[0, 1.24, -0.24]}>
            <boxGeometry args={[0.38, 0.5, 0.18]} />
          </mesh>
          <mesh material={accentMat} position={[0, 1.4, -0.335]}>
            <boxGeometry args={[0.3, 0.06, 0.02]} />
          </mesh>
          {lod === 'high' && (
            <>
              {/* Panel del pecho y cinturón. */}
              <mesh material={m.joint} position={[0, 1.24, 0.2]}>
                <boxGeometry args={[0.2, 0.13, 0.05]} />
              </mesh>
              <mesh material={accentMat} position={[0.06, 1.25, 0.226]}>
                <boxGeometry args={[0.04, 0.04, 0.01]} />
              </mesh>
              <mesh material={m.joint} position={[0, 0.97, 0]}>
                <torusGeometry args={[0.17, 0.025, 6, 20]} />
              </mesh>
            </>
          )}
          <Arm {...limb} side="L" />
          <Arm {...limb} side="R" />
          <group ref={set('head')} position={[0, NECK_Y, 0]}>
            {lod === 'high' && (
              <mesh material={m.joint} position={[0, 0.02, 0]}>
                <cylinderGeometry args={[0.1, 0.12, 0.06, 14]} />
              </mesh>
            )}
            <mesh material={m.shell} position={[0, 0.14, 0]}>
              <sphereGeometry args={[0.18, lod === 'high' ? 20 : 10, lod === 'high' ? 14 : 7]} />
            </mesh>
            {/* Visera dorada hacia delante (+Z). */}
            <mesh material={m.visor} position={[0, 0.15, 0.07]} scale={[1, 0.82, 0.8]}>
              <sphereGeometry args={[0.15, lod === 'high' ? 18 : 8, lod === 'high' ? 12 : 6]} />
            </mesh>
            {lod === 'high' && (
              <mesh material={m.lamp} position={[0.12, 0.24, 0.1]}>
                <sphereGeometry args={[0.022, 8, 6]} />
              </mesh>
            )}
          </group>
        </group>
      </group>
    </group>
  );
}
