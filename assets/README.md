# Assets

```
assets/
├── CREDITS.md            # Atribuciones y licencias de cada modelo (obligatorio)
├── models/
│   └── source/           # Originales de Sketchfab. No se modifican.
└── web/
    └── models/           # Optimizados que sirve Vite como /models/<archivo>.glb
```

## Regenerar los optimizados

Ejecuta estos comandos desde la raíz del proyecto:

```bash
# CC-BY-4.0: compresión meshopt + texturas WebP (máx. 2048 px), sin simplificar
.claude/skills/3d-models/scripts/optimize.sh assets/models/source/astronaut_by_jungle_jim.glb assets/web/models/astronaut_by_jungle_jim.glb
.claude/skills/3d-models/scripts/optimize.sh assets/models/source/aurora_g9_expedition_walker_mech.glb assets/web/models/aurora_g9_expedition_walker_mech.glb
.claude/skills/3d-models/scripts/optimize.sh assets/models/source/our_milky_way_galaxy.glb assets/web/models/our_milky_way_galaxy.glb
.claude/skills/3d-models/scripts/optimize.sh assets/models/source/sci-fi_computer_desk_console.glb assets/web/models/sci-fi_computer_desk_console.glb

# CC-BY-NC-ND-4.0: solo compresión de geometría (modo --preserve = comando meshopt, sin fusionar ni instanciar)
.claude/skills/3d-models/scripts/optimize.sh assets/models/source/programme_erizon.glb assets/web/models/programme_erizon.glb --preserve
```

Para revisar un modelo: `.claude/skills/3d-models/scripts/inspect.sh <archivo.glb>`.

## Originales en el repositorio

Los originales de `models/source/` se suben al repositorio de GitHub para que el proyecto pueda regenerar los optimizados. El más grande (`programme_erizon.glb`) pesa unos 31 MB, por debajo del límite de 100 MB de GitHub. Si los assets crecen, considera Git LFS.

## Audio

- El audio se genera de forma procedural con Web Audio API: no hay archivos de audio que versionar.
- Todo archivo de audio futuro va en `assets/web/audio/` (URL `/audio/<archivo>`) y se registra en `assets/CREDITS.md` con autor, fuente, licencia y uso en el juego.
- Formatos recomendados: `.m4a` o `.ogg` (la `.m4a` ya está marcada como binaria en `.gitattributes`).
