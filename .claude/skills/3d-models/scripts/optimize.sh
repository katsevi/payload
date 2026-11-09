#!/usr/bin/env bash
# Optimiza un GLB con gltf-transform v4.5.1 y muestra tamaños antes/después.
# Uso: optimize.sh <origen> <destino> [--preserve]
#   (por defecto) comando `optimize`: meshopt + texturas WebP máx. 2048 px, sin simplificar geometría.
#   --preserve    modo seguro para licencias ND: solo el comando `meshopt` (compresión de geometría).
#                 No usa optimize, así que no hay join, flatten, instance, palette, simplify ni resize.
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Uso: $0 <origen> <destino> [--preserve]" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
MODE="${3:-}"

[[ -f "$1" ]] || { echo "No existe el origen: $1" >&2; exit 1; }
INPUT="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
mkdir -p "$(dirname "$2")"
OUTPUT="$(cd "$(dirname "$2")" && pwd)/$(basename "$2")"

case "$MODE" in
  --preserve)
    CMD=(meshopt "$INPUT" "$OUTPUT") ;;
  "")
    CMD=(optimize "$INPUT" "$OUTPUT" --compress meshopt --texture-compress webp --texture-size 2048 --simplify false) ;;
  *)
    echo "Opción desconocida: $MODE (usa --preserve o nada)" >&2; exit 1 ;;
esac

(cd "$ROOT" && pnpm exec gltf-transform "${CMD[@]}")

# wc -c en vez de `stat -c` (portable: Git Bash, macOS y Linux)
before=$(wc -c < "$INPUT" | tr -d ' ')
after=$(wc -c < "$OUTPUT" | tr -d ' ')
awk -v b="$before" -v a="$after" -v n="$(basename "$OUTPUT")" \
  'BEGIN { printf "%s: %.2f MB -> %.2f MB (%.1f%%)\n", n, b/1048576, a/1048576, (a/b)*100 }'
