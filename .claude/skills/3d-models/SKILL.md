---
name: 3d-models
description: Inspeccionar, optimizar, añadir o auditar modelos GLB/glTF de Payload y sus licencias (assets/models, assets/web/models, CREDITS.md). Úsala cuando pidan revisar un modelo 3D, reducir su peso, añadir uno nuevo o comprobar atribuciones y licencias de assets.
---

# Modelos 3D en Payload

## Estructura de `assets/`

- `assets/models/source/`: originales de Sketchfab. **Nunca se modifican.** Se conservan en git.
- `assets/web/models/`: optimizados que sirve Vite como `/models/<archivo>.glb`. Mismo nombre que el original.
- `assets/CREDITS.md`: atribuciones y licencias de cada modelo. Debe listar todo archivo de `assets/models/`.
- `assets/README.md`: cómo regenerar los optimizados.

## Herramientas

Desde la raíz del repo (sin `pnpm add`; `@gltf-transform/cli` v4.5.1 ya es devDependency):

- `pnpm exec gltf-transform inspect <archivo> --format md`: tablas de mallas, texturas y materiales.
- `.claude/skills/3d-models/scripts/inspect.sh <archivo.glb> [--full]`: resumen rápido (tamaño, vértices, texturas, extensiones y `asset.extras` de licencia).
- `.claude/skills/3d-models/scripts/optimize.sh <origen> <destino> [--preserve]`: optimiza y muestra tamaños antes/después. Con `--preserve` usa solo `meshopt`.
- `pnpm exec gltf-transform optimize --help`: lista completa de flags.
- Operaciones sueltas (`prune`, `dedup`, `resize`, `webp`, `meshopt`) existen en gltf-transform. Para CC-BY basta `optimize`. Para ND usa solo `meshopt`.

### Comandos usados (v4.5.1)

CC-BY (astronauta, Aurora, galaxia):
```bash
pnpm exec gltf-transform optimize assets/models/source/<archivo>.glb assets/web/models/<archivo>.glb \
  --compress meshopt --texture-compress webp --texture-size 2048 --simplify false
```

ERIZON (CC-BY-NC-ND), modo `--preserve`: solo compresión de geometría, sin usar `optimize`:
```bash
pnpm exec gltf-transform meshopt assets/models/source/programme_erizon.glb assets/web/models/programme_erizon.glb
```

Antes de `optimize` en CC-BY, ten en cuenta que también puede cambiar la estructura: fusiona mallas (`join`), aplana nodos (`flatten`) y agrupa materiales en paletas (`palette`, p. ej. astronauta 14 → 3 materiales con 2 texturas nuevas). Es legal en CC-BY, pero debe quedar reflejado en la columna "Cambios" de `CREDITS.md`.

Por qué no `optimize` en ERIZON: `optimize` fusiona mallas (`join`), aplana la escena (`flatten`), crea instancias (`instance`, que añade `EXT_mesh_gpu_instancing`), genera paletas (`palette`) y recomprime o redimensiona texturas. Cada una de esas operaciones modifica la estructura del modelo, algo que una licencia ND no permite. El comando `meshopt` solo comprime la geometría: el número de nodos y mallas se mantiene (82 nodos y 51 mallas en ERIZON) y las texturas no cambian. Sí añade cuantización de vértices (`KHR_mesh_quantization`), que es una pérdida mínima de precisión.

Nota: `--simplify false` es obligatorio siempre. Ninguna configuración simplifica geometría en este proyecto.

## Reglas de licencia

| Licencia | Permitido | Obligatorio | Prohibido |
| --- | --- | --- | --- |
| CC-BY-4.0 | Usar, modificar, comercializar | Atribución (autor, título, enlace, licencia) en `assets/CREDITS.md` y en la pantalla de créditos; indicar cambios | Quitar la atribución |
| CC-BY-NC-ND-4.0 | Uso no comercial, sin derivados | Atribución; solo conversiones técnicas sin cambio de aspecto | Uso comercial/monetización; simplificar geometría; reducir texturas; cualquier adaptación visible |

