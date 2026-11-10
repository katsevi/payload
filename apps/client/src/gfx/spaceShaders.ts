/**
 * Shaders del exterior: cielo profundo (se hornea una vez a un cubemap), planetas y luna
 * procedurales, atmósfera, anillos, nebulosa y el vórtice del portal de salto.
 *
 * Los cuerpos se iluminan con `SUN_DIR`, la misma dirección que la luz direccional de la escena.
 */
import { AdditiveBlending, BackSide, Color, DoubleSide, ShaderMaterial, Vector3 } from 'three';
import { NOISE2, NOISE3, OUTPUT, TIME, VERT_UV } from './glsl';

/**
 * Dirección HACIA la estrella cercana (unitaria): baja sobre el horizonte y por el través de babor.
 * Con ella el destino de proa se ve iluminado en algo más de la mitad (fase gibosa), no en penumbra.
 */
export const SUN_DIR = new Vector3(-0.96, 0.2, -0.05).normalize();

/** Cielo profundo: nubes de gas tenues y la banda de la galaxia. Solo se usa para hornear el cubemap. */
export function skyMaterial(seed: number, tintA: Color, tintB: Color) {
  return new ShaderMaterial({
    uniforms: { uSeed: { value: seed }, uTintA: { value: tintA }, uTintB: { value: tintB } },
    side: BackSide,
    depthWrite: false,
    toneMapped: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uSeed;
      uniform vec3 uTintA;
      uniform vec3 uTintB;
      varying vec3 vDir;
      ${NOISE3}
      void main() {
        vec3 d = normalize(vDir);
        vec3 q = d * 1.5 + uSeed;
        float warp = fbm3(q * 1.3);
        float n = fbm(q + warp * 0.7) * 0.5 + 0.5;
        float clouds = smoothstep(0.42, 0.85, n);
        float wisps = smoothstep(0.5, 0.95, fbm3(q * 0.9 + 7.0) * 0.5 + 0.5);
        vec3 axis = normalize(vec3(0.3, 1.0, 0.2));
        float band = exp(-pow(dot(d, axis) * 3.4, 2.0));
        float dust = fbm3(d * 5.0 + uSeed * 2.0) * 0.5 + 0.5;
        float lanes = smoothstep(0.45, 0.8, fbm3(d * 3.5 + 3.0) * 0.5 + 0.5);
        vec3 col = vec3(0.0025, 0.004, 0.01);
        col += uTintA * clouds * clouds * 0.12;
        col += uTintB * wisps * 0.09;
        col += vec3(0.7, 0.78, 1.0) * band * (0.01 + 0.05 * dust) * (1.0 - lanes * 0.75);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

/** Tipos de superficie del shader de planeta. */
export const PLANET_TYPES = ['terran', 'desert', 'gas', 'ice', 'lava', 'moon'] as const;
export type PlanetType = (typeof PLANET_TYPES)[number];

export interface PlanetLook {
  type: PlanetType;
  seed: number;
  /** Tres colores de la paleta (el significado depende del tipo) y el de la atmósfera. */
  a: Color;
  b: Color;
  c: Color;
  atmosphere: Color;
}

/**
 * Planeta procedural: relieve con ruido 3D sobre la esfera (sin texturas ni costuras), océanos con
 * brillo especular, nubes, bandas de gigante gaseoso, grietas de lava o cráteres, y borde de atmósfera.
 */
export function planetMaterial(look: PlanetLook) {
  const u = {
    uTime: TIME,
    uSeed: { value: look.seed },
    uType: { value: PLANET_TYPES.indexOf(look.type) },
    uA: { value: look.a },
    uB: { value: look.b },
    uC: { value: look.c },
    uAtmo: { value: look.atmosphere },
    uSun: { value: SUN_DIR },
  };
  const material = new ShaderMaterial({
    uniforms: u,
    vertexShader: /* glsl */ `
      varying vec3 vObj;
      varying vec3 vWorldPos;
      varying mat3 vRot;
      void main() {
        vObj = position;
        vRot = mat3(modelMatrix);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uSeed;
      uniform int uType;
      uniform vec3 uA;
      uniform vec3 uB;
      uniform vec3 uC;
      uniform vec3 uAtmo;
      uniform vec3 uSun;
      varying vec3 vObj;
      varying vec3 vWorldPos;
      varying mat3 vRot;
      ${NOISE3}
      // «Hash without Sine» (Copyright (c) 2014 David Hoskins, licencia MIT).
      vec3 hash33(vec3 p) {
        p = fract(p * vec3(0.1031, 0.1030, 0.0973));
        p += dot(p, p.yxz + 33.33);
        return fract((p.xxy + p.yxx) * p.zyx);
      }
      // Campo de cráteres: cuenco hundido y borde levantado alrededor de puntos al azar.
      float craters(vec3 p, float freq) {
        vec3 q = p * freq;
        vec3 id = floor(q);
        vec3 f = fract(q);
        float d = 9.0;
        for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) for (int z = -1; z <= 1; z++) {
          vec3 g = vec3(float(x), float(y), float(z));
          vec3 o = hash33(id + g);
          d = min(d, length(g + o - f) / (0.22 + 0.33 * o.x));
        }
        float bowl = smoothstep(0.0, 1.0, d) - 1.0;
        float rim = exp(-pow((d - 1.0) * 5.0, 2.0));
        return bowl * 0.55 + rim * 0.22;
      }
      float height(vec3 p) {
        if (uType == 5) return craters(p + uSeed, 2.4) + craters(p - uSeed, 5.5) * 0.45 + fbm3(p * 5.0 + uSeed) * 0.18;
        return fbm(p * 1.7 + uSeed);
      }
      void main() {
        vec3 p = normalize(vObj);
        vec3 nObj = p;
        vec3 albedo = uA;
        vec3 emissive = vec3(0.0);
        float gloss = 0.0;
        float cloud = 0.0;
        if (uType == 2) {
          // Gigante gaseoso: bandas por latitud, deformadas por la turbulencia, y tormentas.
          float warp = fbm3(p * vec3(2.0, 6.0, 2.0) + uSeed);
          float lat = p.y + warp * 0.07;
          float bands = sin(lat * 15.0 + uSeed) * 0.5 + 0.5;
          float fine = fbm3(vec3(p.x * 3.0, lat * 32.0, p.z * 3.0) + uSeed * 3.0) * 0.5 + 0.5;
          albedo = mix(uA, uB, smoothstep(0.2, 0.8, bands * 0.7 + fine * 0.3));
          float storm = smoothstep(0.5, 0.8, fbm3(vec3(p.x * 5.0, lat * 14.0, p.z * 5.0) - uSeed));
          albedo = mix(albedo, uC, storm * 0.65);
        } else {
          float h = height(p);
          vec3 t1 = normalize(cross(p, vec3(0.0, 1.0, 0.001)));
          vec3 t2 = cross(p, t1);
          float e = 0.012;
          vec3 grad = (t1 * (height(normalize(p + t1 * e)) - h) + t2 * (height(normalize(p + t2 * e)) - h)) / e;
          if (uType == 0) {
            float land = smoothstep(0.02, 0.05, h);
            vec3 ocean = mix(uA * 0.22, uA, smoothstep(-0.6, 0.02, h));
            vec3 ground = mix(uB, uC, smoothstep(0.1, 0.5, h));
            float ice = smoothstep(0.72, 0.84, abs(p.y) + h * 0.12);
            albedo = mix(mix(ocean, ground, land), vec3(0.88, 0.93, 1.0), ice);
            gloss = (1.0 - land) * (1.0 - ice);
            nObj = normalize(p - grad * 0.07 * land);
            cloud = smoothstep(0.08, 0.6, fbm(p * 2.6 + vec3(uTime * 0.004, 0.0, uSeed * 1.7)));
          } else if (uType == 1) {
            albedo = mix(uA, uB, smoothstep(-0.5, 0.5, h));
            albedo = mix(albedo, uC, smoothstep(0.25, 0.8, fbm3(p * 6.0 + uSeed)));
            nObj = normalize(p - grad * 0.1);
          } else if (uType == 3) {
            float cracks = 1.0 - smoothstep(0.0, 0.05, abs(fbm3(p * 4.0 + uSeed)));
            albedo = mix(mix(uA, uB, smoothstep(-0.4, 0.6, h)), uC, cracks * 0.7);
            gloss = 0.35;
            nObj = normalize(p - grad * 0.04);
          } else if (uType == 4) {
            float crack = 1.0 - smoothstep(0.0, 0.085, abs(h));
            albedo = mix(uA, uB, smoothstep(-0.3, 0.6, h));
            emissive = uC * crack * crack * (1.6 + 0.5 * sin(uTime * 0.8 + h * 20.0));
            nObj = normalize(p - grad * 0.1);
          } else {
            float maria = smoothstep(-0.1, 0.5, fbm3(p * 1.4 + uSeed * 0.5));
            albedo = mix(uA, uB, maria) * (0.85 + 0.3 * fbm3(p * 9.0));
            nObj = normalize(p - grad * 0.16);
          }
        }
        vec3 n = normalize(vRot * nObj);
        vec3 sphereN = normalize(vRot * p);
        vec3 V = normalize(cameraPosition - vWorldPos);
        float sphereLit = dot(sphereN, uSun);
        float day = smoothstep(-0.1, 0.25, sphereLit);
        float lit = max(dot(n, uSun), 0.0) * day;
        vec3 col = albedo * (lit * 1.25 + 0.012);
        col += vec3(1.0, 0.95, 0.85) * pow(max(dot(n, normalize(uSun + V)), 0.0), 70.0) * gloss * day;
        col = mix(col, vec3(1.0) * (max(sphereLit, 0.0) * 1.1 + 0.015), cloud * 0.9);
        float fres = pow(1.0 - max(dot(sphereN, V), 0.0), 3.0);
        col += uAtmo * fres * smoothstep(-0.25, 0.4, sphereLit) * 0.9;
        col += emissive;
        gl_FragColor = vec4(col, 1.0);
        ${OUTPUT}
      }
    `,
  });
  return { material, u };
}

/**
 * Halo de atmósfera: un cartel detrás del planeta que brilla justo por fuera de su silueta, más
 * fuerte del lado iluminado. `uRadius` es el radio del planeta en unidades del mundo.
 */
export function atmosphereMaterial(color: Color, radius: number) {
  return new ShaderMaterial({
    uniforms: { uColor: { value: color }, uRadius: { value: radius }, uSun: { value: SUN_DIR } },
    toneMapped: false,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    vertexShader: /* glsl */ `
      uniform float uRadius;
      uniform vec3 uSun;
      varying vec2 vP;
      varying float vLit;
      const float REACH = 1.45;
      void main() {
        vec3 c = (modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        float d = length(c);
        // Radio aparente de la silueta de la esfera en el plano que pasa por su centro.
        float r0 = uRadius / sqrt(max(0.05, 1.0 - (uRadius * uRadius) / (d * d)));
        vec3 f = c / d;
        vec3 right = normalize(cross(f, vec3(0.0, 1.0, 0.0)));
        vec3 up = cross(right, f);
        vP = position.xy * REACH;
        vec3 limb = normalize(right * position.x + up * position.y);
        vLit = dot(limb, (viewMatrix * vec4(uSun, 0.0)).xyz);
        gl_Position = projectionMatrix * vec4(c + (right * position.x + up * position.y) * r0 * REACH, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying vec2 vP;
      varying float vLit;
      void main() {
        float r = length(vP);
        float glow = exp(-max(r - 1.0, 0.0) * 13.0) * smoothstep(0.9, 1.0, r);
        float a = glow * smoothstep(-0.55, 0.5, vLit) * 0.85;
        gl_FragColor = vec4(uColor * a, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
}

/** Anillos de un gigante gaseoso: bandas radiales, iluminadas por la estrella y con la sombra del planeta. */
export function ringMaterial(color: Color, seed: number, inner: number, outer: number, planetRadius: number) {
  return new ShaderMaterial({
    uniforms: { uColor: { value: color }, uSeed: { value: seed }, uInner: { value: inner }, uOuter: { value: outer }, uPlanetR: { value: planetRadius }, uSun: { value: SUN_DIR } },
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    vertexShader: /* glsl */ `
      varying vec3 vObj;
      varying vec3 vWorldPos;
      varying vec3 vCenter;
      void main() {
        vObj = position;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        vCenter = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uSeed;
      uniform float uInner;
      uniform float uOuter;
      uniform float uPlanetR;
      uniform vec3 uSun;
      varying vec3 vObj;
      varying vec3 vWorldPos;
      varying vec3 vCenter;
      ${NOISE2}
      void main() {
        float t = (length(vObj.xy) - uInner) / (uOuter - uInner);
        float bands = vnoise(vec2(t * 28.0 + uSeed, 0.5)) * 0.6 + vnoise(vec2(t * 90.0 - uSeed, 2.5)) * 0.4;
        float gaps = smoothstep(0.25, 0.45, vnoise(vec2(t * 9.0 + uSeed * 2.0, 7.0)));
        float a = bands * gaps * smoothstep(0.0, 0.06, t) * smoothstep(1.0, 0.9, t) * 0.85;
        // Sombra del planeta sobre el anillo: rayo del punto hacia la estrella contra la esfera.
        vec3 oc = vWorldPos - vCenter;
        float b = dot(oc, uSun);
        float disc = b * b - (dot(oc, oc) - uPlanetR * uPlanetR);
        float shadow = (disc > 0.0 && -b + sqrt(disc) > 0.0) ? 0.08 : 1.0;
        vec3 col = uColor * (0.6 + 0.5 * bands) * shadow;
        gl_FragColor = vec4(col, a);
        ${OUTPUT}
      }
    `,
  });
}

/** Nebulosa: gas con deformación de dominio sobre un cartel que mira a la cámara. */
export function nebulaMaterial(seed: number, a: Color, b: Color, c: Color, strength: number) {
  return new ShaderMaterial({
    uniforms: { uTime: TIME, uSeed: { value: seed }, uA: { value: a }, uB: { value: b }, uC: { value: c }, uStrength: { value: strength } },
    toneMapped: false,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec3 c = (modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        float s = length(modelMatrix[0].xyz);
        gl_Position = projectionMatrix * vec4(c + vec3(position.xy * s, 0.0), 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uSeed;
      uniform vec3 uA;
      uniform vec3 uB;
      uniform vec3 uC;
      uniform float uStrength;
      varying vec2 vUv;
      ${NOISE2}
      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float r = length(p);
        vec2 q = p * 1.7 + uSeed;
        float w = fbm2(q * 1.2 + uTime * 0.012);
        vec2 warp = vec2(fbm2(q + w * 2.0), fbm2(q + 5.2 - w * 2.0));
        float n = fbm2(q * 1.5 + warp * 1.7 - uTime * 0.008);
        float dens = smoothstep(0.3, 0.8, n) * smoothstep(1.0, 0.2, r);
        vec3 col = mix(uA, uB, smoothstep(0.3, 0.7, warp.x));
        col = mix(col, uC, smoothstep(0.5, 0.85, n) * 0.7);
        float core = dens * dens * dens;
        gl_FragColor = vec4((col * dens * 0.5 + vec3(1.0, 0.95, 0.9) * core * 0.16) * uStrength, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
}

/** Vórtice del portal de salto: brazos en espiral que caen hacia un núcleo brillante. */
export function vortexMaterial() {
  return new ShaderMaterial({
    uniforms: { uTime: TIME },
    toneMapped: false,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: AdditiveBlending,
    vertexShader: VERT_UV,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;
      ${NOISE2}
      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float r = length(p);
        float a = atan(p.y, p.x);
        float swirl = a + (1.0 - r) * 5.0 + uTime * 0.7;
        vec2 dir = vec2(cos(swirl), sin(swirl));
        float n = fbm2(dir * 1.8 + vec2(r * 5.0 - uTime * 0.9, 0.0));
        float arms = 0.5 + 0.5 * sin(swirl * 4.0 + n * 5.0);
        float edge = smoothstep(1.0, 0.82, r);
        float core = exp(-r * r * 7.0);
        float rim = exp(-pow((r - 0.93) * 14.0, 2.0));
        vec3 col = mix(vec3(0.03, 0.3, 0.5), vec3(0.22, 0.88, 0.75), arms * n) * (0.18 + arms * n * 1.1);
        col += vec3(0.8, 1.0, 1.0) * core * 1.1 + vec3(0.22, 0.88, 0.75) * rim * 0.6;
        gl_FragColor = vec4(col * edge, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
}
