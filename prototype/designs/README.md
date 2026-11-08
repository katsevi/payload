# Diseños de ejemplo (`MissionDesign`) — escenario `leo-earth-observation`

Los usan `pnpm proto` y los tests de balance (`packages/shared/src/__tests__/balance.test.ts`).
Semilla por defecto del escenario: `20260101`. El cliente usa una semilla por intento:
`defaultSeed + nº de intento` (intento 0 = `defaultSeed`).

| Diseño | Go/No-Go | Qué enseña |
| --- | --- | --- |
| `ok-cubesat-leo` | Go | Solución barata: CubeSat 12U en lanzamiento compartido; limita el calendario. |
| `ok-microsat-sso-hires` | Go | Alta resolución en SSO con banda X; presupuesto justo. |
| `ok-microsat-leo-thermal` | Go | Multiespectral + térmica con batería grande; comunicaciones justas. |
| `warn-power-storm` | Go con aviso `power-storm` | Energía al límite (margen ~6 %). Completa la misión con muchas semillas, pero **falla en operación con `defaultSeed+1`, `+4` y `+7`**: una tormenta solar la hace bajar de la DoD, se agota y la batería queda inservible. Con `+2` falla el lanzamiento (Colibrí-1, 94 %). |
| `fail-battery-eclipse` | No-Go (`battery`) | La cámara térmica (60 W) con una batería de 40 Wh no cubre los 36 min de sombra; en simulación la batería se desgasta y muere en horas. |
| `fail-mass-rideshare` | No-Go (`mass-launcher`) | 31 kg en un lanzamiento compartido que admite 30 kg en LEO: fallo puro de masa. |
| `fail-data-uhf` | Go con avisos | La radio UHF solo baja 43 Mbit/día: completa la misión pero pierde casi todos los datos. |
| `fail-budget-gold-plated` | No-Go (`budget`) | "Todo incluido": 38 M USD de 30. Puntúa por debajo de las soluciones válidas. |
| `warn-sso-low-resolution` | Go con aviso | La cámara básica en SSO (700 km) ve 42 m y se piden 35 m. |
