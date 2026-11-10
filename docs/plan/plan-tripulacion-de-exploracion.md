# Plan del juego (v2): tripulación de exploración

> Plan vigente desde el 2026-11-09. Sustituye al plan del simulador de diseño de misiones
> (`docs/archivo/v0.3-simulador/plan-original/`). Motivo del cambio y qué se reutilizó: ADR 0011.
> Este archivo recoge el plan tal como lo escribió el equipo; el diseño detallado está en `docs/GDD.md`
> y el reparto en fases de desarrollo en `docs/phases/`.

## 1. Resumen ejecutivo (concepto del juego)

Un videojuego cooperativo de supervivencia y gestión de recursos espaciales para 1 a 4 jugadores. Los
jugadores forman la tripulación de una nave exploradora encargada de viajar de planeta en planeta,
descender a superficies peligrosas (lunas, asteroides y mundos remotos) para recolectar materiales
valiosos, venderlos y mejorar los sistemas de la nave. Todo esto mientras gestionan recursos críticos en
tiempo real y enfrentan el riesgo constante del permadeath (pérdida total si la nave es destruida o la
tripulación perece).

## 2. Pilares de jugabilidad y mecánicas principales

### Fase 1: viaje interplanetario y gestión de ruta

- **Selección de destino:** trazar rutas entre sistemas estelares consumiendo combustible de la nave. Ir
  más lejos requiere mejores motores, pero aumenta el costo y el riesgo.
- **Mantenimiento de la nave:** monitorear el estado de salud general de la nave. Los choques o
  aterrizajes bruscos dañan el casco, rompen sistemas y provocan fallos eléctricos o fugas de oxígeno.

### Fase 2: exploración de superficie (riesgo vs. recompensa)

- **Descenso a superficie:** salir de la órbita para aterrizar en asteroides o planetas (enfrentando
  gravedades distintas, tormentas o terrenos inestables).
- **Mochilas propulsoras (jetpacks):** uso de propulsores personales para navegar por terrenos de baja
  gravedad, superar abismos o escapar de peligros, gestionando cuidadosamente el combustible de la mochila.
- **Oxígeno limitado:** cada tripulante lleva un tanque de oxígeno personal con capacidad limitada.
  Quedarse demasiado tiempo recolectando minerales raros pone en riesgo la vida de todo el equipo.

### Fase 3: economía y progresión (mejoras)

- **Recolección y venta:** extraer minerales y muestras científicas para venderlos al regresar a
  estaciones espaciales seguras.
- **Mejoras de equipamiento:** invertir las ganancias en mejorar el rendimiento de la nave (tanques de
  combustible más grandes, escudos, motores de salto) y el equipo personal (trajes más resistentes,
  tanques de oxígeno ampliados, mejores jetpacks).

## 3. Dinámica cooperativa y roles de la tripulación (hasta 4 jugadores)

Para superar las misiones, la tripulación debe dividirse las tareas de forma táctica y comunicarse bajo
presión:

- **El Piloto:** controla la nave durante el vuelo y ejecuta las maniobras críticas de aterrizaje y
  despegue, intentando minimizar los daños estructurales por impacto.
- **El Ingeniero:** encargado de reparar averías en tiempo real (cortocircuitos, incendios, fugas de
  oxígeno) y apagar sistemas defectuosos.
- **El Gestor de Recursos:** monitorea los niveles críticos de energía del reactor, las reservas de
  combustible de la nave y las coordenadas de navegación.
- **El Explorador / Científico:** lidera las salidas a la superficie, recolecta los materiales más
  valiosos y vigila el tiempo límite antes de que se agote el soporte vital.

## 4. Ciclo del juego (core loop)

1. **Planificar** la ruta y verificar suministros de combustible y oxígeno en la nave.
2. **Viajar** al sistema estelar seleccionado lidiando con eventos aleatorios o fallos mecánicos en tránsito.
3. **Aterrizar / explorar** la superficie de forma cooperativa usando propulsores y recolectando recursos
   bajo presión de tiempo y oxígeno.
4. **Regresar y mejorar** para vender el botín, reparar los daños acumulados y comprar mejoras que
   permitan alcanzar planetas cada vez más lejanos y peligrosos.

Nota de tensión: si la nave explota o toda la tripulación muere en la superficie, la partida se pierde y
se reinicia el progreso.

## 5. Por qué este concepto destaca para un reto/hackathon

- **Cumple con los requerimientos:** integra de forma orgánica las compensaciones de ingeniería
  (trade-offs entre peso, potencia, recursos y motores) exigidas por las bases del reto espacial.
- **Alta rejugabilidad y diversión:** cambia la típica simulación académica aburrida por una experiencia
  dinámica, tensa y altamente cooperativa tipo party game espacial.
