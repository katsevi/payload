/** Worker del horneado de planetas del mapa solar: recibe un aspecto y devuelve sus texturas (búferes transferidos). */
import { bakePlanet, type BakeLook } from './planetBake';

export interface BakeRequest {
  key: string;
  look: BakeLook;
  width: number;
  height: number;
}

self.onmessage = (e: MessageEvent<BakeRequest>) => {
  const { key, look, width, height } = e.data;
  const out = bakePlanet(look, width, height);
  self.postMessage({ key, ...out }, { transfer: [out.albedo.buffer, out.normal.buffer] });
};
