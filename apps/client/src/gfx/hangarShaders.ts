/**
 * Shaders del hangar: holograma de la pieza señalada (bordes por Fresnel, líneas y barrido de escaneo), haces de
 * los focos (conos aditivos, sin luces puntuales) y chispas de soldadura (ráfaga controlada por `uAge`).
 */
import { AdditiveBlending, Color, DoubleSide, LineBasicMaterial, ShaderMaterial } from 'three';
import { once } from './build';
import { VIEW_H } from './fxShaders';
import { TIME } from './glsl';

const VERT_FRESNEL = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying vec3 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vec4 mv = viewMatrix * w;
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

/** Holograma cian: casi transparente de frente, brillante en el contorno, con líneas y un barrido que sube. */
export const ghostMaterial = once(
  () =>
    new ShaderMaterial({
      uniforms: { uTime: TIME, uColor: { value: new Color('#38e1c0') }, uStrength: { value: 1 } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      toneMapped: false,
      vertexShader: VERT_FRESNEL,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uColor;
        uniform float uStrength;
        varying vec3 vN;
        varying vec3 vV;
        varying vec3 vW;
        void main() {
          float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
          float lines = smoothstep(0.82, 1.0, sin(vW.y * 70.0) * 0.5 + 0.5) * 0.22;
          float ph = fract(vW.y * 0.4 - uTime * 0.5);
          float sweep = smoothstep(0.0, 0.025, ph) * (1.0 - smoothstep(0.025, 0.09, ph));
          float pulse = 0.85 + 0.15 * sin(uTime * 4.0);
          vec3 c = uColor * (0.012 + 0.3 * f + lines * 0.5 + sweep * 0.6) * pulse * uStrength;
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }
      `,
    }),
);

/** Variante tenue para el bastidor vacío (la jaula que espera la estructura). */
export const frameGhostMaterial = once(() => {
  const m = ghostMaterial().clone();
  m.uniforms.uTime = TIME;
  m.uniforms.uStrength = { value: 0.3 };
  return m;
});

/** Aristas del holograma. */
export const ghostEdgeMaterial = once(() => new LineBasicMaterial({ color: '#7ff5dc', transparent: true, opacity: 0.32, depthWrite: false, blending: AdditiveBlending, toneMapped: false }));

/**
 * Haz de un foco: cono abierto con la punta en el foco (uv.y = 1). Más intenso junto a la lámpara y blando en
 * los bordes (cara de frente a la cámara = centro del haz).
 */
export const lampBeamMaterial = once(
  () =>
    new ShaderMaterial({
      uniforms: { uColor: { value: new Color('#ffe9c4') }, uOpacity: { value: 0.11 }, uTime: TIME },
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      blending: AdditiveBlending,
      toneMapped: false,
      fog: false,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vN;
        varying vec3 vV;
        varying vec3 vW;
        void main() {
          vUv = uv;
          vec4 w = modelMatrix * vec4(position, 1.0);
          vW = w.xyz;
          vec4 mv = viewMatrix * w;
          vN = normalize(normalMatrix * normal);
          vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uOpacity;
        uniform float uTime;
        varying vec2 vUv;
        varying vec3 vN;
        varying vec3 vV;
        varying vec3 vW;
        void main() {
          float fade = pow(vUv.y, 1.8);
          float facing = pow(abs(dot(normalize(vN), normalize(vV))), 1.6);
          float dust = 0.88 + 0.12 * sin(vW.x * 3.1 + vW.y * 2.3 + uTime * 0.6) * sin(vW.z * 2.7 - uTime * 0.4);
          gl_FragColor = vec4(uColor * fade * facing * dust * uOpacity, 1.0);
          #include <colorspace_fragment>
        }
      `,
    }),
);

/** Chispas de una soldadura: `uAge` en segundos desde el destello (cada ranura de soldadura tiene su material). */
export function weldSparkMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uAge: { value: 9 }, uViewH: VIEW_H },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    toneMapped: false,
    vertexShader: /* glsl */ `
      uniform float uAge;
      uniform float uViewH;
      varying float vLife;
      void main() {
        vec3 s = position;
        float th = s.x * 6.2831853;
        float up = 0.25 + 0.75 * s.y;
        vec3 dir = normalize(vec3(cos(th) * (1.0 - up * 0.6), up, sin(th) * (1.0 - up * 0.6)));
        float speed = 0.9 + s.z * 2.2;
        float span = 0.35 + 0.55 * s.z;
        float t = min(uAge, span);
        vLife = clamp(uAge / span, 0.0, 1.0);
        vec3 p = dir * speed * t + vec3(0.0, -5.0, 0.0) * t * t;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = 0.035 * (1.0 - vLife * 0.7) * projectionMatrix[1][1] * uViewH * 0.5 / max(0.05, -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vLife;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float a = smoothstep(0.5, 0.0, length(c)) * (1.0 - vLife);
        if (vLife >= 1.0) discard;
        gl_FragColor = vec4(mix(vec3(0.9, 0.95, 1.0), vec3(1.0, 0.55, 0.15), vLife) * a * 2.4, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
}

/** Aristas tenues del bastidor vacío. */
export const frameEdgeMaterial = once(() => {
  const m = ghostEdgeMaterial().clone();
  m.opacity = 0.28;
  return m;
});
