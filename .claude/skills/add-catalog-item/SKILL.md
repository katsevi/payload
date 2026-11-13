---
name: add-catalog-item
description: Añadir o modificar contenido del catálogo de Payload (nave, avería, tipo de destino, reglas de sector, mundo o material de superficie, precios o mejora de nave) en packages/shared/catalog/*.json con textos es/en. Úsala para "ajusta el balance", "haz los asteroides más peligrosos", "nuevo tipo de destino", "otra nave".
---

# Añadir o ajustar contenido del catálogo

Los tipos están en `packages/shared/src/types.ts` (`ShipDef`, `HazardRules`, `NodeKindDef`,
`SectorRules`, `WorldDef`, `MaterialDef`, `SurfaceRules`, `EconomyRules`, `UpgradeDef`) y el esquema zod en `packages/shared/src/catalog.ts`. Diseño: `docs/GDD.md` § 4-7.

| Contenido | Archivo | Qué decide |
| --- | --- | --- |
| Nave | `packages/shared/catalog/naves.json` | Casco, depósito, reactor, consumo de cada sistema, regímenes de motores |
| Averías e impactos | `packages/shared/catalog/averias.json` | Daño y tiempo de arreglo de fuego, corto y fuga; impactos; desgaste; kits |
| Tipos de destino | `packages/shared/catalog/destinos.json` | Peligros por año luz, contenedores, si tiene terminal de estación (`shop`; `service` está obsoleto), si es explorable |
| Reglas de sector | `packages/shared/catalog/sectores.json` | Columnas, distancias, crecimiento del peligro, sílabas de los nombres |
| Superficie (mundos, materiales, reglas) | `packages/shared/catalog/mundos.json` | Gravedad, descenso, tormentas, terreno inestable, tabla de materiales, traje, jetpack, caídas, racha |
| Economía | `packages/shared/catalog/economia.json` | Créditos iniciales, contrato por sector, precios de venta y de suministros, multiplicadores por sector, ayuda de emergencia, masa de referencia del combustible, tamaño de la oferta |
| Mejoras de nave y equipo | `packages/shared/catalog/mejoras.json` | Niveles con precio, masa y efectos (`mult` y luego `add`) sobre campos permitidos de la nave o del traje; cada nivel debe tener contrapartida |

Pasos:
1. Mide el punto de partida: `pnpm balance` (guarda la salida).
2. Cambia el JSON. Unidades según el nombre del campo (`Ly` años luz, `Kw`, `Pct`, `S` segundos, `PerS` por segundo).
3. Textos (`name`) en **es y en**, cortos.
4. Un **tipo de destino nuevo** no es solo datos: `NodeKind` es una unión cerrada en `types.ts`
   (`NODE_KINDS`), y el cliente le da símbolo y aspecto (`ui/StarMap.tsx`, `scenes/SpaceView.tsx`).
   Pide el cambio de motor a `sim-engine` y el de cliente a `client-3d`.
   Un **mundo nuevo** es solo datos para el motor (su `kind` debe ser aterrizable y los materiales deben
   existir), pero el cliente le da paleta y relieve en `gfx/surfaceLook.ts` (`SURFACE_LOOKS`) y
   `game/terrain.ts` (`TERRAIN_STYLES`); sin ellos usa los de la luna de polvo. Pásalo a `client-3d`.
   Tras tocar superficie mira también el bloque «superficie» y la curva de márgenes de `pnpm balance`.
   Una **mejora nueva** es solo datos si usa campos permitidos (`UPGRADE_FIELDS`); necesita nombre y efecto es/en, y
   el test de `economy.test.ts` exige contrapartida (precio, masa, consumo o O₂) y que con todas las mejoras exista una configuración jugable. Tras tocar
   precios o mejoras mira el bloque de economía de `pnpm balance` (mejoras por partida, créditos ganados y gastados).
5. Comprueba:
   ```bash
   pnpm --filter @payload/shared test   # esquema, sectores completables, mensajes y umbrales de balance
   pnpm balance                         # compara con el punto de partida
   ```
6. Criterio: una tripulación atenta supera casi siempre el sector 1; sin atender averías casi nunca; el
   sector 4 no está garantizado. Si una opción pasa a ser siempre la mejor, el compromiso se ha roto.
7. Anota el cambio de balance en `docs/STATUS.md` y, si cambia el diseño, en `docs/GDD.md`.
