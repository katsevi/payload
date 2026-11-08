#!/usr/bin/env bash
# Resumen rápido de un GLB: tamaño, mallas, vértices, texturas, extensiones y metadatos de licencia.
# Uso: inspect.sh <archivo.glb> [--full]   (--full añade la tabla completa de gltf-transform)
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Uso: $0 <archivo.glb> [--full]" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
INPUT="$(realpath "$1")"
FULL="${2:-}"

[[ -f "$INPUT" ]] || { echo "No existe: $INPUT" >&2; exit 1; }

echo "== Archivo: $INPUT"
echo "== Tamaño: $(du -h "$INPUT" | cut -f1) ($(stat -c %s "$INPUT") bytes)"

# Lee el chunk JSON de la cabecera GLB (magic glTF, versión 2, longitud, chunk JSON).
node -e '
const fs = require("fs");
const buf = fs.readFileSync(process.argv[1]);
if (buf.toString("ascii", 0, 4) !== "glTF") { console.error("No es un GLB válido"); process.exit(1); }
const jsonLen = buf.readUInt32LE(12);
const gltf = JSON.parse(buf.toString("utf8", 20, 20 + jsonLen));

const accessors = gltf.accessors || [];
let vertices = 0, triangles = 0;
const meshes = gltf.meshes || [];
for (const m of meshes) for (const p of m.primitives || []) {
  const pos = accessors[p.attributes?.POSITION];
  if (pos) vertices += pos.count;
  if (p.indices !== undefined) triangles += accessors[p.indices].count / 3;
  else if (pos) triangles += pos.count / 3;
}
const images = gltf.images || [];
const mimes = [...new Set(images.map(i => i.mimeType || (i.uri ? i.uri.split(".").pop() : "?")))];

console.log(`== Generador: ${gltf.asset?.generator ?? "desconocido"} (glTF ${gltf.asset?.version ?? "?"})`);
console.log(`== Escenas: ${(gltf.scenes || []).length} | Nodos: ${(gltf.nodes || []).length} | Mallas: ${meshes.length} | Materiales: ${(gltf.materials || []).length}`);
console.log(`== Vértices: ${vertices.toLocaleString("es-ES")} | Triángulos aprox.: ${Math.round(triangles).toLocaleString("es-ES")}`);
console.log(`== Texturas: ${(gltf.textures || []).length} | Imágenes: ${images.length} | Formatos: ${mimes.join(", ") || "ninguno"}`);
console.log(`== Animaciones: ${(gltf.animations || []).length}`);
console.log(`== Extensiones usadas: ${(gltf.extensionsUsed || []).join(", ") || "ninguna"}`);
console.log(`== Extensiones requeridas: ${(gltf.extensionsRequired || []).join(", ") || "ninguna"}`);
console.log(`== asset.extras: ${JSON.stringify(gltf.asset?.extras ?? {}, null, 2)}`);
' "$INPUT"

if [[ "$FULL" == "--full" ]]; then
  (cd "$ROOT" && pnpm exec gltf-transform inspect "$INPUT" --format md)
fi
