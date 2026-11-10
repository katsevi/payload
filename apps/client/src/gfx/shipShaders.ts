/**
 * Shaders de los puestos de la nave: núcleo del reactor, toberas, biorreactor, campo del escudo y
 * las pantallas diegéticas (timón, radar, panel de energía, mesa del mapa). Todos son baratos: una
 * o dos lecturas de ruido por píxel y sin texturas.
 *
 * Cada fábrica devuelve `{ material, u }`: `u` son los uniformes, para moverlos desde `useFrame`.
 */
import { AdditiveBlending, Color, DoubleSide, ShaderMaterial } from 'three';
import { NOISE2, NOISE3, TIME, VERT_UV } from './glsl';

const VERT_SURFACE = /* glsl */ `
varying vec3 vPos;
varying vec3 vN;
varying vec3 vView;
void main() {
  vPos = position;
  vN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

/** Columna de plasma del reactor. `uFlow` lo acumula quien lo usa (así la velocidad cambia sin saltos). */
export function plasmaMaterial() {
  const u = { uColor: { value: new Color('#38e1c0') }, uPower: { value: 1 }, uFlow: { value: 0 } };
  const material = new ShaderMaterial({
    uniforms: u,
    toneMapped: false,
    vertexShader: VERT_SURFACE,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uPower;
      uniform float uFlow;
      varying vec3 vPos;
      varying vec3 vN;
      varying vec3 vView;
      ${NOISE3}
      void main() {
        float facing = max(dot(normalize(vN), normalize(vView)), 0.0);
        float n = snoise(vec3(vPos.x * 2.6, vPos.y * 1.5 - uFlow, vPos.z * 2.6)) * 0.5 + 0.5;
        float n2 = snoise(vec3(vPos.x * 6.0, vPos.y * 4.0 - uFlow * 2.3, vPos.z * 6.0)) * 0.5 + 0.5;
        float streak = n * n * 0.9 + n2 * 0.35;
        float core = pow(facing, 1.6);
        vec3 col = uColor * (0.3 + streak * 1.15) + vec3(1.0) * core * streak * 0.6;
        col *= uPower * (0.5 + 0.5 * core);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
  return { material, u };
}

/** Cámara de combustión que se ve tras las palas de cada motor. `uThrust` 0 (parado) … ~1,6 (máxima). */
export function engineGlowMaterial() {
  const u = { uTime: TIME, uThrust: { value: 0 } };
  const material = new ShaderMaterial({
    uniforms: u,
    toneMapped: false,
    vertexShader: VERT_UV,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uThrust;
      varying vec2 vUv;
      ${NOISE2}
      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float r = length(p);
        vec2 dir = p / max(r, 0.001);
        float swirl = vnoise(dir * 2.5 + vec2(r * 5.0 - uTime * 7.0, uTime * 1.3));
        float heat = smoothstep(1.0, 0.05, r);
        vec3 cold = vec3(0.08, 0.3, 1.0);
        vec3 hot = vec3(0.8, 0.94, 1.0);
        vec3 col = mix(cold, hot, heat * heat) * heat * (0.06 + uThrust * (0.85 + 0.6 * swirl));
        gl_FragColor = vec4(col + vec3(0.004, 0.008, 0.016), 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
  return { material, u };
}

/** Cultivo del biorreactor de soporte vital: burbujas que suben mientras el sistema está en línea. */
export function liquidMaterial() {
  const u = { uTime: TIME, uOn: { value: 1 } };
  const material = new ShaderMaterial({
    uniforms: u,
    toneMapped: false,
    vertexShader: VERT_SURFACE,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uOn;
      varying vec3 vPos;
      varying vec3 vN;
      varying vec3 vView;
      ${NOISE2}
      float bubbles(vec2 q, float speed) {
        q.y -= uTime * speed;
        vec2 id = floor(q);
        vec2 f = fract(q) - 0.5;
        float h = hash21(id);
        vec2 off = (vec2(h, fract(h * 7.3)) - 0.5) * 0.55;
        return smoothstep(0.06 + 0.13 * h, 0.0, length(f + off)) * step(0.35, h);
      }
      void main() {
        float a = atan(vPos.x, vPos.z);
        float facing = max(dot(normalize(vN), normalize(vView)), 0.0);
        vec2 q = vec2(a * 2.2, vPos.y * 7.0);
        float b = bubbles(q, 1.1) + bubbles(q * 1.7 + 3.1, 1.7) * 0.7;
        float wave = 0.5 + 0.5 * sin(vPos.y * 3.0 + uTime * 0.7);
        vec3 base = mix(vec3(0.01, 0.12, 0.08), vec3(0.08, 0.7, 0.42), wave * 0.6 + 0.2);
        vec3 col = base * (0.18 + 0.82 * uOn) * (0.55 + 0.45 * facing) + b * vec3(0.7, 1.0, 0.85) * (0.15 + 0.85 * uOn);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
  return { material, u };
}

/** Burbuja del generador de escudos: borde de Fresnel, celdas de energía y ondas. */
export function shieldMaterial() {
  const u = { uTime: TIME, uOn: { value: 1 }, uColor: { value: new Color('#4aa3ff') } };
  const material = new ShaderMaterial({
    uniforms: u,
    toneMapped: false,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    vertexShader: VERT_SURFACE,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uOn;
      uniform vec3 uColor;
      varying vec3 vPos;
      varying vec3 vN;
      varying vec3 vView;
      ${NOISE3}
      void main() {
        float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vView))), 2.0);
        float n = snoise(vPos * 6.0 + vec3(0.0, uTime * 0.7, 0.0));
        float cells = smoothstep(0.08, 0.0, abs(n)) * 0.6;
        float wave = 0.5 + 0.5 * sin(vPos.y * 26.0 - uTime * 4.0);
        float a = (fres * 1.3 + cells + wave * 0.07) * uOn + 0.02;
        gl_FragColor = vec4(uColor * a * 1.7 + vec3(1.0) * fres * fres * uOn * 0.5, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
  return { material, u };
}

/** Pantalla de sensores: barrido de radar, anillos y contactos. `uWarn` = hay un impacto anunciado. */
export function radarMaterial() {
  const u = { uTime: TIME, uOn: { value: 1 }, uWarn: { value: 0 } };
  const material = new ShaderMaterial({
    uniforms: u,
    toneMapped: false,
    vertexShader: VERT_UV,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uOn;
      uniform float uWarn;
      varying vec2 vUv;
      const float TAU = 6.2831853;
      float trail(vec2 p) {
        float a = atan(p.y, p.x);
        float d = mod(uTime * 1.7 - a, TAU) / TAU;
        return pow(1.0 - d, 5.0);
      }
      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float r = length(p);
        float rings = 1.0 - smoothstep(0.0, 0.035, abs(fract(r * 3.0 + 0.5) - 0.5));
        float axes = (1.0 - smoothstep(0.0, 0.014, abs(p.x))) + (1.0 - smoothstep(0.0, 0.014, abs(p.y)));
        float sweep = trail(p);
        vec3 green = vec3(0.2, 1.0, 0.75);
        vec3 col = green * (0.05 + rings * 0.22 + axes * 0.12 + sweep * 0.55);
        // Contactos fijos: se encienden cuando pasa el barrido.
        vec2 b1 = vec2(0.42, 0.3);
        vec2 b2 = vec2(-0.55, -0.2);
        vec2 b3 = vec2(-0.15, 0.62);
        col += green * smoothstep(0.07, 0.0, length(p - b1)) * (0.2 + trail(b1));
        col += green * smoothstep(0.05, 0.0, length(p - b2)) * (0.2 + trail(b2));
        // Impacto anunciado: un contacto rojo que se acerca al centro.
        float pulse = 0.5 + 0.5 * sin(uTime * 10.0);
        col += vec3(1.0, 0.22, 0.2) * smoothstep(0.1, 0.0, length(p - b3 * (0.4 + 0.6 * fract(-uTime * 0.25)))) * uWarn * (0.6 + 0.8 * pulse);
        col += vec3(1.0, 0.2, 0.15) * (1.0 - smoothstep(0.0, 0.05, abs(r - 0.95))) * uWarn * pulse * 0.8;
        col *= step(r, 1.0) * uOn;
        col += vec3(0.006, 0.014, 0.016);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
  return { material, u };
}

/**
 * Holograma del timón: galones apilados de régimen (1 = económico … 3 = máxima), marcas que corren con la
 * velocidad y parpadeo ámbar cuando hay que esquivar. Sin texto: se lee de un vistazo.
 */
export function helmHoloMaterial() {
  const u = { uTime: TIME, uThrottle: { value: 1 }, uWarn: { value: 0 }, uSpeed: { value: 0 }, uOn: { value: 1 } };
  const material = new ShaderMaterial({
    uniforms: u,
    toneMapped: false,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: AdditiveBlending,
    vertexShader: VERT_UV,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uThrottle;
      uniform float uWarn;
      uniform float uSpeed;
      uniform float uOn;
      varying vec2 vUv;
      // Galón «^» centrado en la pantalla, a la altura cy.
      float chevron(vec2 uv, float cy) {
        float x = abs(uv.x - 0.5);
        float d = abs(uv.y - (cy + 0.08 - x * 1.9));
        return (1.0 - smoothstep(0.035, 0.06, d)) * step(x, 0.055);
      }
      void main() {
        vec2 uv = vUv;
        float scan = 0.8 + 0.2 * sin(uv.y * 160.0 + uTime * 5.0);
        float frame = (1.0 - smoothstep(0.0, 0.03, min(uv.y, 1.0 - uv.y))) * 0.8 + (1.0 - smoothstep(0.0, 0.006, min(uv.x, 1.0 - uv.x))) * 0.8;
        float marks = 0.0;
        for (int i = 0; i < 3; i++) {
          float lit = step(float(i), uThrottle + 0.5);
          marks += chevron(uv, 0.24 + float(i) * 0.22) * (0.12 + 0.88 * lit);
        }
        float lane = step(0.5, fract(uv.x * 26.0 - sign(uv.x - 0.5) * uTime * (0.4 + uSpeed * 5.0)));
        float ticks = lane * (step(uv.y, 0.16) + step(0.84, uv.y)) * step(0.1, abs(uv.x - 0.5)) * 0.35;
        float horizon = (1.0 - smoothstep(0.0, 0.012, abs(uv.y - 0.5))) * step(0.2, abs(uv.x - 0.5)) * 0.4;
        vec3 calm = vec3(0.22, 0.88, 0.75);
        vec3 alert = vec3(1.0, 0.6, 0.1);
        float blink = mix(1.0, 0.45 + 0.55 * step(0.0, sin(uTime * 11.0)), uWarn);
        float a = (frame + marks + ticks + horizon + 0.07) * scan * blink * uOn;
        a *= smoothstep(0.0, 0.05, uv.x) * smoothstep(1.0, 0.95, uv.x);
        gl_FragColor = vec4(mix(calm, alert, uWarn) * a, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
  return { material, u };
}

/** Haz del proyector de la mesa del mapa. */
export function beamMaterial() {
  const u = { uTime: TIME, uColor: { value: new Color('#38e1c0') } };
  const material = new ShaderMaterial({
    uniforms: u,
    toneMapped: false,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: AdditiveBlending,
    vertexShader: VERT_UV,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      varying vec2 vUv;
      void main() {
        float fade = pow(1.0 - vUv.y, 1.6);
        float rays = 0.75 + 0.25 * sin(vUv.x * 150.0 + uTime * 0.8);
        float scan = 0.85 + 0.15 * sin(vUv.y * 40.0 - uTime * 3.0);
        gl_FragColor = vec4(uColor * fade * rays * scan * 0.22, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
  return { material, u };
}

/** Tablero de la mesa del mapa: retícula polar con un pulso que se expande. */
export function tableTopMaterial() {
  const u = { uTime: TIME };
  const material = new ShaderMaterial({
    uniforms: u,
    toneMapped: false,
    vertexShader: VERT_UV,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;
      const float TAU = 6.2831853;
      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float r = length(p);
        float a = atan(p.y, p.x) / TAU;
        float rings = 1.0 - smoothstep(0.02, 0.05, abs(fract(r * 5.0) - 0.5));
        float spokes = (1.0 - smoothstep(0.004, 0.012, abs(fract(a * 12.0) - 0.5) * r)) * step(0.2, r);
        float pulse = 1.0 - smoothstep(0.0, 0.1, abs(r - fract(uTime * 0.22)));
        vec3 teal = vec3(0.22, 0.88, 0.75);
        vec3 col = vec3(0.004, 0.012, 0.018) + teal * (rings * 0.3 + spokes * 0.22 + pulse * 0.5 * (1.0 - r));
        col *= step(r, 1.0);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
  return { material, u };
}

/** Matriz de pilotos que parpadean (bastidores de equipos). `uGrid` = columnas × filas. */
export function ledsMaterial(cols: number, rows: number) {
  const u = { uTime: TIME, uOn: { value: 1 }, uGrid: { value: [cols, rows] } };
  const material = new ShaderMaterial({
    uniforms: u,
    toneMapped: false,
    vertexShader: VERT_UV,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uOn;
      uniform vec2 uGrid;
      varying vec2 vUv;
      ${NOISE2}
      void main() {
        vec2 g = vUv * uGrid;
        vec2 id = floor(g);
        vec2 f = fract(g) - 0.5;
        float h = hash21(id + 3.7);
        float on = step(0.4, hash21(id + floor(uTime * (1.0 + h * 3.0) + h * 10.0)));
        float dotMask = 1.0 - smoothstep(0.2, 0.3, max(abs(f.x), abs(f.y) * 1.3));
        vec3 c = h > 0.85 ? vec3(1.0, 0.65, 0.15) : (h > 0.4 ? vec3(0.25, 1.0, 0.65) : vec3(0.3, 0.75, 1.0));
        vec3 col = vec3(0.006, 0.01, 0.016) + c * dotMask * (0.05 + 0.95 * on * uOn);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
  return { material, u };
}

/**
 * Medidor de carga del panel de energía: segmentos encendidos hasta `uLoad` (demanda ÷ potencia).
 * La marca blanca es el 100 %: pasarla es sobrecarga y la barra entera parpadea en rojo.
 */
export function loadMeterMaterial() {
  const u = { uTime: TIME, uLoad: { value: 0.5 }, uOver: { value: 0 } };
  const material = new ShaderMaterial({
    uniforms: u,
    toneMapped: false,
    vertexShader: VERT_UV,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uLoad;
      uniform float uOver;
      varying vec2 vUv;
      const float SEGMENTS = 20.0;
      const float FULL = 0.8;
      void main() {
        float seg = floor(vUv.x * SEGMENTS) / SEGMENTS;
        float gap = step(0.14, fract(vUv.x * SEGMENTS)) * step(0.12, vUv.y) * step(vUv.y, 0.88);
        float lit = step(seg, uLoad * FULL - 0.001);
        vec3 c = seg < FULL * 0.75 ? vec3(0.2, 1.0, 0.6) : (seg < FULL ? vec3(1.0, 0.7, 0.15) : vec3(1.0, 0.2, 0.2));
        float blink = mix(1.0, 0.4 + 0.6 * step(0.0, sin(uTime * 12.0)), uOver);
        vec3 col = c * gap * (0.07 + 0.93 * lit) * blink;
        col = mix(col, vec3(1.0), (1.0 - smoothstep(0.0, 0.006, abs(vUv.x - FULL))) * 0.9);
        gl_FragColor = vec4(col + vec3(0.004, 0.008, 0.012), 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
  return { material, u };
}
