import { WebSocket } from 'ws';
import { rooms, createRoom, PlayerConn, resetRoundState } from './rooms.js';
import { ClientMsg, ServerMsg } from './protocol.js';

export function handleConnection(ws: WebSocket) {
  let currentPlayer: PlayerConn | null = null;
  let currentRoomId: string | null = null;

  const send = (msg: ServerMsg) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  };

  const broadcast = (roomId: string, msg: ServerMsg, skipWs?: WebSocket) => {
    const room = rooms.get(roomId);
    if (!room) return;
    room.players.forEach(p => {
      if (p && p.ws !== skipWs && p.ws.readyState === WebSocket.OPEN) {
        p.ws.send(JSON.stringify(msg));
      }
    });
  };

  ws.on('message', (data) => {
    try {
      const msg: ClientMsg = JSON.parse(data.toString());
      const room = currentRoomId ? rooms.get(currentRoomId) : null;

      switch (msg.type) {
        case 'PING':
          send({ type: 'PONG' });
          break;

        case 'JOIN_ROOM': {
          if (currentRoomId) {
            send({ type: 'ROOM_ERROR', code: 'ALREADY_IN_ROOM', message: 'You are already in a room.' });
            return;
          }
          
          // Room ID Validation: 6 chars, alphanumeric
          if (!/^[A-Z0-9]{6}$/.test(msg.roomId)) {
            send({ type: 'ROOM_ERROR', code: 'ROOM_ERROR', message: 'Invalid Room ID. Must be 6 alphanumeric characters.' });
            return;
          }

          let targetRoom = rooms.get(msg.roomId);
          if (!targetRoom) {
            targetRoom = createRoom(msg.roomId);
          }

          const freeIndex = targetRoom.players.findIndex(p => p === null);
          if (freeIndex === -1) {
            send({ type: 'ROOM_ERROR', code: 'ROOM_FULL', message: 'The room is full.' });
            return;
          }

          currentPlayer = {
            ws,
            name: msg.name,
            address: msg.address,
            index: freeIndex as 0 | 1
          };
          targetRoom.players[freeIndex] = currentPlayer;
          currentRoomId = msg.roomId;
          targetRoom.lastActivity = Date.now();

          send({ 
            type: 'ROOM_JOINED', 
            role: freeIndex === 0 ? 'player1' : 'player2',
            waitingForOpponent: targetRoom.players.filter(p => p !== null).length < 2
          });

          if (targetRoom.players.filter(p => p !== null).length === 2) {
            targetRoom.phase = 'round-active';
            const p1 = targetRoom.players[0]!;
            const p2 = targetRoom.players[1]!;
            
            p1.ws.send(JSON.stringify({
              type: 'GAME_STARTED',
              yourRole: 'player1',
              opponent: { name: p2.name, address: p2.address }
            }));
            p2.ws.send(JSON.stringify({
              type: 'GAME_STARTED',
              yourRole: 'player2',
              opponent: { name: p1.name, address: p1.address }
            }));
          }
          break;
        }

        case 'COMMIT_MOVE': {
          if (!room || !currentPlayer) return;
          const idx = currentPlayer.index;
          room.roundState.committed[idx] = true;
          room.lastActivity = Date.now();

          // Relay only the mode, not the commitment
          broadcast(room.id, { type: 'OPPONENT_COMMITTED', mode: msg.mode }, ws);

          if (room.roundState.committed[0] && room.roundState.committed[1]) {
            broadcast(room.id, { type: 'BOTH_COMMITTED', round: room.round });
          }
          break;
        }

        case 'PLAYER_DECISION': {
          if (!room || !currentPlayer) return;
          const idx = currentPlayer.index;
          room.roundState.decided[idx] = true;
          room.lastActivity = Date.now();

          broadcast(room.id, { type: 'OPPONENT_DECISION', decision: msg.decision }, ws);
          break;
        }

        case 'REVEAL_PUBLIC': {
          if (!room || !currentPlayer) return;
          const idx = currentPlayer.index;
          room.roundState.revealed[idx] = true;
          room.lastActivity = Date.now();

          broadcast(room.id, { type: 'OPPONENT_REVEALED_PUBLIC', cardType: msg.cardType }, ws);
          break;
        }

        case 'REVEAL_HIDDEN': {
          if (!room || !currentPlayer) return;
          const idx = currentPlayer.index;
          room.roundState.revealed[idx] = true;
          room.lastActivity = Date.now();

          broadcast(room.id, { type: 'OPPONENT_REVEALED_HIDDEN', claimedOutcome: msg.claimedOutcome }, ws);
          break;
        }

        case 'READY_NEXT_ROUND': {
          if (!room || !currentPlayer) return;
          const idx = currentPlayer.index;
          room.roundState.readyNext[idx] = true;
          room.lastActivity = Date.now();

          broadcast(room.id, { type: 'OPPONENT_READY_NEXT' }, ws);

          if (room.roundState.readyNext[0] && room.roundState.readyNext[1]) {
            room.round++;
            resetRoundState(room);
            room.phase = 'round-active';
            broadcast(room.id, { type: 'ROUND_START', round: room.round });
          }
          break;
        }

        case 'ONCHAIN_TX': {
          if (!room || !currentPlayer) return;
          broadcast(room.id, { type: 'OPPONENT_ONCHAIN_TX', action: msg.action, txHash: msg.txHash }, ws);
          break;
        }

        case 'LEAVE_ROOM': {
          cleanup();
          break;
        }
      }
    } catch (e) {
      console.error('Failed to process message:', e);
    }
  });

  const cleanup = () => {
    if (currentRoomId && currentPlayer) {
      const room = rooms.get(currentRoomId);
      if (room) {
        room.players[currentPlayer.index] = null;
        broadcast(currentRoomId, { type: 'OPPONENT_LEFT', reason: 'leave' }, ws);
        if (room.players.every(p => p === null)) {
          rooms.delete(currentRoomId);
        }
      }
    }
    currentRoomId = null;
    currentPlayer = null;
  };

  ws.on('close', () => {
    if (currentRoomId && currentPlayer) {
      const room = rooms.get(currentRoomId);
      if (room) {
        room.players[currentPlayer.index] = null;
        broadcast(currentRoomId, { type: 'OPPONENT_LEFT', reason: 'disconnect' }, ws);
        if (room.players.every(p => p === null)) {
          rooms.delete(currentRoomId);
        }
      }
    }
  });
}
