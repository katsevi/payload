/**
 * Shaders de la superficie: el suelo (grietas del terreno inestable, frontera del área y lava), el
 * cielo de cada mundo, el polvo de la tormenta, haces de luz (baliza de la nave, muestras) y la llama
 * de los propulsores del descenso. Todo el movimiento sale del reloj común `TIME`.
 */
import { AdditiveBlending, BackSide, Color, DoubleSide, NormalBlending, ShaderMaterial, Vector2, Vector3, Vector4, type MeshStandardMaterial } from 'three';
import { once } from './build';
import { VIEW_H } from './fxShaders';
import { NOISE2, TIME } from './glsl';
import type { SurfaceLook } from './surfaceLook';
import { puffTexture } from './textures';

/** Zonas de terreno inestable que pinta el suelo (las que caben en el shader). */
export const MAX_SHADER_ZONES = 8;

export interface TerrainUniforms {
  /** x, z, radio, estado (−1 hundida, 0 quieta, 0-1 crujiendo). */
  uZones: { value: Vector4[] };
  uZoneCount: { value: number };
  uRadius: { value: number };
  /** Explanada de aterrizaje: x, z, radio de la marca. */
  uPad: { value: Vector3 };
  uLava: { value: Color };
  uLavaOn: { value: number };
  uTime: typeof TIME;
}

export function terrainUniforms(): TerrainUniforms {
  return {
    uZones: { value: Array.from({ length: MAX_SHADER_ZONES }, () => new Vector4(0, 0, 0, -1)) },
    uZoneCount: { value: 0 },
    uRadius: { value: 100 },
    uPad: { value: new Vector3(0, 0, 0) },
    uLava: { value: new Color('#ff5a14') },
    uLavaOn: { value: 0 },
    uTime: TIME,
  };
}

/**
 * Añade al material estándar del suelo: grietas siempre visibles en el terreno inestable (que se
 * encienden al crujir), una línea discontinua en el borde del área explorable y lava en los abismos.
 */
export function patchTerrainMaterial(material: MeshStandardMaterial, u: TerrainUniforms): void {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        varying vec3 vWorldPos;
        uniform vec4 uZones[${MAX_SHADER_ZONES}];
        uniform int uZoneCount;
        uniform float uRadius;
        uniform vec3 uPad;
        uniform vec3 uLava;
        uniform float uLavaOn;
        uniform float uTime;
        ${NOISE2}
        float crackLines(vec2 p) {
          float a = 1.0 - smoothstep(0.012, 0.045, abs(vnoise(p * 0.55) - 0.5));
          float b = 1.0 - smoothstep(0.015, 0.05, abs(vnoise(p * 1.6 + 7.3) - 0.5));
          return max(a, b * 0.8);
        }
        float zMask = 0.0;
        float zHeat = 0.0;
        float zEdge = 0.0;`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        for (int i = 0; i < ${MAX_SHADER_ZONES}; i++) {
          if (i >= uZoneCount) break;
          vec4 zn = uZones[i];
          if (zn.w < -0.5) continue;
          float d = length(vWorldPos.xz - zn.xy);
          float inside = 1.0 - smoothstep(zn.z * 0.8, zn.z * 1.08, d);
          zMask = max(zMask, inside);
          zHeat = max(zHeat, inside * zn.w);
          zEdge = max(zEdge, 1.0 - smoothstep(0.0, 0.3, abs(d - zn.z)));
        }
        // Ramas: el ruido de las grietas y de la lava solo se evalúa donde se ve (zonas inestables, fondo con lava).
        // Son regiones grandes y contiguas, así que la rama es coherente y ahorra casi todo el coste en el resto.
        float cracks = 0.0;
        if (zMask > 0.0) {
          cracks = crackLines(vWorldPos.xz) * zMask;
          diffuseColor.rgb *= 1.0 - cracks * 0.8;
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.15, 1.05, 0.9), zMask * 0.35);
        }
        float lavaDepth = uLavaOn * smoothstep(-4.5, -8.5, vWorldPos.y);
        diffuseColor.rgb *= 1.0 - lavaDepth * 0.7;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        if (zMask > 0.0 || zEdge > 0.0) {
          float pulse = 0.5 + 0.5 * sin(uTime * 17.0);
          totalEmissiveRadiance += vec3(1.0, 0.5, 0.12) * (cracks * (0.12 + zHeat * (1.2 + 1.6 * pulse)) + zEdge * 0.22);
        }
        // Los trazos de los anillos (borde del área y explanada) solo cerca de su línea: atan es caro.
        float rr = length(vWorldPos.xz);
        float ring = 1.0 - smoothstep(0.0, 0.5, abs(rr - uRadius));
        if (ring > 0.0) {
          float dash = step(0.5, fract(atan(vWorldPos.z, vWorldPos.x) * uRadius / 3.5));
          totalEmissiveRadiance += vec3(1.0, 0.72, 0.2) * ring * dash * 0.9;
        }
        // Marca de la explanada de aterrizaje: un anillo discontinuo que se ve desde el aire.
        vec2 pd = vWorldPos.xz - uPad.xy;
        float padRing = 1.0 - smoothstep(0.0, 0.4, abs(length(pd) - uPad.z));
        if (padRing > 0.0) {
          float padDash = step(0.5, fract(atan(pd.y, pd.x) * 4.0 / 3.14159265));
          totalEmissiveRadiance += vec3(0.22, 0.88, 0.75) * padRing * padDash * 0.6;
        }
        if (lavaDepth > 0.0) {
          float flow = vnoise(vWorldPos.xz * 0.25 + vec2(uTime * 0.15, -uTime * 0.1));
          totalEmissiveRadiance += uLava * lavaDepth * (0.5 + 0.9 * flow);
        }`,
      );
  };
  material.customProgramCacheKey = () => 'payload-terrain';
}

