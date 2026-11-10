/**
 * Capa de red y de sesión del cliente (fase 3). Punto de entrada para la UI de sala:
 *   - sesión común: `getSession()`, `useMissionSession()`, `MissionSession` (session.ts, sessionStore.ts);
 *   - estado de la sala: `useRoom`, selectores `select*`, `canDo`/`useCanDo`, `activePhase` (roomStore.ts);
 *   - entrar/salir: `quickMatch`, `createPrivateRoom`, `joinRoomByCode`, `resumeRoom`, `leaveRoom` (roomSession.ts);
 *   - avatar: `publishAvatarPose`, `useAvatarPublisher` (avatar.ts).
 */
export * from './session';
export * from './sessionStore';
export * from './roomStore';
export * from './avatar';
export {
  RoomSession, quickMatch, createPrivateRoom, joinRoomByCode, resumeRoom, retryRoom, dismissRetry, leaveRoom, currentRoomSession,
  hasSavedRoom, gameServerUrl, configureNet, resetNetConfig, clipPlayerText, noGoIssues, parseNotice, joinError,
  ROOM_NAME, TOKEN_KEY, MOVE_MIN_INTERVAL_MS, DEFAULT_GAME_SERVER_PORT, RECONNECT_MIN_UPTIME_MS,
  type RoomLike, type ClientLike, type ClientFactory, type StorageLike,
} from './roomSession';
export { LocalSession, type MissionSender } from './localSession';
export { decodeRoomState, type DecodedRoom } from './roomView';
