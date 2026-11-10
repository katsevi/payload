---
name: validate
description: Validación completa de Payload antes de entregar una tarea o cerrar una fase - typecheck, tests, build, reglas del proyecto (motor puro, determinismo, i18n es/en, licencias de assets). Úsala cuando digan "valida", "revisa que todo esté bien" o antes de un commit/PR.
---

# Validar Payload

Ejecuta en orden desde la raíz del repo y detente a reportar en el primer fallo real:

1. `pnpm validate` — typecheck + test + build de todos los paquetes (Turborepo).
2. Reglas estáticas:
   ```bash
   grep -rnE "Math\.random|Date\.now" packages/shared/src --include=*.ts | grep -v __tests__   # debe salir vacío
   grep -rnE "from ['\"](react|three|@react-three)" packages/shared/src                       # debe salir vacío
   ```
3. Paridad i18n: los tests de `packages/shared` y `apps/client` comparan las claves de `es` y `en`;
   si fallan, añade la clave que falta en el otro idioma.
4. Assets: cada archivo de `assets/models/` aparece en `assets/CREDITS.md`.
5. Si tocaste el motor o `packages/shared/catalog/*.json`: `pnpm balance` y compara con las cifras de `docs/STATUS.md`.
6. Si tocaste la escena 3D: no hay tests de renderizado; ábrela (`pnpm dev`, `?play=1&seed=7`) o di que no se comprobó en pantalla.
7. Si cerraste una tarea relevante, `docs/STATUS.md` está actualizado.

Para una revisión independiente y más profunda, delega en el agente `validator`.
