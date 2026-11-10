/**
 * Shaders de los efectos de avería: llamas, pavesas, humo, chispas, arcos eléctricos y chorro de gas.
 * Todo el movimiento se calcula en la GPU a partir del reloj común (`TIME`): la CPU solo decide qué
 * efecto se ve y dónde. Los materiales se comparten entre todas las averías.
 */
import { AdditiveBlending, BufferAttribute, BufferGeometry, NormalBlending, PlaneGeometry, ShaderMaterial } from 'three';
import { once } from './build';
import { NOISE2, TIME } from './glsl';
import { puffTexture } from './textures';

/** Alto del lienzo en píxeles reales (para dar tamaño en metros a los puntos). Lo actualiza `ShaderClock`. */
export const VIEW_H = { value: 800 };

/** Cartel cilíndrico: gira sobre el eje Y para mirar a la cámara. Origen en la base. */
const VERT_BILLBOARD = /* glsl */ `
varying vec2 vUv;
varying float vSeed;
void main() {
  vUv = uv;
  vec3 center = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vSeed = fract(center.x * 0.37 + center.z * 0.73 + center.y * 1.31) * 40.0;
  vec3 toCam = cameraPosition - center;
  toCam.y = 0.0;
  toCam = normalize(toCam);
  vec3 right = vec3(toCam.z, 0.0, -toCam.x);
  float sx = length(modelMatrix[0].xyz);
  float sy = length(modelMatrix[1].xyz);
  vec3 wp = center + right * position.x * sx + vec3(0.0, position.y * sy, 0.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

/** Plano de 1 × 1 con el origen en el centro de la base (para los carteles). */
export const billboardGeometry = once(() => new PlaneGeometry(1, 1).translate(0, 0.5, 0));

export const flameMaterial = once(
  () =>
    new ShaderMaterial({
      uniforms: { uTime: TIME },
      toneMapped: false,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      vertexShader: VERT_BILLBOARD,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying vec2 vUv;
        varying float vSeed;
        ${NOISE2}
        void main() {
          float t = uTime * 1.5 + vSeed;
          float n1 = fbm2(vec2(vUv.x * 3.0 + vSeed, vUv.y * 2.4 - t * 1.4));
          float n2 = vnoise(vec2(vUv.x * 7.0 - vSeed, vUv.y * 5.0 - t * 2.8));
          float x = (vUv.x - 0.5) * 2.0 + (n1 - 0.5) * 0.9 * vUv.y;
          float width = mix(0.8, 0.04, pow(vUv.y, 0.75));
          float body = 1.0 - smoothstep(width * 0.35, width, abs(x));
          float heat = body * (1.2 - vUv.y) * (0.45 + 0.85 * n1 + 0.35 * n2) * smoothstep(0.0, 0.07, vUv.y);
          vec3 col = mix(vec3(0.85, 0.1, 0.0), vec3(1.0, 0.5, 0.06), smoothstep(0.15, 0.5, heat));
          col = mix(col, vec3(1.0, 0.93, 0.62), smoothstep(0.5, 0.95, heat));
          float a = smoothstep(0.1, 0.42, heat);
          gl_FragColor = vec4(col * a * 1.35, 1.0);
          #include <colorspace_fragment>
        }
      `,
    }),
);

