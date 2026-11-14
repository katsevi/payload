/**
 * Roles de tripulación (fase 6, ADR 0017). Funciones puras: la partida (`run.ts`) las usa y el cliente
 * las llama para pintar lo mismo que cobra el motor (p. ej. la capacidad de la mochila del explorador).
 *
 * Un rol solo da ventajas pasivas (`catalog/roles.json`): ningún puesto se bloquea por rol. En solitario
 * no hay roles (`CrewMember.role` ausente) y nada cambia.
 */
import type { Catalog, CrewMember, RoleDef, RoleId, RolePerks, SurfaceRules } from './types';

const NO_PERKS: RolePerks = {};

export function getRoles(cat: Catalog): RoleDef[] {
  return cat.roles ?? [];
}

export function getRole(roleId: RoleId, cat: Catalog): RoleDef | null {
  return getRoles(cat).find((r) => r.id === roleId) ?? null;
}

/** Ventajas del rol de un tripulante (vacío si no tiene rol o el catálogo no lo define). */
export function crewPerks(member: Pick<CrewMember, 'role'> | null | undefined, cat: Catalog): RolePerks {
  if (!member?.role) return NO_PERKS;
  return getRole(member.role, cat)?.perks ?? NO_PERKS;
}

/** Capacidad de la mochila de ese tripulante (reglas efectivas × ventaja de explorador). */
export function crewCarryCapacityKg(rules: SurfaceRules, member: Pick<CrewMember, 'role'> | null | undefined, cat: Catalog): number {
  return rules.suit.carryCapacityKg * (crewPerks(member, cat).carryCapacityMult ?? 1);
}

/** Gasto del jetpack de ese tripulante por segundo de uso. */
export function crewJetpackDrainPctPerS(rules: SurfaceRules, member: Pick<CrewMember, 'role'> | null | undefined, cat: Catalog): number {
  return rules.jetpack.drainPctPerS * (crewPerks(member, cat).jetpackDrainMult ?? 1);
}
