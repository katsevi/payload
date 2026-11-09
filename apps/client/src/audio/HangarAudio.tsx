import { useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { playerState } from '../player/playerState';
import { CONSOLE_POS } from '../scenes/hangarLayout';
import { audio, type Vec3 } from './audioEngine';

/** Zumbido de la exhibición Aurora (misma posición que `WalkerExhibit` en HangarScene). */
export const EXHIBIT_POS: Vec3 = [-9.5, 1.5, 9];
/** Zumbido de la consola de misión (CONSOLE_POS con la pantalla a 1.2 m). */
export const CONSOLE_HUM_POS: Vec3 = [CONSOLE_POS[0], 1.2, CONSOLE_POS[2]];

/**
 * Audio 3D del hangar: dos emisores posicionales (consola y exhibición) y el oyente siguiendo al
 * jugador. Es ambiente: no transmite información que no esté también en pantalla. Dentro del `<Canvas>`.
 */
export function HangarAudio() {
  useEffect(() => {
    const removers = [audio.addEmitter('consoleHum', CONSOLE_HUM_POS), audio.addEmitter('exhibitHum', EXHIBIT_POS)];
    return () => removers.forEach((r) => r());
  }, []);
  useFrame(() => {
    audio.setListener([playerState.pos.x, playerState.pos.y + 1.6, playerState.pos.z], playerState.yaw);
  });
  return null;
}
