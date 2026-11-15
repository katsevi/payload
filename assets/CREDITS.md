# Créditos de assets (modelos 3D y tipografías)

Todos los modelos son de Sketchfab. Los originales están en `models/source/` y los versiones optimizadas para la web en `web/models/`.

| Archivo | Título | Autor | Fuente | Licencia | Uso en el juego | Cambios respecto al original |
| --- | --- | --- | --- | --- | --- | --- |
| `astronaut_by_jungle_jim.glb` | Astronaut by Jungle Jim | [Jungle Jim](https://sketchfab.com/jungle_jim) | [Enlace](https://sketchfab.com/3d-models/astronaut-by-jungle-jim-c775a977606a4e4e990afe783c6bc845) | [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/) | Sin uso desde la fase 5 (sin esqueleto: lo sustituye el astronauta articulado procedural). Se sigue sirviendo en `web/models/`. Antes: avatar del jugador en 3ª persona | Modificado: compresión meshopt, texturas WebP, fusión de mallas y paletas de materiales (28 → 3 nodos, 14 → 3 materiales, 2 texturas nuevas) |
| `aurora_g9_expedition_walker_mech.glb` | Aurora G9 Expedition Walker Mech | [Jungle Jim](https://sketchfab.com/jungle_jim) | [Enlace](https://sketchfab.com/3d-models/aurora-g9-expedition-walker-mech-943b364f0a01414c9828d345a19fb900) | [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/) | Sin uso en la fase 1; reservado como vehículo de la exploración de superficie (fase 2). Se sigue sirviendo en `web/models/` | Modificado: compresión meshopt, texturas WebP (máx. 2048 px), fusión de mallas (457 → 15 nodos, 341 → 15 mallas) y paleta de materiales |
| `our_milky_way_galaxy.glb` | Our Milky Way galaxy | [aditya299792](https://sketchfab.com/aditya299792) | [Enlace](https://sketchfab.com/3d-models/our-milky-way-galaxy-f4d5ff16b66c4ed38bc07402030cbc30) | [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/) | Fondo del menú y holograma de la mesa del mapa estelar | Modificado: compresión meshopt y fusión de mallas (5 → 1 nodos) |
| `programme_erizon.glb` | Programme ERIZON | [nejenabinupa](https://sketchfab.com/nejenabinupa) | [Enlace](https://sketchfab.com/3d-models/programme-erizon-1dfbae39ee674334848da02301b77d68) | [CC-BY-NC-ND-4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/) | Estación espacial que se ve por la proa al atracar en una estación | Modificado técnicamente solo con compresión de geometría (`gltf-transform meshopt`): sin fusionar ni instanciar mallas, sin cambiar nodos ni texturas (82 nodos, 51 mallas, 3 texturas PNG, verificado con inspect.sh). Añade compresión meshopt y cuantización de vértices (pérdida mínima de precisión) |
| `sci-fi_computer_desk_console.glb` | Sci-Fi Computer Desk Console | [Inditrion Dradnon](https://sketchfab.com/dradnon) | [Enlace](https://sketchfab.com/3d-models/sci-fi-computer-desk-console-28c67457f2ef4973a0bbc8b667bb183f) | [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/) | Timón de la nave (puente) | Modificado: compresión meshopt, texturas JPEG/PNG → WebP (máx. 2048 px) y fusión de mallas (6 → 3 nodos) |

## Advertencia: ERIZON (CC-BY-NC-ND-4.0)

- **No comercial:** no puede usarse si Payload se vende o monetiza de ninguna forma.
- **Sin derivados:** no puede modificarse. La versión en `web/models/` solo tiene compresión de geometría (meshopt y cuantización de vértices), sin cambiar la estructura de mallas ni las texturas, pero sigue siendo una modificación técnica.
- **Recomendación:** sustituir ERIZON por un modelo CC0 o CC-BY antes de cualquier uso comercial.

## Atribución

Para los modelos CC-BY, la pantalla de créditos del juego debe mostrar el título, el autor con enlace, la licencia y la indicación de que el modelo fue modificado.

### Aurora G9 (reservado para la fase 2: vehículo de exploración)

- CC-BY-4.0 permite uso comercial y derivados (incluido el uso como vehículo lunar/marciano), siempre con atribución.
- Atribución mínima: título, autor (Jungle Jim, con enlace), enlace al original, enlace a la licencia CC-BY-4.0 y la indicación "modificado" (compresión, texturas WebP y fusión de mallas).
- No se usa el logo ni la marca de Sketchfab ni del autor para promocionar el juego.

## Tipografías de la interfaz (OFL 1.1)

Se empaquetan con el cliente desde npm (`@fontsource/*`, solo el subconjunto latino; sin peticiones a Google en
ejecución). La SIL Open Font License 1.1 permite uso comercial, incrustación y redistribución con la licencia; no
permite vender la fuente sola ni usar sus nombres reservados en una versión modificada (no se modifican).

| Tipografía | Autor | Fuente | Licencia | Uso | Paquete |
| --- | --- | --- | --- | --- | --- |
| Chakra Petch | [Cadson Demak](https://github.com/cadsondemak/Chakra-Petch) | [Google Fonts](https://fonts.google.com/specimen/Chakra+Petch) | [OFL-1.1](https://openfontlicense.org/open-font-license-official-text/) | Títulos, botones y etiquetas | `@fontsource/chakra-petch` (500, 600, 700) |
| Barlow | [Jeremy Tribby](https://github.com/jpt/barlow) | [Google Fonts](https://fonts.google.com/specimen/Barlow) | [OFL-1.1](https://openfontlicense.org/open-font-license-official-text/) | Texto de la interfaz | `@fontsource/barlow` (400, 500, 600) |
| JetBrains Mono | [JetBrains](https://www.jetbrains.com/lp/mono/) | [Google Fonts](https://fonts.google.com/specimen/JetBrains+Mono) | [OFL-1.1](https://openfontlicense.org/open-font-license-official-text/) | Cifras y códigos | `@fontsource-variable/jetbrains-mono` |

## Gráficos procedurales (sin atribución de assets)

El casco, los puestos, los efectos y los cuerpos celestes (planetas, luna, asteroides, nebulosa, pecio,
portal) no son archivos: se generan en código en `apps/client/src/gfx/` (texturas de canvas, geometría y
shaders propios). No requieren atribución.

Código de terceros incluido en esos shaders:

| Qué | Autor | Fuente | Licencia | Dónde |
| --- | --- | --- | --- | --- |
| Ruido simplex 3D (`snoise`) | Ian McEwan, Ashima Arts | [webgl-noise](https://github.com/ashima/webgl-noise) | MIT | `apps/client/src/gfx/glsl.ts` (`NOISE3`) |
| Hash sin seno (`hash21`, `hash33`) | Dave Hoskins | [Hash without Sine](https://www.shadertoy.com/view/4djSRW) | MIT | `apps/client/src/gfx/glsl.ts`, `spaceShaders.ts` |

## Audio

No hay archivos de audio todavía: el audio se genera de forma procedural con Web Audio y no requiere atribución.
Cualquier archivo de audio futuro va en `assets/web/audio/` y se registra aquí con título, autor, fuente, licencia (si es CC-BY, con su atribución) y uso en el juego.
