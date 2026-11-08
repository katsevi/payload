# 0006 · Pipeline de assets y registro de licencias

- Estado: aceptada
- Fecha: 2026-11-07

## Contexto
Los cuatro modelos iniciales pesan entre 1.8 y 32 MB (ERIZON ≈ 32 MB, Aurora G9 ≈ 23 MB), demasiado para la web. Además tienen licencias distintas: tres CC-BY-4.0 y una CC-BY-NC-ND-4.0 (ERIZON: sin uso comercial ni derivados).

## Decisión
- Los **originales** viven intactos en `assets/models/source/` y no se modifican nunca.
- Los **optimizados** se generan con gltf-transform (meshopt; KTX2 para texturas cuando convenga) en `assets/web/models/`, que es el `publicDir` de Vite.
- Todo asset se registra en `assets/CREDITS.md` con autor, fuente y licencia.
- ERIZON se mantiene aislado y retirable; la compresión técnica de un modelo ND debe revisarse (puede contar como obra derivada) y, en caso de duda, se sirve sin tocar o se sustituye.

## Consecuencias
- El repositorio guarda binarios pesados (valorar Git LFS).
- Cargas diferidas por escena para no penalizar el menú.
- Si el juego se vuelve comercial, ERIZON debe sustituirse.
- Quien añada un modelo debe actualizar `CREDITS.md` y la pantalla de créditos.