- Si Payload se vende o monetiza, **ERIZON no puede usarse**. Sustitúyelo antes.
- Un cambio técnico (meshopt, cuantización de vértices, WebP) sigue siendo una modificación. Para ND, documenta el cambio en `CREDITS.md` y consulta si es aceptable.
- Para ND nunca uses `optimize`: fusiona mallas e instancia, cambiando la estructura del modelo (ver arriba).

## Cargar en R3F

El cliente usa `@react-three/fiber` 9 y `@react-three/drei` 10.

```tsx
import { Suspense } from 'react';
import { useGLTF } from '@react-three/drei';

const MODEL = '/models/astronaut_by_jungle_jim.glb';
useGLTF.preload(MODEL); // al cargar el módulo, para que no haya espera al montar

function Astronaut() {
  const { scene } = useGLTF(MODEL); // Drei configura el decodificador meshopt
  return <primitive object={scene} />;
}

// Uso: <Suspense fallback={null}><Astronaut /></Suspense>
```

- `useGLTF` suspende; envuelve siempre el componente en `<Suspense>`.
- Si un modelo se usa varias veces, clona la escena (`scene.clone()`) para no compartir el mismo nodo.
- Verifica en el navegador que las texturas WebP y la geometría meshopt cargan (sin errores en consola).

## Presupuestos de rendimiento

- Modelo de escena: **< 5 MB** en `assets/web/models/`. Si supera el límite, revisa primero las texturas.
- Texturas: **≤ 2048 px** por lado (el valor por defecto de `optimize`).
- Vértices: sin objetivo fijo, pero vigila escenas con decenas de miles de mallas. Usa `join` (activo por defecto) cuando no haya animación por pieza.

## Usar un modelo en una escena del cliente

El cliente ya tiene el patrón montado; no crees un loader nuevo:

- `apps/client/src/models/urls.ts`: mapa `MODEL_URLS` (clave → `/models/<archivo>.glb`). Añade ahí la URL de un modelo nuevo.
- `apps/client/src/models/Models.tsx`: componentes listos. `FittedModel` clona la escena, la escala a `size`/`height` y la centra u origina en los pies (`origin`). Para un modelo nuevo, añade un componente como `AstronautModel`/`ErizonStation`, envuelto en `ModelBoundary` (muestra una forma simple si el GLB falla) y en `<Suspense>`.
- Carga diferida para GLB pesados (> 3 MB): patrón `WalkerExhibit`/`ErizonStation` con `useState` + `setTimeout`, para no frenar el arranque. Los ligeros pueden precargarse con `preloadModels()`.
- Créditos: además de `assets/CREDITS.md`, registra el modelo en `apps/client/src/data/credits.ts` (regla de `apps/client/CLAUDE.md`).
- Cambios en `apps/client/` los hace el agente `client-3d` o quien lleve la escena; la skill solo define el contrato.

## Checklist: añadir un modelo nuevo

1. Comprueba la licencia en Sketchfab. Si no es CC-BY ni CC0, no lo añadas sin consultar.
2. Copia el `.glb` original a `assets/models/source/` con nombre en minúsculas y guiones bajos.
3. Inspecciona: `.claude/skills/3d-models/scripts/inspect.sh assets/models/source/<archivo>.glb`. Revisa `asset.extras` (autor, licencia, fuente).
4. Elige el comando de optimización: CC-BY con `optimize.sh` (por defecto); ND con `--preserve`.
5. Genera el optimizado en `assets/web/models/` con el mismo nombre. Comprueba que abre (`inspect.sh`) y compara tamaños.
6. Añade una fila a `assets/CREDITS.md` (título, autor con enlace, fuente, licencia con enlace, uso en el juego, si fue modificado).
7. Añade la atribución a la pantalla de créditos del juego.
8. Carga el modelo con `useGLTF` y `<Suspense>`, y prueba en el navegador.
9. Ejecuta la skill `validate` (incluye la comprobación de que cada modelo aparezca en `CREDITS.md`).
