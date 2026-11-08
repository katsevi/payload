import { useMemo } from 'react';
import { catalog, type ComponentDef, type SubsystemId } from '@payload/shared';
import { SUBSYSTEM_COLOR } from './hangarLayout';

const BASE_Y = 0.9;

/** Tamaño del bus (m) según la masa que soporta la estructura. */
export function busSize(structure: ComponentDef | undefined): number {
  if (!structure) return 1;
  const cap = structure.maxSupportedMassKg ?? structure.massKg * 3;
  return Math.min(2.2, Math.max(0.8, 0.55 + 0.35 * Math.log10(cap + 1)));
}

/** Nave procedural: bus + piezas visibles por subsistema que aparecen al montarse. */
export function Ship({ componentIds }: { componentIds: string[] }) {
  const { S, hasStructure, groups } = useMemo(() => {
    const defs = componentIds
      .map((id) => catalog.components.find((c) => c.id === id))
      .filter((c): c is ComponentDef => !!c);
    const structure = defs.find((c) => c.subsystem === 'structure');
    const groups: Record<SubsystemId, number> = {
      structure: 0, power: 0, battery: 0, comms: 0, obc: 0, adcs: 0, thermal: 0, payload: 0,
    };
    for (const d of defs) groups[d.subsystem]++;
    return { S: busSize(structure), hasStructure: !!structure, groups };
  }, [componentIds]);

  const cy = BASE_Y + S * 0.55;
  const h = S * 1.1;
  const rep = (n: number) => Array.from({ length: Math.min(n, 6) }, (_, i) => i);

  return (
    <group position={[0, 0, 0]}>
      {/* Bus */}
      <mesh position={[0, cy, 0]} castShadow receiveShadow>
        <boxGeometry args={[S, h, S]} />
        <meshStandardMaterial
          color={hasStructure ? '#c9a24a' : '#8d99a8'}
          metalness={hasStructure ? 0.7 : 0.1}
          roughness={0.45}
          transparent={!hasStructure}
          opacity={hasStructure ? 1 : 0.25}
          wireframe={!hasStructure}
        />
      </mesh>

      {/* Paneles solares: un par de alas por componente de energía */}
      {rep(groups.power).map((k) => {
        const w = S * 0.7;
        const x = S / 2 + 0.12 + w * (k + 0.5);
        return [-1, 1].map((sgn) => (
          <group key={`p${k}${sgn}`}>
            <mesh position={[sgn * (S / 2 + 0.06), cy, 0]}>
              <boxGeometry args={[0.12, 0.05, 0.05]} />
              <meshStandardMaterial color="#999" />
            </mesh>
            <mesh position={[sgn * x, cy, 0]} castShadow>
              <boxGeometry args={[w * 0.96, 0.03, S * 0.95]} />
              <meshStandardMaterial color="#1b3f9c" metalness={0.8} roughness={0.25} emissive="#0a1f55" />
            </mesh>
          </group>
        ));
      })}

      {/* Baterías: cilindros en la cara posterior */}
      {rep(groups.battery).map((k) => (
        <mesh key={`b${k}`} position={[-S * 0.35 + k * 0.3, cy - h * 0.25, -S / 2 - 0.1]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.11, 0.11, 0.2, 16]} />
          <meshStandardMaterial color={SUBSYSTEM_COLOR.battery} metalness={0.4} roughness={0.5} />
        </mesh>
      ))}

      {/* Antena de comunicaciones: mástil + plato */}
      {rep(groups.comms).map((k) => (
        <group key={`c${k}`} position={[(k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.45, cy + h / 2, 0]}>
          <mesh position={[0, 0.2, 0]}>
            <cylinderGeometry args={[0.02, 0.02, 0.4, 8]} />
            <meshStandardMaterial color="#aaa" />
          </mesh>
          <mesh position={[0, 0.45, 0]} rotation={[-0.4, 0, 0]} castShadow>
            <sphereGeometry args={[0.28, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2.4]} />
            <meshStandardMaterial color="#e8e8ee" side={2} metalness={0.3} roughness={0.4} />
          </mesh>
        </group>
      ))}

      {/* Computadora: caja oscura con luz de estado */}
      {rep(groups.obc).map((k) => (
        <group key={`o${k}`} position={[-S * 0.25, cy - h * 0.2 + k * 0.16, S / 2 + 0.03]}>
          <mesh castShadow>
            <boxGeometry args={[0.32, 0.12, 0.06]} />
            <meshStandardMaterial color="#1a1f2a" />
          </mesh>
          <mesh position={[0.12, 0, 0.04]}>
            <sphereGeometry args={[0.015, 8, 8]} />
            <meshBasicMaterial color={SUBSYSTEM_COLOR.obc} />
          </mesh>
        </group>
      ))}

      {/* Control de actitud: ruedas de reacción / toberas en las esquinas superiores */}
      {rep(groups.adcs).map((k) => (
        <mesh
          key={`a${k}`}
          position={[(k % 2 ? 1 : -1) * (S / 2 + 0.05), cy + h / 2 - 0.1 - Math.floor(k / 2) * 0.2, S / 2 - 0.1]}
          rotation={[0, Math.PI / 2, 0]}
        >
          <torusGeometry args={[0.07, 0.025, 8, 16]} />
          <meshStandardMaterial color={SUBSYSTEM_COLOR.adcs} metalness={0.5} />
        </mesh>
      ))}

      {/* Térmico: radiador blanco en la cara superior */}
      {rep(groups.thermal).map((k) => (
        <mesh key={`t${k}`} position={[0, cy + h / 2 + 0.02 + k * 0.03, -S * 0.2]} castShadow>
          <boxGeometry args={[S * 0.8, 0.02, S * 0.4]} />
          <meshStandardMaterial color="#f4f4f4" roughness={0.3} />
        </mesh>
      ))}

      {/* Instrumentos: tubo con lente en la cara frontal inferior */}
      {rep(groups.payload).map((k) => (
        <group key={`i${k}`} position={[S * 0.22 + (k % 2) * 0.0 - (k > 1 ? 0.3 : 0), cy - h * 0.2 + (k % 2 ? 0.3 : 0), S / 2 + 0.12]}>
          <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
            <cylinderGeometry args={[0.1, 0.12, 0.25, 16]} />
            <meshStandardMaterial color="#2a2f3a" metalness={0.6} roughness={0.35} />
          </mesh>
          <mesh position={[0, 0, 0.13]} rotation={[Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.085, 16]} />
            <meshBasicMaterial color={SUBSYSTEM_COLOR.payload} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