export const arcMaterial = once(
  () =>
    new ShaderMaterial({
      uniforms: { uTime: TIME },
      toneMapped: false,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      vertexShader: VERT_BILLBOARD,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying vec2 vUv;
        varying float vSeed;
        ${NOISE2}
        void main() {
          // El rayo cambia de forma 18 veces por segundo y a ratos se apaga.
          float t = floor(uTime * 18.0) + vSeed;
          float y = vUv.y;
          float off = (vnoise(vec2(y * 5.0 + t * 7.3, t)) - 0.5) * 0.7 + (vnoise(vec2(y * 17.0 - t * 3.1, t + 4.0)) - 0.5) * 0.2;
          off *= sin(y * 3.14159);
          float d = abs(vUv.x - 0.5 - off);
          float core = 0.012 / (d + 0.008);
          float on = step(0.42, hash21(vec2(t, vSeed)));
          float a = clamp(core * core, 0.0, 3.0) * on * smoothstep(0.5, 0.3, abs(vUv.x - 0.5));
          gl_FragColor = vec4(mix(vec3(0.35, 0.6, 1.0), vec3(1.0), clamp(core * 0.5, 0.0, 1.0)) * a, 1.0);
          #include <colorspace_fragment>
        }
      `,
    }),
);

/** Geometría de `count` partículas: la «posición» es una semilla aleatoria 0-1 por partícula. */
export function seedGeometry(count: number, seed: number): BufferGeometry {
  let a = seed >>> 0;
  const rand = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const data = new Float32Array(count * 3);
  for (let i = 0; i < data.length; i++) data[i] = rand();
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(data, 3));
  return g;
}

const POINT_SIZE = /* glsl */ `
uniform float uViewH;
float pointSize(float meters, vec4 mv) { return meters * projectionMatrix[1][1] * uViewH * 0.5 / max(0.05, -mv.z); }
`;

/** Disco blando para los puntos que no usan textura. */
const SOFT_DOT = /* glsl */ `
float softDot() { vec2 c = gl_PointCoord - 0.5; return smoothstep(0.5, 0.0, length(c)); }
`;

export const emberMaterial = once(
  () =>
    new ShaderMaterial({
      uniforms: { uTime: TIME, uViewH: VIEW_H },
      toneMapped: false,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      vertexShader: /* glsl */ `
        uniform float uTime;
        varying float vLife;
        ${POINT_SIZE}
        void main() {
          vec3 s = position;
          float life = fract(uTime * (0.35 + s.z * 0.4) + s.x * 9.0);
          vLife = life;
          vec3 p = vec3((s.x - 0.5) * 0.9 + sin(uTime * 2.3 + s.y * 20.0) * 0.12 * life, 0.3 + life * (1.6 + s.y * 1.2), (s.y - 0.5) * 0.9 + cos(uTime * 1.9 + s.x * 20.0) * 0.12 * life);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = pointSize(0.07 * (1.0 - life * 0.7), mv);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vLife;
        ${SOFT_DOT}
        void main() {
          float a = softDot() * (1.0 - vLife);
          gl_FragColor = vec4(mix(vec3(1.0, 0.75, 0.3), vec3(1.0, 0.25, 0.05), vLife) * a * 2.0, 1.0);
          #include <colorspace_fragment>
        }
      `,
    }),
);

export const sparkMaterial = once(
  () =>
    new ShaderMaterial({
      uniforms: { uTime: TIME, uViewH: VIEW_H },
      toneMapped: false,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      vertexShader: /* glsl */ `
        uniform float uTime;
        varying float vLife;
        ${POINT_SIZE}
        void main() {
          vec3 s = position;
          // Ráfagas: cada chispa sale despedida, cae con la gravedad y vuelve a empezar.
          float life = fract(uTime * (1.1 + s.z * 0.9) + s.x * 13.0);
          vLife = life;
          float ang = s.y * 6.2831853;
          float tt = life * 0.75;
          vec3 v = vec3(cos(ang) * (0.5 + s.z * 1.4), 1.4 + s.x * 2.2, sin(ang) * (0.5 + s.z * 1.4));
          vec3 p = vec3(0.0, 1.25, 0.0) + v * tt + vec3(0.0, -6.5, 0.0) * tt * tt;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = pointSize(0.07 * (1.0 - life * 0.6), mv);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vLife;
        ${SOFT_DOT}
        void main() {
          float a = softDot() * (1.0 - vLife * vLife);
          gl_FragColor = vec4(mix(vec3(0.85, 0.93, 1.0), vec3(1.0, 0.6, 0.2), vLife) * a * 2.4, 1.0);
          #include <colorspace_fragment>
        }
      `,
    }),
);

function puffMaterial(opts: { additive: boolean; vertexBody: string; color: string }): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uTime: TIME, uViewH: VIEW_H, uMap: { value: puffTexture() } },
    toneMapped: !opts.additive,
    transparent: true,
    depthWrite: false,
    blending: opts.additive ? AdditiveBlending : NormalBlending,
    vertexShader: /* glsl */ `
      uniform float uTime;
      varying float vAlpha;
      varying float vSpin;
      ${POINT_SIZE}
      void main() {
        vec3 s = position;
        vec3 p;
        float size;
        ${opts.vertexBody}
        vSpin = s.x * 6.2831853 + uTime * (s.y - 0.5) * 1.5;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = pointSize(size, mv);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      varying float vAlpha;
      varying float vSpin;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float cs = cos(vSpin);
        float sn = sin(vSpin);
        float a = texture2D(uMap, vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs) + 0.5).a * vAlpha;
        gl_FragColor = vec4(${opts.color}, a);
        ${opts.additive ? '' : '#include <tonemapping_fragment>'}
        #include <colorspace_fragment>
      }
    `,
  });
}

/** Humo oscuro que sube del fuego y se abre. */
export const smokeMaterial = once(() =>
  puffMaterial({
    additive: false,
    color: 'vec3(0.05, 0.05, 0.06)',
    vertexBody: /* glsl */ `
      float life = fract(uTime * (0.22 + s.z * 0.12) + s.x * 7.0);
      p = vec3((s.x - 0.5) * 0.5 + sin(s.y * 30.0 + uTime * 0.6) * 0.35 * life, 1.3 + life * 2.2, (s.y - 0.5) * 0.5 + cos(s.x * 30.0 + uTime * 0.5) * 0.35 * life);
      size = 0.5 + life * 1.3;
      vAlpha = smoothstep(0.0, 0.15, life) * (1.0 - life) * 0.55;
    `,
  }),
);

/** Chorro de gas a presión: sale del sistema en diagonal (arriba y hacia el pasillo, +Z local) y se disipa. */
export const jetMaterial = once(() =>
  puffMaterial({
    additive: false,
    color: 'vec3(0.86, 0.94, 1.0)',
    vertexBody: /* glsl */ `
      float life = fract(uTime * (0.9 + s.z * 0.5) + s.x * 11.0);
      float reach = life * (1.5 + s.z * 0.6);
      vec2 spread = (s.xy - 0.5) * reach * 0.7;
      p = vec3(spread.x - reach * 0.3, 1.25 + reach * 0.75 + spread.y, reach * 0.65);
      size = 0.12 + life * 0.85;
      vAlpha = smoothstep(0.0, 0.08, life) * pow(1.0 - life, 1.4) * 0.5;
    `,
  }),
);
