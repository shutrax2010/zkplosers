import { WebSocket } from 'ws';

export interface PlayerConn {
  ws: WebSocket;
  name: string;
  address: string;
  index: 0 | 1;
}

export interface RoundState {
  committed:  [boolean, boolean];
  decided:    [boolean, boolean];
  revealed:   [boolean, boolean];
  readyNext:  [boolean, boolean];
}

export type RoomPhase =
  | 'waiting'
  | 'round-active'
  | 'decision'
  | 'resolving'
  | 'game-over';

export interface Room {
  id: string;
  players: [PlayerConn | null, PlayerConn | null];
  phase: RoomPhase;
  round: number;
  roundState: RoundState;
  createdAt: number;
  lastActivity: number;
}

export const rooms = new Map<string, Room>();

export function createRoom(id: string): Room {
  const room: Room = {
    id,
    players: [null, null],
    phase: 'waiting',
    round: 0,
    roundState: {
      committed: [false, false],
      decided: [false, false],
      revealed: [false, false],
      readyNext: [false, false],
    },
    createdAt: Date.now(),
    lastActivity: Date.now(),
  };
  rooms.set(id, room);
  return room;
}

export function resetRoundState(room: Room) {
  room.roundState = {
    committed: [false, false],
    decided: [false, false],
    revealed: [false, false],
    readyNext: [false, false],
  };
}
