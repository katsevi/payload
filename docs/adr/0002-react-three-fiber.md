# 0002 · React Three Fiber en vez de Babylon.js

- Estado: aceptada
- Fecha: 2026-11-07

## Contexto
Se necesita un motor 3D web para hangar, sala de control y órbita, con mucha interfaz 2D encima (paneles de recursos, informes). Babylon.js es más completo (editor, audio integrado); Three.js con React Three Fiber (R3F) es más ligero.

## Decisión
Usar **Three.js + React Three Fiber v9 + Drei**, con Rapier (`@react-three/rapier`) para física y controlador de personaje. WebGL 2 de base; WebGPU opcional cuando se justifique.

## Consecuencias
- La escena 3D y la UI comparten el modelo de componentes de React; las consolas diegéticas reutilizan los mismos paneles.
- Ecosistema pmndrs (Drei, postprocessing, Rapier) cubre controles, carga de GLB y efectos.
- Hay que aportar audio y herramientas de edición por separado (Web Audio/Howler).
- Cambiar de motor más adelante sería costoso: el motor de simulación se mantiene aislado de los gráficos justamente para limitar ese riesgo (ADR 0003).