/** Cúpula del cielo: degradado de cenit a horizonte, el sol y el oscurecimiento de la tormenta. */
export function skyDomeMaterial(look: SurfaceLook) {
  const u = {
    uTop: { value: new Color(look.skyTop) },
    uHorizon: { value: new Color(look.skyHorizon) },
    uFog: { value: new Color(look.fog) },
    uSunDir: { value: new Vector3(...look.sunDir).normalize() },
    uSun: { value: new Color(look.sun) },
    uHaze: { value: look.stars ? 0.15 : 1 },
    uStorm: { value: 0 },
    uStormCol: { value: new Color(look.storm).multiplyScalar(0.45) },
  };
  const material = new ShaderMaterial({
    uniforms: u,
    side: BackSide,
    depthWrite: false,
    fog: false,
    toneMapped: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop;
      uniform vec3 uHorizon;
      uniform vec3 uFog;
      uniform vec3 uSunDir;
      uniform vec3 uSun;
      uniform float uHaze;
      uniform float uStorm;
      uniform vec3 uStormCol;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.5));
        col = mix(col, uFog, smoothstep(0.04, -0.12, h));
        float s = max(dot(d, uSunDir), 0.0);
        col += uSun * (smoothstep(0.99984, 0.99992, s) * 3.0 + pow(s, 14.0) * 0.35 * uHaze + pow(s, 3.0) * 0.06 * uHaze);
        col = mix(col, uStormCol, uStorm * (0.85 - 0.4 * clamp(h, 0.0, 1.0)));
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
  return { material, u };
}

