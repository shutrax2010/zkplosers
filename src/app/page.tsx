'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Shield, Lock, Unlock, Zap, Trophy, User, RefreshCw, 
  AlertTriangle, Hand, Scissors, Grab, Skull, Coins, CheckCircle, Users, Wifi,
  ChevronDown, ChevronUp, Wallet, Copy, Dice5, ArrowLeft, Eye, Check, Award
} from 'lucide-react';
import { createAccount, saveAccountLocally, loadAccountLocally, MidnightAccount } from '@/utils/midnightAccount';
import { multiplayerWS } from '@/services/multiplayer-ws';
import { generateRoomId } from '@/utils/roomId';
import { ServerMsg } from '@/types/multiplayer';

// --- Types ---
type Move = 'Rock' | 'Scissors' | 'Paper' | 'Loser';
type GameMode = 'SINGLE' | 'MULTI';
type GameState = 'ONBOARDING' | 'MODE_SELECTION' | 'LOBBY' | 'MATCHING' | 'BATTLE' | 'RESULT';
type BattlePhase = 'SELECT' | 'WAITING_OPPONENT' | 'DECIDE' | 'RESOLUTION' | 'WAITING_NEXT_ROUND';
type RoundResult = 'WIN' | 'LOSS' | 'DRAW' | 'FOLDED' | null;

interface RoundHistory {
  round: number;
  playerMove: Move;
  opponentMove: Move;
  playerIsSecret: boolean;
  opponentIsSecret: boolean;
  playerAction: 'battle' | 'fold';
  result: RoundResult;
  playerVPGain: number;
  opponentVPGain: number;
  txHash?: string;
}

interface PlayerState {
  name: string;
  address: string;
  vp: number;
  hand: Move[];
  usedMoves: Move[];
  balance: number;
}

const MoveIcon = ({ move, size = 24 }: { move: Move, size?: number }) => {
  switch (move) {
    case 'Rock': return <Grab size={size} className="text-accent-cyan" />;
    case 'Scissors': return <Scissors size={size} className="text-accent-purple" />;
    case 'Paper': return <Hand size={size} className="text-green-400" />;
    case 'Loser': return <Skull size={size} className="text-accent-crimson" />;
  }
};

const WalletBar = ({ address, balance }: { address: string, balance: number }) => (
  <div className="w-full max-w-2xl bg-slate-900/40 backdrop-blur-md border border-white/10 p-3 rounded-2xl flex justify-between items-center mb-6">
    <div className="flex items-center gap-3">
      <div className="p-2 bg-purple-500/20 rounded-lg text-accent-purple border border-accent-purple/20"><Wallet size={16} /></div>
      <div className="text-left">
        <p className="text-[8px] text-foreground font-black uppercase tracking-wider font-mono opacity-70">ADDRESS</p>
        <p className="text-[10px] font-mono text-foreground font-bold">{address.slice(0, 10)}...{address.slice(-6)}</p>
      </div>
    </div>
    <div className="flex items-center gap-4">
      <div className="text-right">
        <p className="text-[8px] text-foreground font-black uppercase tracking-wider font-mono opacity-70">BALANCE</p>
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-black italic text-foreground font-heading">{balance} YTTM</span>
          <span className="bg-purple-500/20 text-accent-purple text-[7px] font-black px-1.5 py-0.5 rounded border border-accent-purple/30">🔐 SHIELDED</span>
        </div>
      </div>
    </div>
  </div>
);

