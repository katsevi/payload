# 0004 · Contenido en JSON validado con zod

- Estado: aceptada
- Fecha: 2026-11-07

## Contexto
Componentes, órbitas, lanzadores y escenarios cambiarán mucho (balance, nuevas misiones, tareas de diseño no programadoras). Mezclarlos con el código frena la iteración.

## Decisión
El contenido vive en `packages/shared/catalog/{componentes,orbitas,lanzadores,escenarios}.json`, con textos en `LocalizedText` (es/en). Se **valida con zod** al cargar; un archivo inválido produce un error legible. Añadir contenido no requiere tocar código.

## Consecuencias
- Diseñadores pueden editar datos; los prototipos (CLI, hoja de cálculo) leen el mismo catálogo.
- Los tipos de `types.ts` y los esquemas zod deben mantenerse alineados.
- El balance se protege con tests (varias soluciones válidas y varias causas de fallo).
- Reglas con comportamiento nuevo (no solo valores) sí requieren código.