/** Polvo de la tormenta: partículas en una caja que sigue a la cámara y arrastra el viento. */
export function stormMaterial(color: string) {
  const u = {
    uTime: TIME,
    uViewH: VIEW_H,
    uCam: { value: new Vector3() },
    uWind: { value: new Vector2(1, 0) },
    uIntensity: { value: 0 },
    uColor: { value: new Color(color) },
  };
  const material = new ShaderMaterial({
    uniforms: u,
    transparent: true,
    depthWrite: false,
    blending: NormalBlending,
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uViewH;
      uniform vec3 uCam;
      uniform vec2 uWind;
      uniform float uIntensity;
      varying float vA;
      void main() {
        vec3 s = position;
        vec3 box = vec3(46.0, 18.0, 46.0);
        vec3 drift = vec3(uWind.x, -0.08 + (s.y - 0.5) * 0.1, uWind.y) * uTime * (9.0 + s.z * 9.0);
        vec3 p = (fract(s + drift / box - uCam / box) - 0.5) * box + uCam;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float near = smoothstep(1.0, 4.0, -mv.z);
        vA = uIntensity * near * (0.25 + 0.5 * s.x) * step(s.y, 0.35 + uIntensity * 0.65);
        gl_PointSize = (0.1 + s.z * 0.18) * projectionMatrix[1][1] * uViewH * 0.5 / max(0.1, -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vA;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float a = smoothstep(0.5, 0.1, length(c)) * vA;
        gl_FragColor = vec4(uColor, a);
        #include <colorspace_fragment>
      }
    `,
  });
  return { material, u };
}

/** Polvo levantado (terreno que cruje, hundimientos, contacto de la nave): bocanadas que se abren. */
export function dustMaterial(color: string) {
  const u = { uTime: TIME, uViewH: VIEW_H, uMap: { value: puffTexture() }, uColor: { value: new Color(color) }, uStrength: { value: 0 }, uRadius: { value: 4 } };
  const material = new ShaderMaterial({
    uniforms: u,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uViewH;
      uniform float uStrength;
      uniform float uRadius;
      varying float vAlpha;
      void main() {
        vec3 s = position;
        float life = fract(uTime * (0.35 + s.z * 0.3) + s.x * 7.0);
        float ang = s.y * 6.2831853;
        float r = uRadius * (0.3 + 0.8 * s.x) + life * 1.5;
        vec3 p = vec3(cos(ang) * r, 0.2 + life * (1.2 + s.z * 2.5), sin(ang) * r);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = (0.8 + life * 2.6) * projectionMatrix[1][1] * uViewH * 0.5 / max(0.1, -mv.z);
        vAlpha = smoothstep(0.0, 0.15, life) * (1.0 - life) * 0.55 * uStrength;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform vec3 uColor;
      varying float vAlpha;
      void main() {
        float a = texture2D(uMap, gl_PointCoord).a * vAlpha;
        gl_FragColor = vec4(uColor, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  return { material, u };
}

/** Haz de luz vertical (cilindro abierto): la baliza de la nave y las muestras se ven desde lejos. */
export function beamMaterial(color: string, opacity = 0.35) {
  const u = { uColor: { value: new Color(color) }, uOpacity: { value: opacity }, uTime: TIME };
  const material = new ShaderMaterial({
    uniforms: u,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: AdditiveBlending,
    toneMapped: false,
    fog: false,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        float fade = pow(1.0 - vUv.y, 1.6);
        float shimmer = 0.8 + 0.2 * sin(vUv.y * 40.0 - uTime * 3.0);
        float edge = 1.0 - abs(vUv.x - 0.5) * 0.6;
        gl_FragColor = vec4(uColor * fade * shimmer * edge * uOpacity, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
  return { material, u };
}

/** Llama de los propulsores de frenado (cono abierto, la punta hacia abajo). */
export const thrusterMaterial = once(() => {
  const u = { uTime: TIME, uPower: { value: 0 } };
  const material = new ShaderMaterial({
    uniforms: u,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: AdditiveBlending,
    toneMapped: false,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uPower;
      varying vec2 vUv;
      ${NOISE2}
      void main() {
        float y = vUv.y;
        float n = vnoise(vec2(vUv.x * 12.0, y * 6.0 + uTime * 22.0));
        float body = smoothstep(0.0, 0.6, y) * (0.6 + 0.6 * n);
        vec3 col = mix(vec3(1.0, 0.45, 0.12), vec3(0.75, 0.9, 1.0), smoothstep(0.55, 1.0, y));
        gl_FragColor = vec4(col * body * uPower * 1.6, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
  return { material, u };
});
