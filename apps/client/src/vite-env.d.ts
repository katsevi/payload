/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL del servidor de juego (Colyseus). Por defecto `ws://<hostname>:2567` (ver net/roomSession.ts). */
  readonly VITE_GAME_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Versión de `apps/client/package.json` (la inyecta `define` en vite.config.ts). */
declare const __APP_VERSION__: string;
