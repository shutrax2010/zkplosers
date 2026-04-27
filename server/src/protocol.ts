import { WebSocket } from 'ws';

// ── Client → Server ──────────────────────────────────────────────

export type ClientMsg =
  | { type: 'JOIN_ROOM';        roomId: string; name: string; address: string }
  | { type: 'LEAVE_ROOM' }
  | { type: 'COMMIT_MOVE';      commitment: string; mode: 'public' | 'hidden' }
  | { type: 'PLAYER_DECISION';  decision: 'battle' | 'fold' }
  | { type: 'REVEAL_PUBLIC';    cardType: 'rock' | 'scissors' | 'paper' | 'loser' }
  | { type: 'REVEAL_HIDDEN';    claimedOutcome: 'PWins' | 'OWins' | 'Draw'; proof?: string }
  | { type: 'ONCHAIN_TX';       action: string; txHash: string }
  | { type: 'READY_NEXT_ROUND' }
  | { type: 'PING' };

// ── Server → Client ──────────────────────────────────────────────

export type ServerMsg =
  // 接続・マッチング
  | { type: 'ROOM_JOINED';       role: 'player1' | 'player2'; waitingForOpponent: boolean }
  | { type: 'OPPONENT_JOINED';   opponentName: string; opponentAddress: string }
  | { type: 'GAME_STARTED';      yourRole: 'player1' | 'player2';
                                  opponent: { name: string; address: string } }
  | { type: 'OPPONENT_LEFT';     reason: 'disconnect' | 'leave' }
  | { type: 'ROOM_ERROR';        code: 'ROOM_FULL' | 'ROOM_NOT_FOUND' | 'ALREADY_IN_ROOM'; message: string }

  // ゲーム進行
  | { type: 'OPPONENT_COMMITTED'; mode: 'public' | 'hidden' }
  | { type: 'BOTH_COMMITTED';     round: number }
  | { type: 'OPPONENT_DECISION';  decision: 'battle' | 'fold' }
  | { type: 'OPPONENT_REVEALED_PUBLIC';  cardType: string }
  | { type: 'OPPONENT_REVEALED_HIDDEN';  claimedOutcome: string; proof?: string }
  | { type: 'OPPONENT_READY_NEXT' }
  | { type: 'ROUND_START';       round: number }

  // オンチェーンモード
  | { type: 'OPPONENT_ONCHAIN_TX'; action: string; txHash: string }

  // システム
  | { type: 'PONG' };