export default function Home() {
  // UI & App State
  const [gameState, setGameState] = useState<GameState>('ONBOARDING');
  const [gameMode, setGameMode] = useState<GameMode>('SINGLE');
  const [playerName, setPlayerName] = useState('');
  const [account, setAccount] = useState<MidnightAccount | null>(null);
  const [isOnChainMode, setIsOnChainMode] = useState(false);
  const [isLaceDetected, setIsLaceDetected] = useState(false);
  
  // Game Logic State
  const [battlePhase, setBattlePhase] = useState<BattlePhase>('SELECT');
  const [round, setRound] = useState(1);
  const [player, setPlayer] = useState<PlayerState>({ name: '', address: '', vp: 0, hand: [], usedMoves: [], balance: 0 });
  const [opponent, setOpponent] = useState<PlayerState>({ name: '', address: '', vp: 0, hand: [], usedMoves: [], balance: 0 });
  
  const [selectedMove, setSelectedMove] = useState<Move | null>(null);
  const [isSecret, setIsSecret] = useState(false);
  const [opponentIsSecret, setOpponentIsSecret] = useState(false);
  const [isZkpGenerating, setIsZkpGenerating] = useState(false);
  const [opponentFound, setOpponentFound] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const [claimSuccess, setClaimSuccess] = useState(false);
  const [roundResult, setRoundResult] = useState<RoundResult>(null);
  const [history, setHistory] = useState<RoundHistory[]>([]);
  const [showOnChainPanel, setShowOnChainPanel] = useState(false);
  const [lastRoundMoves, setLastRoundMoves] = useState<{ p: Move | null, o: Move | null }>({ p: null, o: null });
  const [isReadyNext, setIsReadyNext] = useState(false);

  // Multiplayer State
  const [roomId, setRoomId] = useState('');
  const [opponentCommitted, setOpponentCommitted] = useState(false);
  const [opponentDecision, setOpponentDecision] = useState<'battle' | 'fold' | null>(null);
  const [opponentReadyNext, setOpponentReadyNext] = useState(false);
  const [opponentTxHashes, setOpponentTxHashes] = useState<string[]>([]);
  
  // --- Sync References ---
  const stateRef = useRef({ 
    gameState, battlePhase, isSecret, opponentIsSecret, selectedMove, player, opponent, round 
  });
  stateRef.current = { gameState, battlePhase, isSecret, opponentIsSecret, selectedMove, player, opponent, round };

  const opponentStateRef = useRef({
    committed: false,
    decision: null as 'battle' | 'fold' | null,
    revealedMove: null as Move | null,
    claimedOutcome: null as 'PWins' | 'OWins' | 'Draw' | 'WIN' | 'LOSS' | 'DRAW' | null,
    readyNext: false,
    publicCardPending: null as Move | null
  });

  const localDecisionRef = useRef<'battle' | 'fold' | null>(null);

  // Constants
  const YTTM_REWARD = 10;
  const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001';

  // Initialize
  useEffect(() => {
    const saved = loadAccountLocally();
    setTimeout(() => {
      if (saved) {
        setAccount(saved);
        setGameState('MODE_SELECTION');
      }
      setIsLaceDetected(Math.random() > 0.5);
    }, 0);
  }, []);

  // --- Game Logic ---

  const generateDummyTxHash = () => `0x${Math.random().toString(16).substring(2, 18)}${Math.random().toString(16).substring(2, 18)}`;

  const calculateVP = useCallback((
    pMove: Move, 
    oMove: Move, 
    pSecret: boolean, 
    oSecret: boolean, 
    pAction: 'battle' | 'fold',
    oAction: 'battle' | 'fold' = 'battle'
  ) => {
    let pGain = 0;
    let oGain = 0;
    let result: RoundResult = null;

    if (pAction === 'fold' || oAction === 'fold') {
      return { pGain: 0, oGain: 0, result: 'FOLDED' as RoundResult };
    }

    if (pMove === oMove) {
      result = 'DRAW';
      pGain = 1; oGain = 1;
      return { pGain, oGain, result };
    }

    const pWins = (pMove === 'Rock' && oMove === 'Scissors') || 
                  (pMove === 'Paper' && oMove === 'Rock') ||
                  (pMove === 'Scissors' && oMove === 'Paper') ||
                  (oMove === 'Loser' && pMove !== 'Loser');
    
    if (pWins) {
      result = 'WIN';
      pGain = (pSecret && oSecret) ? 3 : 1;
      oGain = oSecret ? -1 : 0;
    } else {
      result = 'LOSS';
      oGain = (pSecret && oSecret) ? 3 : 1;
      pGain = pSecret ? -1 : 0;
    }

    return { pGain, oGain, result };
  }, []);

  const resetRoundStates = useCallback(() => {
    setRoundResult(null);
    setSelectedMove(null);
    setIsSecret(false);
    setOpponentIsSecret(false);
    setBattlePhase('SELECT');
    setOpponentCommitted(false);
    setOpponentDecision(null);
    setOpponentReadyNext(false);
    setIsReadyNext(false);
    setLastRoundMoves({ p: null, o: null });
    localDecisionRef.current = null;
    opponentStateRef.current = { 
      committed: false, decision: null, revealedMove: null, claimedOutcome: null, readyNext: false,
      publicCardPending: null
    };
  }, []);

  const goToNextRound = useCallback(() => {
    const { round: r } = stateRef.current;
    if (r < 3) {
      setRound(r + 1);
      resetRoundStates();
    } else {
      setGameState('RESULT');
      if (gameMode === 'MULTI') {
        setTimeout(() => multiplayerWS.disconnect(), 100);
      }
    }
  }, [resetRoundStates, gameMode]);

  const finalizeResolution = useCallback((action: 'battle' | 'fold', oMove: Move) => {
    const oAction = gameMode === 'MULTI' ? (opponentStateRef.current.decision || 'battle') : 'battle';
    const { isSecret: pSecret, opponentIsSecret: oSecret, selectedMove: pMove, round: r } = stateRef.current;
    
    let { pGain, oGain, result } = calculateVP(pMove!, oMove, pSecret, oSecret, action, oAction);

    if (gameMode === 'MULTI' && oSecret && opponentStateRef.current.claimedOutcome && result !== 'FOLDED') {
      const outcome = opponentStateRef.current.claimedOutcome;
      if (outcome === 'PWins' || outcome === 'WIN') {
        result = 'LOSS';
        if (pSecret) { pGain = -1; oGain = 3; } else { pGain = 0; oGain = 1; }
      } else if (outcome === 'OWins' || outcome === 'LOSS') {
        result = 'WIN';
        if (pSecret) { pGain = 3; oGain = -1; } else { pGain = 1; oGain = -1; } 
      } else {
        result = 'DRAW';
        pGain = 1; oGain = 1;
      }
    }
    
    setRoundResult(result);
    setLastRoundMoves({ p: pMove, o: oMove });
    
    const roundData: RoundHistory = {
      round: r,
      playerMove: pMove!,
      opponentMove: oMove,
      playerIsSecret: pSecret,
      opponentIsSecret: oSecret,
      playerAction: action,
      result,
      playerVPGain: pGain,
      opponentVPGain: oGain,
      txHash: isOnChainMode ? generateDummyTxHash() : undefined
    };

    setHistory(prev => [...prev, roundData]);

    setPlayer(prev => ({ 
      ...prev, 
      vp: prev.vp + pGain, 
      hand: prev.hand.filter(m => m !== pMove), 
      usedMoves: [...prev.usedMoves, pMove!] 
    }));
    
    setOpponent(prev => ({ 
      ...prev, 
      vp: prev.vp + oGain, 
      hand: prev.hand.slice(1),
      usedMoves: [...prev.usedMoves, oMove]
    }));
  }, [calculateVP, gameMode, isOnChainMode]);

  const processResolution = useCallback((action: 'battle' | 'fold') => {
    const { selectedMove: pMove, opponentIsSecret: oSecret, isSecret: pSecret, opponent: opp } = stateRef.current;
    if (!pMove) return;
    setBattlePhase('RESOLUTION');
    localDecisionRef.current = action;

    if (gameMode === 'SINGLE') {
      finalizeResolution(action, opp.hand[0]);
    } else {
      if (pSecret) {
        if (oSecret) {
          multiplayerWS.send({ type: 'REVEAL_HIDDEN', claimedOutcome: 'Draw', proof: pMove.toLowerCase() });
        } else {
          const checkPending = setInterval(() => {
            const oMove = opponentStateRef.current.revealedMove || opponentStateRef.current.publicCardPending;
            if (oMove) {
              clearInterval(checkPending);
              const res = calculateVP(pMove, oMove, true, false, 'battle', 'battle');
              const outcome = res.result === 'WIN' ? 'PWins' : res.result === 'LOSS' ? 'OWins' : 'Draw';
              multiplayerWS.send({ type: 'REVEAL_HIDDEN', claimedOutcome: outcome, proof: pMove.toLowerCase() });
              finalizeResolution(action, oMove);
            }
          }, 500);
          return;
        }
      } else {
        multiplayerWS.send({ type: 'REVEAL_PUBLIC', cardType: pMove.toLowerCase() as any });
      }

      const checkOpponentData = setInterval(() => {
        const hasDecision = (oSecret || pSecret) ? !!opponentStateRef.current.decision : true;
        const hasReveal = opponentStateRef.current.revealedMove || opponentStateRef.current.claimedOutcome;
        
        if (hasDecision && hasReveal) {
          clearInterval(checkOpponentData);
          finalizeResolution(action, opponentStateRef.current.revealedMove || opp.hand[0]);
        }
      }, 500);
    }
  }, [gameMode, finalizeResolution, calculateVP]);

  const handleBattleAction = useCallback((action: 'BATTLE' | 'FOLD') => {
    const pAction = action.toLowerCase() as 'battle' | 'fold';
    const { isSecret: pSecret } = stateRef.current;

    if (gameMode === 'MULTI') {
      multiplayerWS.send({ type: 'PLAYER_DECISION', decision: pAction });
    }

    if (pAction === 'battle' && pSecret) {
      setIsZkpGenerating(true);
      setTimeout(() => {
        setIsZkpGenerating(false);
        processResolution(pAction);
      }, 1500);
    } else {
      processResolution(pAction);
    }
  }, [processResolution, gameMode]);

  const handleBattleActionRef = useRef(handleBattleAction);
  handleBattleActionRef.current = handleBattleAction;

  // --- Multiplayer Message Handling ---
  useEffect(() => {
    if (gameMode !== 'MULTI') return;

    const onGameStarted = (msg: Extract<ServerMsg, { type: 'GAME_STARTED' }>) => {
      setGameState('BATTLE');
      setBattlePhase('SELECT');
      setOpponentFound(true);
      const moves: Move[] = ['Rock', 'Paper', 'Scissors'];
      const pMoves = ['Loser', ...[...moves].sort(() => Math.random() - 0.5).slice(0, 2)] as Move[];
      const oMoves = ['Loser', ...[...moves].sort(() => Math.random() - 0.5).slice(0, 2)] as Move[];
      setPlayer(prev => ({ ...prev, name: playerName, address: account?.address || 'me', vp: 0, hand: pMoves, usedMoves: [], balance: prev.balance || 25 }));
      setOpponent({ name: msg.opponent.name, address: msg.opponent.address, vp: 0, hand: oMoves, usedMoves: [], balance: 0 });
    };

    const onOpponentCommitted = (msg: Extract<ServerMsg, { type: 'OPPONENT_COMMITTED' }>) => {
      setOpponentIsSecret(msg.mode === 'hidden');
      setOpponentCommitted(true);
      opponentStateRef.current.committed = true;
    };

    const onBothCommitted = () => {
      const { battlePhase: cp, opponentIsSecret: os, isSecret: ms } = stateRef.current;
      if (cp === 'WAITING_OPPONENT' || cp === 'SELECT') {
        if (os) setBattlePhase('DECIDE');
        else if (!ms) handleBattleActionRef.current('BATTLE');
      }
    };

    const onOpponentDecision = (msg: Extract<ServerMsg, { type: 'OPPONENT_DECISION' }>) => {
      setOpponentDecision(msg.decision);
      opponentStateRef.current.decision = msg.decision;
      const { isSecret: ms, opponentIsSecret: os, battlePhase: cp } = stateRef.current;
      if (ms && !os && cp === 'WAITING_OPPONENT') handleBattleActionRef.current('BATTLE');
    };

    const onOpponentRevealedPublic = (msg: Extract<ServerMsg, { type: 'OPPONENT_REVEALED_PUBLIC' }>) => {
      const move = (msg.cardType.charAt(0).toUpperCase() + msg.cardType.slice(1)) as Move;
      const { battlePhase: cp, isSecret: ms } = stateRef.current;
      if (cp === 'RESOLUTION' && ms) opponentStateRef.current.revealedMove = move;
      else if (cp !== 'RESOLUTION' && ms) opponentStateRef.current.publicCardPending = move;
      else opponentStateRef.current.revealedMove = move;
    };

    const onOpponentRevealedHidden = (msg: Extract<ServerMsg, { type: 'OPPONENT_REVEALED_HIDDEN' }>) => {
      opponentStateRef.current.claimedOutcome = msg.claimedOutcome as any;
      if (msg.proof) opponentStateRef.current.revealedMove = (msg.proof.charAt(0).toUpperCase() + msg.proof.slice(1)) as Move;
    };

    const onOpponentReadyNext = () => {
      setOpponentReadyNext(true);
      opponentStateRef.current.readyNext = true;
    };

    const onRoundStart = (msg: Extract<ServerMsg, { type: 'ROUND_START' }>) => {
      setRound(msg.round + 1);
      resetRoundStates();
    };

    const onOpponentLeft = () => {
      if (stateRef.current.gameState === 'RESULT') return;
      alert('Opponent has left the game.');
      setGameState('MODE_SELECTION');
      multiplayerWS.disconnect();
    };

    const onOpponentOnChainTx = (msg: Extract<ServerMsg, { type: 'OPPONENT_ONCHAIN_TX' }>) => {
      setOpponentTxHashes(prev => [...prev, msg.txHash]);
    };

    const onRoomError = (msg: Extract<ServerMsg, { type: 'ROOM_ERROR' }>) => {
      alert(`Room Error: ${msg.message}`);
      setGameState('LOBBY');
    };

    multiplayerWS.on('GAME_STARTED', onGameStarted);
    multiplayerWS.on('OPPONENT_COMMITTED', onOpponentCommitted);
    multiplayerWS.on('BOTH_COMMITTED', onBothCommitted);
    multiplayerWS.on('OPPONENT_DECISION', onOpponentDecision);
    multiplayerWS.on('OPPONENT_REVEALED_PUBLIC', onOpponentRevealedPublic);
    multiplayerWS.on('OPPONENT_REVEALED_HIDDEN', onOpponentRevealedHidden);
    multiplayerWS.on('OPPONENT_READY_NEXT', onOpponentReadyNext);
    multiplayerWS.on('ROUND_START', onRoundStart);
    multiplayerWS.on('OPPONENT_ONCHAIN_TX', onOpponentOnChainTx);
    multiplayerWS.on('OPPONENT_LEFT', onOpponentLeft);
    multiplayerWS.on('ROOM_ERROR', onRoomError);

    return () => {
      multiplayerWS.off('GAME_STARTED');
      multiplayerWS.off('OPPONENT_COMMITTED');
      multiplayerWS.off('BOTH_COMMITTED');
      multiplayerWS.off('OPPONENT_DECISION');
      multiplayerWS.off('OPPONENT_REVEALED_PUBLIC');
      multiplayerWS.off('OPPONENT_REVEALED_HIDDEN');
      multiplayerWS.off('OPPONENT_READY_NEXT');
      multiplayerWS.off('ROUND_START');
      multiplayerWS.off('OPPONENT_ONCHAIN_TX');
      multiplayerWS.off('OPPONENT_LEFT');
      multiplayerWS.off('ROOM_ERROR');
    };
  }, [gameMode, playerName, account, resetRoundStates]);

  // --- Handlers ---

  const handleConnectWallet = () => {
    const acc = createAccount(); 
    setAccount(acc);
    saveAccountLocally(acc);
    setGameState('MODE_SELECTION');
    setIsLaceDetected(true);
  };

  const handleStartGame = useCallback(async (mode: GameMode, existingRoomId?: string) => {
    setGameState('MATCHING');
    setOpponentFound(false);
    setHistory([]);
    setRound(1);
    resetRoundStates();

    if (mode === 'SINGLE') {
      setTimeout(() => {
        setOpponentFound(true);
        setTimeout(() => {
          setGameState('BATTLE');
          setBattlePhase('SELECT');
          const moves: Move[] = ['Rock', 'Paper', 'Scissors'];
          const pMoves = ['Loser', ...[...moves].sort(() => Math.random() - 0.5).slice(0, 2)] as Move[];
          const oMoves = ['Loser', ...[...moves].sort(() => Math.random() - 0.5).slice(0, 2)] as Move[];
          setPlayer(prev => ({ ...prev, name: playerName, address: account?.address || 'me', vp: 0, hand: pMoves, usedMoves: [], balance: prev.balance || 25 }));
          setOpponent({ name: 'ENFORCER_v4', address: 'mn_addr_test_opp_99x', vp: 0, hand: oMoves, usedMoves: [], balance: 0 });
        }, 800);
      }, 800);
    } else {
      try {
        await multiplayerWS.connect(WS_URL);
        const rId = existingRoomId || generateRoomId();
        setRoomId(rId);
        multiplayerWS.send({ type: 'JOIN_ROOM', roomId: rId, name: playerName, address: account?.address || 'me' });
      } catch {
        alert('Failed to connect to multiplayer server.');
        setGameState('MODE_SELECTION');
      }
    }
  }, [playerName, account, resetRoundStates]);

  const handleModeSelect = (mode: GameMode) => {
    if (!playerName) return;
    setGameMode(mode);
    if (mode === 'SINGLE') handleStartGame('SINGLE');
    else setGameState('LOBBY');
  };

  const handleCommitMove = () => {
    if (!selectedMove) return;
    if (gameMode === 'MULTI') multiplayerWS.send({ type: 'PING' }); 
    setBattlePhase('WAITING_OPPONENT');
    if (gameMode === 'MULTI') {
      multiplayerWS.send({ type: 'COMMIT_MOVE', commitment: `0x${Math.random().toString(16).substring(2, 40)}`, mode: isSecret ? 'hidden' : 'public' });
    } else {
      setTimeout(() => {
        const opSecret = Math.random() > 0.4;
        setOpponentIsSecret(opSecret);
        setOpponentCommitted(true);
        if (opSecret || isSecret) setBattlePhase('DECIDE');
        else handleBattleActionRef.current('BATTLE');
      }, 800);
    }
  };

  const handleNextRoundClick = () => {
    if (isReadyNext) return;
    setIsReadyNext(true);
    if (round < 3) {
      if (gameMode === 'SINGLE') {
        goToNextRound();
      } else {
        setBattlePhase('WAITING_NEXT_ROUND');
        multiplayerWS.send({ type: 'READY_NEXT_ROUND' });
      }
    } else {
      setGameState('RESULT');
    }
  };

  const handleClaimReward = () => {
    setIsClaiming(true);
    setTimeout(() => {
      setIsClaiming(false);
      setClaimSuccess(true);
      setPlayer(prev => ({ ...prev, balance: prev.balance + YTTM_REWARD }));
      if (gameMode === 'MULTI') multiplayerWS.send({ type: 'ONCHAIN_TX', action: 'claimReward', txHash: generateDummyTxHash() });
    }, 2000);
  };

  return (
    <main className="min-h-screen bg-background text-foreground font-mono overflow-x-hidden selection:bg-accent-purple/30">
      <div className="fixed top-0 left-0 w-full h-full -z-10 opacity-30 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[60%] h-[60%] bg-accent-purple/20 rounded-full blur-[180px]"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[60%] h-[60%] bg-accent-cyan/20 rounded-full blur-[180px]"></div>
        <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-20"></div>
      </div>
      
      {gameState === 'ONBOARDING' && (
        <div className="flex flex-col items-center justify-center min-h-screen p-4 animate-in fade-in duration-1000">
          <div className="cyber-panel p-10 md:p-14 rounded-[2.5rem] w-full max-w-md text-center border-white/5 relative overflow-hidden">
            <div className="absolute -top-24 -right-24 w-48 h-48 bg-accent-purple/20 blur-[60px] rounded-full"></div>
            <div className="bg-gradient-to-br from-accent-purple to-indigo-600 p-6 rounded-[1.8rem] inline-block mb-10 shadow-2xl relative z-10 border border-white/10"><Shield size={64} className="text-white" /></div>
            <h1 className="text-4xl md:text-5xl font-black mb-4 italic tracking-tighter text-foreground font-heading relative z-10">LOSER&apos;S GAMBIT</h1>
            <p className="text-accent-cyan mb-12 text-[10px] tracking-[0.5em] font-black uppercase relative z-10">Midnight ZKP Strategy</p>
            <div className="space-y-4 relative z-10">
              <div className="flex items-center justify-center gap-2 mb-2">
                <span className={`w-2 h-2 rounded-full ${isLaceDetected ? 'bg-green-500 animate-pulse' : 'bg-slate-600'}`}></span>
                <span className="text-[9px] font-black tracking-widest text-foreground uppercase">Lace Wallet {isLaceDetected ? 'Detected' : 'Not Found'}</span>
              </div>
              <button onClick={() => handleConnectWallet()} disabled={!isLaceDetected} className="w-full py-5 bg-white text-slate-900 rounded-2xl font-black text-lg flex items-center justify-center gap-3 active:scale-[0.98] transition-all disabled:opacity-30 disabled:grayscale hover:bg-slate-100 cursor-pointer">
                <img src="https://www.lace.io/favicon.ico" className="w-6 h-6 rounded-full" alt="" />
                CONNECT LACE WALLET
              </button>
              <button onClick={() => handleConnectWallet()} className="w-full py-5 bg-slate-800 border border-white/5 hover:bg-slate-700/80 rounded-2xl font-black text-lg active:scale-[0.98] transition-all text-white cursor-pointer">
                CONNECT WALLET (DEMO)
              </button>
            </div>
            <div className="mt-12 flex items-center justify-center gap-2 text-foreground font-bold text-[9px] uppercase tracking-widest">
              <Lock size={12} className="text-accent-purple" /> ZKP-Shielded · Midnight Preprod · YTTM Token
            </div>
          </div>
        </div>
      )}

      {gameState === 'MODE_SELECTION' && (
        <div className="flex flex-col items-center justify-center min-h-screen p-4 animate-in zoom-in duration-500">
          {account && <WalletBar address={account.address} balance={player.balance} />}
          <div className="w-full max-w-2xl cyber-panel p-8 md:p-12 rounded-[2.5rem] border-white/5 shadow-2xl">
            <div className="flex items-center gap-6 mb-10">
              <div className="p-4 bg-accent-cyan/10 border border-accent-cyan/20 rounded-2xl text-accent-cyan"><User size={28} /></div>
              <div className="flex-1">
                <span className="text-[9px] text-foreground font-black uppercase tracking-[0.2em] block mb-1 opacity-80">OPERATIVE NAME</span>
                <input type="text" placeholder="CODENAME..." value={playerName} onChange={(e) => setPlayerName(e.target.value)} className="bg-transparent text-2xl font-black italic text-white outline-none w-full border-b border-white/10 focus:border-accent-cyan transition-all placeholder:text-slate-800 font-heading" />
              </div>
            </div>
            <div className="flex items-center justify-between p-4 bg-black/30 rounded-2xl border border-white/5 mb-8">
              <div className="flex items-center gap-3">
                <Zap size={20} className={isOnChainMode ? "text-yellow-400" : "text-slate-400"} />
                <div>
                  <p className="text-xs font-black uppercase tracking-tighter font-heading flex items-center gap-2 text-foreground">ON-CHAIN MODE {isOnChainMode && <span className="text-[7px] bg-yellow-400/20 text-yellow-400 px-1.5 py-0.5 rounded font-mono border border-yellow-400/20">DEMO — simulated</span>}</p>
                  <p className="text-[9px] text-foreground font-bold uppercase tracking-wider opacity-60">{isOnChainMode ? "SIMULATED TRANSACTION FLOW" : "OFF-CHAIN FAST PLAY"}</p>
                </div>
              </div>
              <button onClick={() => setIsOnChainMode(!isOnChainMode)} className={`w-14 h-8 rounded-full p-1 transition-colors cursor-pointer ${isOnChainMode ? "bg-yellow-500" : "bg-slate-700"}`}>
                <div className={`w-6 h-6 bg-white rounded-full transition-transform ${isOnChainMode ? "translate-x-6" : "translate-x-0"}`}></div>
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">
              <button disabled={!playerName} onClick={() => handleModeSelect('SINGLE')} className="group relative bg-slate-800/30 p-8 rounded-3xl border border-white/5 hover:border-accent-cyan/50 hover:bg-accent-cyan/5 transition-all flex flex-col items-center disabled:opacity-20 cursor-pointer">
                <div className="p-4 bg-accent-cyan/10 rounded-xl mb-4 group-hover:scale-110 transition-transform"><User size={32} className="text-accent-cyan" /></div>
                <h3 className="text-xl font-black italic uppercase tracking-tighter font-heading text-white">SOLO OPERATIVE</h3>
                <p className="text-[9px] text-foreground font-bold uppercase tracking-[0.2em] mt-2 font-mono opacity-70">VS ENFORCER AI</p>
                {isOnChainMode && <span className="absolute top-4 right-4 bg-yellow-500/20 text-yellow-500 text-[8px] font-black px-2 py-0.5 rounded border border-yellow-500/30">⛓ ON-CHAIN</span>}
              </button>
              <button disabled={!playerName} onClick={() => handleModeSelect('MULTI')} className="group relative bg-slate-800/30 p-8 rounded-3xl border border-white/5 hover:border-accent-purple/50 hover:bg-accent-purple/5 transition-all flex flex-col items-center disabled:opacity-20 cursor-pointer">
                <div className="p-4 bg-accent-purple/10 rounded-xl mb-4 group-hover:scale-110 transition-transform"><Users size={32} className="text-accent-purple" /></div>
                <h3 className="text-xl font-black italic uppercase tracking-tighter font-heading text-white">MULTI-SYNC</h3>
                <p className="text-[9px] text-foreground font-bold uppercase tracking-[0.2em] mt-2 font-mono opacity-70">P2P REAL-TIME</p>
                <span className="mt-2 bg-slate-900 text-foreground text-[8px] font-black px-2 py-0.5 rounded font-mono border border-white/5">ONLINE</span>
              </button>
            </div>
            <div className="bg-white/5 border border-white/10 p-5 rounded-2xl flex items-start gap-4">
              <div className="p-2 bg-yellow-500/20 rounded-lg text-yellow-500"><Trophy size={20} /></div>
              <div>
                <p className="text-xs font-black uppercase text-foreground font-heading mb-1 tracking-wider">QUICK RULES</p>
                <p className="text-[10px] text-foreground leading-relaxed uppercase font-mono tracking-tight opacity-80">3 Rounds. Use Rock-Paper-Scissors to win VP. <span className="text-accent-purple font-bold">Hidden mode</span> grants +3 VP but costs -1 VP on loss. Winner claims <span className="text-accent-cyan font-bold italic">10 YTTM 🔐</span>.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {gameState === 'LOBBY' && (
        <div className="flex flex-col items-center justify-center min-h-screen p-4 animate-in slide-in-from-bottom-5">
          <div className="w-full max-w-md">
            <div className="cyber-panel p-10 rounded-[2.5rem] text-center border-accent-cyan/30 shadow-2xl">
              <div className="flex justify-between items-center mb-10">
                <button onClick={() => setGameState('MODE_SELECTION')} className="p-2 text-foreground hover:text-white transition-colors cursor-pointer opacity-70 hover:opacity-100"><ArrowLeft size={20} /></button>
                <h2 className="text-2xl font-black italic uppercase tracking-tighter font-heading text-white">ESTABLISH CHANNEL</h2>
                <div className="w-8"></div>
              </div>
              <div className="mb-10 text-left">
                <p className="text-[10px] text-foreground font-black uppercase tracking-[0.3em] mb-3 ml-1 font-mono opacity-70">ENTER ROOM ID</p>
                <div className="flex gap-2">
                  <input type="text" placeholder="BATTLE-ID" value={roomId} onChange={(e) => setRoomId(e.target.value.toUpperCase())} className="flex-1 bg-black/50 border border-slate-700 p-5 rounded-2xl text-center tracking-[0.4em] font-mono font-black text-xl text-accent-cyan outline-none focus:border-accent-cyan transition-all" />
                  <button onClick={() => setRoomId(generateRoomId())} className="bg-slate-800 hover:bg-slate-700 p-5 rounded-2xl text-foreground hover:text-accent-cyan transition-colors cursor-pointer border border-white/5" title="Random ID"><Dice5 size={24} /></button>
                </div>
              </div>
              <button disabled={!roomId} onClick={() => handleStartGame('MULTI', roomId)} className="w-full py-6 bg-accent-cyan text-slate-900 rounded-2xl font-black text-xl shadow-2xl active:scale-95 transition-all uppercase tracking-widest disabled:opacity-30 cursor-pointer font-heading">JOIN ROOM</button>
            </div>
          </div>
        </div>
      )}

      {gameState === 'MATCHING' && (
        <div className="flex flex-col items-center justify-center min-h-screen p-4">
          <div className="relative mb-12">
            <div className="w-40 h-40 rounded-full border-4 border-accent-cyan/10 border-t-accent-cyan animate-spin"></div>
            <div className="absolute inset-0 flex items-center justify-center"><Wifi size={40} className={opponentFound ? "text-green-400" : "text-accent-cyan animate-pulse"} /></div>
          </div>
          <div className="text-center w-full max-w-sm">
            <p className="text-4xl font-black italic tracking-tighter uppercase mb-6 font-heading text-white">{opponentFound ? 'READY TO BREACH' : 'LOCATING PEER'}</p>
            {gameMode === 'MULTI' && !opponentFound && (
              <div className="cyber-panel p-6 rounded-3xl border-white/10 mb-8 animate-pulse">
                <p className="text-[10px] text-foreground font-black uppercase tracking-[0.3em] mb-3 font-mono opacity-80">YOUR ROOM ID</p>
                <div className="flex items-center justify-center gap-4 bg-black/40 p-4 rounded-xl border border-white/5">
                  <span className="text-3xl font-mono font-black tracking-[0.3em] text-accent-cyan">{roomId}</span>
                  <button onClick={() => { navigator.clipboard.writeText(roomId); }} className="p-2.5 bg-white/5 rounded-lg hover:bg-white/10 transition-colors text-foreground cursor-pointer"><Copy size={18} /></button>
                </div>
                <p className="text-[9px] text-foreground mt-4 uppercase tracking-widest font-mono opacity-60">Share this code with your opponent</p>
              </div>
            )}
            <p className="text-foreground font-bold tracking-[0.3em] uppercase text-[9px] font-mono opacity-70">ESTABLISHING SECURE CHANNEL...</p>
          </div>
          {gameMode === 'MULTI' && (
            <button onClick={() => { multiplayerWS.disconnect(); setGameState('LOBBY'); }} className="mt-12 py-3 px-8 bg-slate-800/50 hover:bg-accent-crimson/20 rounded-xl border border-white/5 text-accent-crimson hover:text-white text-[10px] font-black uppercase tracking-[0.3em] transition-all cursor-pointer font-mono">CANCEL SYNC</button>
          )}
        </div>
      )}

      {gameState === 'BATTLE' && (
        <div className="flex flex-col h-screen max-h-screen w-full max-w-4xl mx-auto overflow-hidden text-white relative py-4 px-6 md:px-10 select-none">
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-2xl font-black italic tracking-tighter text-white font-heading text-foreground">LOSER&apos;S GAMBIT</h1>
            <div className="bg-white/5 px-6 py-2 rounded-full border border-white/10 font-black text-[10px] tracking-[0.4em] uppercase text-foreground font-heading opacity-80">ROUND {round} / 3 {isOnChainMode && <span className="text-yellow-500 ml-2">⛓ ON-CHAIN</span>}</div>
          </div>

          <div className="flex flex-col mb-4">
            <div className="flex justify-between items-start mb-2 px-2">
              <div className="flex flex-col gap-1">
                <span className="text-[8px] font-black text-rose-500 tracking-[0.2em] uppercase font-mono flex items-center gap-2"><span className={`w-1.5 h-1.5 rounded-full bg-rose-500 ${opponentCommitted ? '' : 'animate-pulse'}`}></span> OPPONENT</span>
                <span className="text-xl font-black italic truncate text-rose-500 uppercase tracking-tighter font-heading">{opponent.name}</span>
              </div>
              <div className="text-right">
                <span className="text-[8px] font-black text-foreground tracking-[0.2em] uppercase font-mono block mb-1 opacity-70">SCORE</span>
                <span className="text-3xl font-black text-white font-heading">{opponent.vp} <span className="text-[10px] uppercase opacity-50 font-mono">VP</span></span>
              </div>
            </div>
            <div className="flex gap-2 px-2">
              {[...Array(3)].map((_, i) => {
                const isUsed = i < opponent.usedMoves.length;
                return ( <div key={i} className={`w-10 h-14 rounded-lg border flex items-center justify-center transition-all ${isUsed ? 'border-white/5 border-dashed bg-transparent opacity-20' : 'border-white/10 bg-white/5'}`}>{!isUsed && <Shield size={14} className="text-slate-600" />}</div> );
              })}
              <div className="flex-1 flex items-center justify-end px-2"><p className="text-[9px] text-foreground italic uppercase font-mono tracking-widest opacity-60">{battlePhase === 'SELECT' ? 'Thinking...' : battlePhase === 'WAITING_OPPONENT' ? 'Committed' : 'Deciding...'}</p></div>
            </div>
          </div>

          <div className="flex-1 relative flex flex-col items-center justify-center border-y border-white/5 py-4 my-2">
             <div className="flex gap-6 md:gap-12 items-center justify-center w-full transform scale-[0.85] md:scale-100">
              <div className={`w-32 h-48 md:w-40 md:h-56 rounded-[2rem] border-2 flex flex-col items-center justify-center transition-all duration-700 relative overflow-hidden ${battlePhase === 'SELECT' ? 'bg-black/20 border-white/5 opacity-10 scale-90' : opponentIsSecret ? 'bg-gradient-to-br from-[#1e1b4b] to-[#312e81] border-accent-purple/50 glow-hidden scale-110 shadow-2xl' : 'bg-slate-800/80 border-white/20 scale-110 shadow-2xl'}`}>
                {battlePhase !== 'SELECT' && ( <> <div className={`p-4 md:p-6 rounded-[1.5rem] mb-4 ${opponentIsSecret ? 'bg-accent-purple text-white shadow-lg' : 'bg-slate-700 text-white'}`}>{opponentIsSecret ? <Lock size={40} /> : <Unlock size={40} />}</div> <span className="text-[10px] font-black tracking-[0.3em] uppercase font-mono text-white">{opponentIsSecret ? 'HIDDEN' : 'PUBLIC'}</span> </> )}
              </div>
              <div className="text-4xl md:text-5xl font-black italic text-white/5 tracking-tighter select-none font-heading">VS</div>
              <div className={`w-32 h-48 md:w-40 md:h-56 rounded-[2rem] border-2 flex flex-col items-center justify-center transition-all duration-700 relative overflow-hidden ${!selectedMove ? 'bg-black/20 border-white/5 border-dashed opacity-10' : isSecret ? 'bg-gradient-to-br from-[#2e1065] to-[#1e1b4b] border-accent-purple/50 glow-hidden scale-110 shadow-2xl' : 'bg-slate-800 border-accent-cyan/40 scale-110 shadow-2xl'}`}>
                {selectedMove ? ( <> <div className={`p-4 md:p-6 rounded-[1.5rem] mb-4 backdrop-blur-md text-white border transition-all ${isSecret ? 'bg-accent-purple/30 border-accent-purple/30' : 'bg-accent-cyan/10 border-accent-cyan/30'}`}><MoveIcon move={selectedMove} size={48} /></div> <span className="text-sm md:text-base font-black tracking-widest uppercase mb-1 font-heading text-white">{selectedMove}</span> <div className={`flex items-center gap-1.5 px-3 py-0.5 rounded-full text-[9px] font-black border uppercase font-mono ${isSecret ? 'bg-accent-purple/10 border-accent-purple/30 text-accent-purple' : 'bg-accent-cyan/5 border-accent-cyan/30 text-accent-cyan'}`}>{isSecret ? <Lock size={10} /> : <Unlock size={10} />} {isSecret ? 'HIDDEN' : 'PUBLIC'}</div> </> ) : ( <div className="flex flex-col items-center gap-3"><span className="w-10 h-10 rounded-full border border-white/5 flex items-center justify-center bg-white/5 text-white/10 text-xl font-heading">?</span><span className="text-[8px] font-black text-white/10 tracking-[0.4em] uppercase font-mono">Select Move</span></div> )}
              </div>
            </div>

            {roundResult && (
              <div className="absolute inset-0 z-40 flex items-center justify-center bg-background/60 backdrop-blur-md rounded-[2.5rem] animate-reveal">
                <div className="text-center px-6 py-8 cyber-panel rounded-3xl w-full max-w-sm border-white/10 shadow-2xl shadow-black">
                  <h2 className={`text-4xl md:text-5xl font-black italic tracking-tighter leading-none mb-4 font-heading ${roundResult === 'WIN' ? 'text-accent-cyan' : roundResult === 'LOSS' ? 'text-accent-crimson' : roundResult === 'FOLDED' ? 'text-text-sub' : 'text-accent-cyan'}`}>{roundResult === 'WIN' ? 'YOU WIN' : roundResult === 'LOSS' ? 'YOU LOSE' : roundResult === 'FOLDED' ? 'FOLD' : 'DRAW'}</h2>
                  <div className="flex gap-8 justify-center mb-8">
                    <div className="flex flex-col items-center gap-2">
                      <div className={`p-4 rounded-2xl border ${isSecret ? 'bg-accent-purple/10 border-accent-purple/30' : 'bg-accent-cyan/10 border-accent-cyan/30'}`}>
                        {lastRoundMoves.p ? <MoveIcon move={lastRoundMoves.p} size={48} /> : <Lock size={40} className="text-white/10" />}
                      </div>
                      <span className="text-[10px] font-black uppercase font-mono text-foreground">YOU</span>
                    </div>
                    <div className="text-2xl font-black italic text-white/20 self-center">VS</div>
                    <div className="flex flex-col items-center gap-2">
                      <div className={`p-4 rounded-2xl border ${opponentIsSecret ? 'bg-accent-purple/10 border-accent-purple/30' : 'bg-accent-crimson/10 border-accent-crimson/30'}`}>
                        {lastRoundMoves.o ? <MoveIcon move={lastRoundMoves.o} size={48} /> : <Lock size={40} className="text-white/10" />}
                      </div>
                      <span className="text-[10px] font-black uppercase font-mono text-foreground">OPPONENT</span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 mb-8 bg-black/40 p-4 rounded-xl border border-white/5 font-mono text-[10px]">
                    <div className="flex justify-between items-center"><span className="text-foreground uppercase opacity-70">You:</span><span className={`font-black ${history[history.length-1]?.playerVPGain >= 0 ? 'text-accent-cyan' : 'text-accent-crimson'}`}>{history[history.length-1]?.playerVPGain > 0 ? `+${history[history.length-1]?.playerVPGain}` : history[history.length-1]?.playerVPGain} VP</span></div>
                    <div className="flex justify-between items-center"><span className="text-foreground uppercase opacity-70">{opponent.name}:</span><span className={`font-black ${history[history.length-1]?.opponentVPGain >= 0 ? 'text-accent-cyan' : 'text-accent-crimson'}`}>{history[history.length-1]?.opponentVPGain > 0 ? `+${history[history.length-1]?.opponentVPGain}` : history[history.length-1]?.opponentVPGain} VP</span></div>
                  </div>
                  <button onClick={handleNextRoundClick} disabled={gameMode === 'MULTI' && isReadyNext} className="w-full py-4 bg-white text-slate-900 hover:bg-slate-100 rounded-xl font-black text-sm uppercase tracking-widest font-heading transition-all cursor-pointer border border-white/10 shadow-lg disabled:opacity-50">
                    {isReadyNext ? 'WAITING FOR PEER...' : (round < 3 ? 'READY FOR NEXT ROUND →' : 'SEE FINAL RESULTS →')}
                  </button>
                </div>
              </div>
            )}

            {battlePhase === 'DECIDE' && (
              <div className="absolute inset-x-0 bottom-4 z-30 flex justify-center animate-reveal">
                <div className="w-full max-w-lg bg-gradient-to-r from-[#1e1b4b]/95 to-[#312e81]/95 border border-accent-purple/50 rounded-3xl p-6 shadow-2xl relative overflow-hidden">
                  <div className="flex items-center gap-5"><div className="p-3 bg-accent-purple text-white rounded-xl shadow-lg"><AlertTriangle size={24} /></div><div><h3 className="font-black italic text-base md:text-lg uppercase tracking-tighter leading-none mb-1 font-heading text-white">OPPONENT CHOSE HIDDEN</h3><p className="text-[9px] text-purple-200 font-bold uppercase tracking-wider opacity-70 font-mono">BATTLE FOR +3 VP OR FOLD TO EVADE PENALTY?</p></div></div>
                  <div className="flex gap-4 mt-6"><button onClick={() => handleBattleAction('FOLD')} className="flex-1 py-4 bg-slate-900 border border-slate-700 hover:bg-slate-800 rounded-xl font-black text-xs uppercase tracking-[0.2em] transition-all cursor-pointer text-white font-heading">FOLD</button><button onClick={() => handleBattleAction('BATTLE')} className="flex-1 py-4 bg-accent-purple hover:bg-indigo-600 rounded-xl font-black text-xs uppercase tracking-[0.2em] shadow-xl shadow-accent-purple/20 active:scale-[0.98] transition-all cursor-pointer text-white font-heading">BATTLE</button></div>
                </div>
              </div>
            )}

            {(isZkpGenerating || (battlePhase === 'WAITING_OPPONENT') || (battlePhase === 'WAITING_NEXT_ROUND')) && (
              <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-background/80 rounded-[3rem] overflow-hidden backdrop-blur-xl border border-white/5">
                <div className="zkp-scan-line"></div>
                <div className="relative mb-6"><RefreshCw className="w-14 h-14 text-accent-cyan animate-spin opacity-50" /><div className="absolute inset-0 flex items-center justify-center">{isZkpGenerating ? <Shield size={24} className="text-accent-cyan" /> : <Wifi size={24} className="text-accent-cyan" />}</div></div>
                <p className="font-black tracking-[0.4em] text-accent-cyan text-lg italic uppercase font-heading">{isZkpGenerating ? 'GENERATING ZKP' : battlePhase === 'WAITING_OPPONENT' ? (opponentCommitted ? 'AWAITING DECISION' : 'AWAITING PEER') : 'SYNCING DATA'}</p>
                <p className="text-[9px] text-foreground mt-2 tracking-widest uppercase font-black font-mono opacity-80">{isZkpGenerating ? 'Constructing Shielded Proof...' : 'Please hold for channel synchronization'}</p>
              </div>
            )}
          </div>

          <div className="flex flex-col mt-4">
             <div className="flex justify-between items-end mb-4 px-2">
              <div className="flex flex-col gap-1"><span className="text-[8px] font-black text-accent-cyan tracking-[0.2em] uppercase font-mono flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-accent-cyan animate-pulse"></span> OPERATIVE</span><span className="text-xl font-black italic truncate text-accent-cyan uppercase tracking-tighter font-heading">{player.name}</span></div>
              <div className="flex p-0.5 bg-black/40 rounded-xl border border-white/5 backdrop-blur-sm mx-4"><button onClick={() => setIsSecret(false)} className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-[9px] font-black transition-all cursor-pointer font-heading ${!isSecret ? 'bg-accent-cyan text-slate-900 shadow-lg' : 'text-foreground opacity-70'}`}><Eye size={12}/> PUBLIC</button><button onClick={() => setIsSecret(true)} className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-[9px] font-black transition-all cursor-pointer font-heading ${isSecret ? 'bg-accent-purple text-white shadow-lg shadow-accent-purple/20' : 'text-foreground opacity-70'}`}><Lock size={12}/> HIDDEN</button></div>
              <div className="text-right"><span className="text-[8px] font-black text-foreground tracking-[0.2em] uppercase font-mono block mb-1 opacity-70">SCORE</span><span className="text-3xl font-black text-white font-heading">{player.vp} <span className="text-[10px] uppercase opacity-50 font-mono">VP</span></span></div>
            </div>
            <div className="flex gap-4 items-center">
              <div className="flex-1 flex gap-3">
                {player.hand.map((move, i) => {
                  const isSelected = selectedMove === move;
                  return ( <button key={i} onClick={() => setSelectedMove(move)} disabled={battlePhase !== 'SELECT'} className={`flex-1 h-32 rounded-2xl flex flex-col items-center justify-center transition-all relative overflow-hidden group border-2 ${isSelected ? (isSecret ? 'border-accent-purple bg-accent-purple/20 shadow-[0_0_20px_rgba(124,58,237,0.3)]' : 'border-accent-cyan bg-accent-cyan/10 shadow-[0_0_20px_rgba(6,182,212,0.2)]') : 'bg-slate-800/40 border-white/5 hover:border-white/20 active:scale-95 disabled:opacity-30'} ${move === 'Loser' ? 'pulse-loser' : ''}`}><div className={`mb-3 transition-transform group-hover:scale-110 ${move === 'Loser' ? 'text-accent-crimson' : isSelected ? (isSecret ? 'text-accent-purple' : 'text-accent-cyan') : 'text-slate-400'}`}><MoveIcon move={move} size={32} /></div><span className="text-[9px] font-black uppercase tracking-widest font-mono text-white">{move}</span></button> );
                })}
              </div>
              <button disabled={!selectedMove || battlePhase !== 'SELECT'} onClick={handleCommitMove} className={`w-32 md:w-40 h-32 rounded-2xl font-black text-lg tracking-[0.1em] shadow-2xl active:scale-[0.98] transition-all italic text-slate-900 uppercase disabled:opacity-30 disabled:grayscale cursor-pointer font-heading leading-tight ${isSecret ? 'bg-accent-purple text-white hover:bg-indigo-500' : 'bg-accent-cyan hover:bg-cyan-400'}`}>{isSecret ? 'COMMIT (HIDDEN)' : 'COMMIT MOVE'}</button>
            </div>
          </div>
        </div>
      )}

      {gameState === 'RESULT' && (
        <div className="flex flex-col items-center justify-start min-h-screen p-6 md:p-10 overflow-y-auto animate-in zoom-in duration-700 bg-background relative">
           <div className="fixed top-0 left-0 w-full h-full -z-10 opacity-40 pointer-events-none">
            <div className={`absolute top-[-10%] left-[-10%] w-[60%] h-[60%] rounded-full blur-[180px] ${player.vp > opponent.vp ? 'bg-accent-cyan/20' : player.vp < opponent.vp ? 'bg-accent-crimson/20' : 'bg-slate-600/20'}`}></div>
          </div>
          <div className="w-full max-w-4xl text-center mb-10">
            <div className={`inline-block p-8 md:p-12 rounded-[3.5rem] mb-10 cyber-panel border-2 ${player.vp > opponent.vp ? 'border-accent-cyan shadow-[0_0_80px_rgba(6,182,212,0.2)]' : player.vp < opponent.vp ? 'border-accent-crimson shadow-[0_0_80px_rgba(225,29,72,0.15)]' : 'border-slate-500'}`}><Trophy className={`w-28 h-28 md:w-40 md:h-28 ${player.vp > opponent.vp ? 'text-accent-cyan' : player.vp < opponent.vp ? 'text-accent-crimson' : 'text-slate-500'}`} /></div>
            <h1 className="text-7xl md:text-[8rem] font-black italic tracking-tighter leading-none mb-6 font-heading text-white">{player.vp > opponent.vp ? 'VICTORY' : player.vp < opponent.vp ? 'DEFEAT' : 'DRAW'}{isOnChainMode && <span className="inline-block text-xl ml-4 font-mono vertical-middle align-middle opacity-50 text-foreground">⛓</span>}</h1>
            <div className="flex justify-center items-center gap-10 md:gap-20 bg-slate-900/60 backdrop-blur-xl p-8 rounded-[2.5rem] border border-white/5 max-w-2xl mx-auto shadow-2xl relative overflow-hidden"><div className="absolute inset-0 bg-gradient-to-r from-accent-cyan/5 via-transparent to-accent-crimson/5"></div><div className="text-center relative z-10"><p className="text-[10px] text-accent-cyan font-black mb-2 tracking-[0.4em] uppercase font-mono">{player.name}</p><p className="text-6xl md:text-7xl font-black italic font-heading text-white">{player.vp}</p></div><div className="text-4xl md:text-5xl font-black text-white/5 font-heading">VS</div><div className="text-center relative z-10"><p className="text-[10px] text-accent-crimson font-black mb-2 tracking-[0.4em] uppercase font-mono">{opponent.name}</p><p className="text-6xl md:text-7xl font-black italic font-heading text-white">{opponent.vp}</p></div></div>
          </div>
          {player.vp > opponent.vp && (
            <div className="w-full max-w-4xl mb-12 animate-reveal"><div className="cyber-panel p-8 md:p-10 rounded-[2.5rem] border-accent-cyan/30 flex flex-col items-center justify-center relative overflow-hidden"><div className="absolute -top-12 -left-12 w-32 h-32 bg-accent-cyan/10 blur-[40px] rounded-full"></div>{!claimSuccess ? ( <> <button disabled={isClaiming} onClick={handleClaimReward} className="group w-full max-w-md py-6 bg-accent-cyan text-slate-900 rounded-2xl font-black text-xl flex items-center justify-center gap-4 shadow-[0_0_30px_rgba(6,182,212,0.3)] active:scale-[0.98] transition-all uppercase tracking-widest font-heading cursor-pointer hover:bg-cyan-300">{isClaiming ? <RefreshCw className="animate-spin" size={24} /> : <Coins size={24} />} {isClaiming ? 'PROCESSING...' : `Claim Shielded YTTM`}</button> <p className="mt-5 text-[10px] text-foreground font-bold uppercase tracking-[0.3em] flex items-center gap-2 font-mono opacity-80"><Lock size={12} className="text-accent-purple" /> 🔐 Shielded — 第三者には非公開 (ZKP)</p> </> ) : ( <div className="text-center animate-reveal"><div className="inline-flex p-4 bg-green-500/10 rounded-full text-green-400 mb-4 border border-green-500/20"><CheckCircle size={40} /></div><h3 className="text-2xl font-black italic uppercase tracking-tighter font-heading text-white">REWARD CLAIMED</h3><p className="text-xs text-foreground font-bold uppercase tracking-widest mt-2 font-mono">10 YTTM を受け取りました 🔐 / 残高: {player.balance} YTTM</p></div> )}</div></div>
          )}
          <div className="w-full max-w-4xl grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">{history.map((h, i) => ( <div key={i} className="cyber-panel p-6 rounded-3xl border-white/5 relative overflow-hidden flex flex-col group hover:border-white/20 transition-all"><div className="flex justify-between items-center mb-6"><span className="text-[10px] font-black text-foreground uppercase tracking-widest font-mono opacity-70">ROUND {h.round}</span><span className={`text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-widest font-heading ${h.result === 'WIN' ? 'bg-accent-cyan/10 text-accent-cyan border border-accent-cyan/20' : h.result === 'LOSS' ? 'bg-accent-crimson/10 text-accent-crimson border border-accent-crimson/20' : h.result === 'FOLDED' ? 'bg-slate-800 text-foreground border border-white/5 opacity-80' : 'bg-white/5 text-white border border-white/10'}`}>{h.result}</span></div><div className="flex justify-between items-center mb-6 px-2"><div className="flex flex-col items-center gap-2"><div className={`p-3 rounded-xl border ${h.playerIsSecret ? 'bg-accent-purple/10 border-accent-purple/30 text-accent-purple' : 'bg-accent-cyan/5 border-accent-cyan/20 text-accent-cyan'}`}>{h.playerIsSecret ? <Lock size={24} /> : <MoveIcon move={h.playerMove} size={24} />}</div><span className="text-[8px] font-black uppercase text-foreground font-mono tracking-tighter opacity-80">{h.playerIsSecret ? 'HIDDEN' : h.playerMove}</span></div><span className="text-lg font-black text-white/10 font-heading italic">VS</span><div className="flex flex-col items-center gap-2"><div className={`p-3 rounded-xl border ${h.opponentIsSecret ? 'bg-accent-purple/10 border-accent-purple/30 text-accent-purple' : 'bg-accent-crimson/5 border-accent-crimson/20 text-accent-crimson'}`}>{h.opponentIsSecret ? <Lock size={24} /> : <MoveIcon move={h.opponentMove} size={24} />}</div><span className="text-[8px] font-black uppercase text-foreground font-mono tracking-tighter opacity-80">{h.opponentIsSecret ? 'HIDDEN' : h.opponentMove}</span></div></div><div className="mt-auto pt-6 border-t border-white/5 flex justify-between items-center font-mono text-[9px] font-black tracking-wider uppercase"><span className={h.playerVPGain > 0 ? 'text-accent-cyan' : h.playerVPGain < 0 ? 'text-accent-crimson' : 'text-foreground opacity-70'}>You {h.playerVPGain > 0 ? `+${h.playerVPGain}` : h.playerVPGain} VP</span><span className={h.opponentVPGain > 0 ? 'text-accent-cyan' : h.opponentVPGain < 0 ? 'text-accent-crimson' : 'text-foreground opacity-70'}>{opponent.name} {h.opponentVPGain > 0 ? `+${h.opponentVPGain}` : h.opponentVPGain} VP</span></div></div> ))}</div>
          {isOnChainMode && (
            <div className="w-full max-w-4xl cyber-panel rounded-[2.5rem] border-yellow-500/20 overflow-hidden mb-12">
              <button onClick={() => setShowOnChainPanel(!showOnChainPanel)} className="w-full p-8 flex justify-between items-center hover:bg-white/5 transition-colors cursor-pointer"><div className="flex items-center gap-4 text-yellow-500 font-heading"><Zap size={24} /><h3 className="text-xl font-black italic uppercase tracking-tighter">ON-CHAIN DATA LOG</h3></div>{showOnChainPanel ? <ChevronUp className="text-foreground" /> : <ChevronDown className="text-foreground" />}</button>
              {showOnChainPanel && ( <div className="p-8 pt-0 animate-in slide-in-from-top-4"><div className="space-y-4 font-mono text-[10px] bg-black/40 p-6 rounded-2xl border border-white/5"><div className="flex justify-between border-b border-white/5 pb-2"><span className="text-foreground uppercase opacity-70">Contract Address</span><span className="text-yellow-400 underline italic">midnight_contract_92x7...a290</span></div><div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-4"><div className="space-y-3"><p className="text-accent-cyan font-black border-b border-accent-cyan/20 pb-1 uppercase tracking-widest">YOUR STREAM</p>{history.map((h, i) => ( <div key={i} className="flex flex-col gap-1"><span className="text-foreground text-[8px] uppercase tracking-tighter opacity-60">Round {h.round} Deployment</span><span className="text-foreground truncate block bg-white/5 p-1.5 rounded">{h.txHash}</span></div> ))}</div>{gameMode === 'MULTI' && ( <div className="space-y-3"><p className="text-accent-crimson font-black border-b border-accent-crimson/20 pb-1 uppercase tracking-widest">OPPONENT STREAM</p>{opponentTxHashes.map((hash, i) => ( <div key={i} className="flex flex-col gap-1"><span className="text-foreground text-[8px] uppercase tracking-tighter opacity-60">Peer Verification TX</span><span className="text-foreground truncate block bg-white/5 p-1.5 rounded">{hash}</span></div> ))}</div> )}</div><div className="mt-8 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-xl text-yellow-500/70 italic text-center font-mono text-[9px] tracking-wide uppercase">DEMO: Midnight Preprod Simulated Environment. Real ZKP proofs generated locally.</div></div></div> )}
            </div>
          )}
          <button onClick={() => { setGameState('MODE_SELECTION'); setHistory([]); setOpponentTxHashes([]); setRound(1); setClaimSuccess(false); if (gameMode === 'MULTI') multiplayerWS.disconnect(); }} className="w-full max-w-md py-6 text-foreground hover:text-white transition-all underline underline-offset-8 text-[10px] font-black tracking-[0.4em] uppercase mb-20 cursor-pointer font-heading opacity-70 hover:opacity-100">← Return to Lobby</button>
        </div>
      )}
    </main>
  );
}
