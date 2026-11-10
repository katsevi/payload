/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL del servidor de juego (Colyseus). Por defecto `ws://<hostname>:2567` (ver net/roomSession.ts). */
  readonly VITE_GAME_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
