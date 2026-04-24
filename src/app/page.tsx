'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Shield, Lock, Unlock, Zap, Trophy, User, RefreshCw, 
  AlertTriangle, Hand, Scissors, Grab, Skull, Coins, CheckCircle, Users, Wifi,
  ChevronDown, ChevronUp, Wallet, Copy
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
  playerAction: 'BATTLE' | 'FOLD';
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
  balance: number;
}

const MoveIcon = ({ move, size = 24 }: { move: Move, size?: number }) => {
  switch (move) {
    case 'Rock': return <Grab size={size} />;
    case 'Scissors': return <Scissors size={size} />;
    case 'Paper': return <Hand size={size} />;
    case 'Loser': return <Skull size={size} />;
  }
};

const WalletBar = ({ address, balance }: { address: string, balance: number }) => (
  <div className="w-full max-w-2xl bg-slate-900/50 backdrop-blur-md border border-white/10 p-4 rounded-2xl flex justify-between items-center mb-4">
    <div className="flex items-center gap-3">
      <div className="p-2 bg-purple-500/20 rounded-lg text-purple-400"><Wallet size={16} /></div>
      <div className="text-left">
        <p className="text-[9px] text-slate-500 font-black uppercase tracking-wider">ADDRESS</p>
        <p className="text-[10px] font-mono text-slate-300">{address.slice(0, 10)}...{address.slice(-6)}</p>
      </div>
    </div>
    <div className="flex items-center gap-4">
      <div className="text-right">
        <p className="text-[9px] text-slate-500 font-black uppercase tracking-wider">BALANCE</p>
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-black italic text-white">{balance} YTTM</span>
          <span className="bg-purple-500/20 text-purple-400 text-[7px] font-black px-1 py-0.5 rounded border border-purple-500/30">🔐 SHIELDED</span>
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
  const [player, setPlayer] = useState<PlayerState>({ name: '', address: '', vp: 0, hand: [], balance: 0 });
  const [opponent, setOpponent] = useState<PlayerState>({ name: '', address: '', vp: 0, hand: [], balance: 0 });
  
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

  // Multiplayer State
  const [roomId, setRoomId] = useState('');
  const [opponentCommitted, setOpponentCommitted] = useState(false);
  const [opponentDecision, setOpponentDecision] = useState<'battle' | 'fold' | null>(null);
  const [opponentReadyNext, setOpponentReadyNext] = useState(false);
  const [opponentTxHashes, setOpponentTxHashes] = useState<string[]>([]);
  
  const localDecisionRef = useRef<'battle' | 'fold' | null>(null);
  const opponentStateRef = useRef({
    committed: false,
    decision: null as 'battle' | 'fold' | null,
    revealedMove: null as Move | null,
    claimedOutcome: null as 'WIN' | 'LOSS' | 'DRAW' | null,
    readyNext: false
  });

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
    pAction: 'BATTLE' | 'FOLD',
    oAction: 'battle' | 'fold' = 'battle'
  ) => {
    let pGain = 0;
    let oGain = 0;
    let result: RoundResult = null;

    if (pAction === 'FOLD' || oAction === 'fold') {
      return { pGain: 0, oGain: 0, result: 'FOLDED' as RoundResult };
    }

    const win = (pMove === 'Rock' && oMove === 'Scissors') || 
                (pMove === 'Paper' && oMove === 'Rock') ||
                (pMove === 'Scissors' && oMove === 'Paper') ||
                (oMove === 'Loser' && pMove !== 'Loser');
    
    if (pMove === oMove) {
      result = 'DRAW';
      pGain = 1;
      oGain = 1;
    } else if (pMove === 'Loser' || !win) { // Player Lost
      result = 'LOSS';
      pGain = pSecret ? -1 : 0;
      oGain = oSecret ? 3 : 1;
    } else { // Player Won
      result = 'WIN';
      pGain = pSecret ? 3 : 1;
      oGain = oSecret ? -1 : 0;
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
    localDecisionRef.current = null;
    opponentStateRef.current = { 
      committed: false, decision: null, revealedMove: null, claimedOutcome: null, readyNext: false 
    };
  }, []);

  const goToNextRound = useCallback(() => {
    if (round < 3) {
      setRound(r => r + 1);
      resetRoundStates();
    } else {
      setGameState('RESULT');
      if (gameMode === 'MULTI') {
        setTimeout(() => multiplayerWS.disconnect(), 100);
      }
    }
  }, [round, resetRoundStates, gameMode]);

  const finalizeResolution = useCallback((action: 'BATTLE' | 'FOLD', oMove: Move) => {
    const oAction = gameMode === 'MULTI' ? (opponentStateRef.current.decision || 'battle') : 'battle';
    let { pGain, oGain, result } = calculateVP(selectedMove!, oMove, isSecret, opponentIsSecret, action, oAction);

    // In Multi mode, if opponent was secret, we MUST respect their claimed outcome in this dummy phase
    if (gameMode === 'MULTI' && opponentIsSecret && opponentStateRef.current.claimedOutcome && result !== 'FOLDED') {
      const outcome = opponentStateRef.current.claimedOutcome;
      if (outcome === 'WIN') { // Opponent says they won
        result = 'LOSS';
        if (isSecret) { pGain = -1; oGain = 3; }
        else { pGain = 0; oGain = 1; }
      } else if (outcome === 'LOSS') { // Opponent says they lost
        result = 'WIN';
        if (isSecret) { pGain = 3; oGain = -1; }
        else { pGain = 1; oGain = -1; } 
      } else {
        result = 'DRAW';
        pGain = 1; oGain = 1;
      }
    }
    
    setRoundResult(result);
    
    const roundData: RoundHistory = {
      round,
      playerMove: selectedMove!,
      opponentMove: oMove,
      playerIsSecret: isSecret,
      opponentIsSecret,
      playerAction: action,
      result,
      playerVPGain: pGain,
      opponentVPGain: oGain,
      txHash: isOnChainMode ? generateDummyTxHash() : undefined
    };

    setHistory(prev => [...prev, roundData]);

    setPlayer(prev => {
      const newHand = [...prev.hand];
      const idx = newHand.findIndex(m => m === selectedMove);
      if (idx !== -1) newHand.splice(idx, 1);
      return { ...prev, vp: prev.vp + pGain, hand: newHand };
    });
    
    setOpponent(prev => ({ 
      ...prev, 
      vp: prev.vp + oGain, 
      hand: prev.hand.slice(1) 
    }));
    
    setTimeout(() => {
      if (gameMode === 'SINGLE') {
        goToNextRound();
      } else {
        setBattlePhase('WAITING_NEXT_ROUND');
        multiplayerWS.send({ type: 'READY_NEXT_ROUND' });
        // The transition to the next round will be handled by the 'ROUND_START' message listener
      }
    }, 2500);
  }, [selectedMove, isSecret, opponentIsSecret, round, isOnChainMode, calculateVP, gameMode, goToNextRound]);

  const processResolution = useCallback((action: 'BATTLE' | 'FOLD') => {
    if (!selectedMove) return;
    setBattlePhase('RESOLUTION');
    localDecisionRef.current = action;

    if (gameMode === 'SINGLE') {
      finalizeResolution(action, opponent.hand[0]);
    } else {
      // Multiplayer Reveal Flow
      if (isSecret) {
        const win = (selectedMove === 'Rock' && opponent.hand[0] === 'Scissors') || 
                    (selectedMove === 'Paper' && opponent.hand[0] === 'Rock') ||
                    (selectedMove === 'Scissors' && opponent.hand[0] === 'Paper');
        const outcome = selectedMove === opponent.hand[0] ? 'DRAW' : win ? 'WIN' : 'LOSS';
        multiplayerWS.send({ type: 'REVEAL_HIDDEN', claimedOutcome: outcome });
      } else {
        multiplayerWS.send({ type: 'REVEAL_PUBLIC', cardType: selectedMove });
      }

      // Wait for opponent decision & reveal
      const checkOpponentData = setInterval(() => {
        const hasDecision = (opponentIsSecret || isSecret) ? !!opponentStateRef.current.decision : true;
        const hasReveal = opponentStateRef.current.revealedMove || opponentStateRef.current.claimedOutcome;
        
        if (hasDecision && hasReveal) {
          clearInterval(checkOpponentData);
          finalizeResolution(action, opponentStateRef.current.revealedMove || opponent.hand[0]);
        }
      }, 500);
    }
  }, [selectedMove, gameMode, isSecret, opponentIsSecret, opponent.hand, finalizeResolution]);

  const handleBattleAction = useCallback((action: 'BATTLE' | 'FOLD') => {
    if (gameMode === 'MULTI') {
      multiplayerWS.send({ type: 'PLAYER_DECISION', decision: action === 'BATTLE' ? 'battle' : 'fold' });
    }

    if (action === 'BATTLE' && isSecret) {
      setIsZkpGenerating(true);
      setTimeout(() => {
        setIsZkpGenerating(false);
        processResolution(action);
      }, 1500);
    } else {
      processResolution(action);
    }
  }, [isSecret, processResolution, gameMode]);

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
      
      setPlayer(prev => ({ 
        ...prev, 
        name: playerName, 
        address: account?.address || 'me', 
        vp: 0, 
        hand: pMoves,
        balance: prev.balance || 25
      }));

      setOpponent({ 
        name: msg.opponent.name, 
        address: msg.opponent.address, 
        vp: 0, 
        hand: oMoves,
        balance: 0 
      });
    };

    const onOpponentCommitted = (msg: Extract<ServerMsg, { type: 'OPPONENT_COMMITTED' }>) => {
      setOpponentIsSecret(msg.mode === 'hidden');
      setOpponentCommitted(true);
      opponentStateRef.current.committed = true;
    };

    const onBothCommitted = () => {
      if (battlePhase === 'WAITING_OPPONENT' || battlePhase === 'SELECT') {
        if (opponentIsSecret) {
          // I need to decide, or both need to decide
          setBattlePhase('DECIDE');
        } else if (!isSecret) {
          // Both are public
          handleBattleAction('BATTLE');
        }
        // If I am secret and opponent is public, I stay in WAITING_OPPONENT
        // and wait for onOpponentDecision to trigger handleBattleAction('BATTLE').
      }
    };

    const onOpponentDecision = (msg: Extract<ServerMsg, { type: 'OPPONENT_DECISION' }>) => {
      setOpponentDecision(msg.decision);
      opponentStateRef.current.decision = msg.decision;

      // If I am secret and the public opponent just made a decision, I proceed
      if (isSecret && !opponentIsSecret && battlePhase === 'WAITING_OPPONENT') {
        handleBattleAction('BATTLE');
      }
    };

    const onOpponentRevealedPublic = (msg: Extract<ServerMsg, { type: 'OPPONENT_REVEALED_PUBLIC' }>) => {
      const move = msg.cardType as Move;
      opponentStateRef.current.revealedMove = move;
    };

    const onOpponentRevealedHidden = (msg: Extract<ServerMsg, { type: 'OPPONENT_REVEALED_HIDDEN' }>) => {
      opponentStateRef.current.claimedOutcome = msg.claimedOutcome as 'WIN' | 'LOSS' | 'DRAW';
    };

    const onOpponentReadyNext = () => {
      setOpponentReadyNext(true);
      opponentStateRef.current.readyNext = true;
    };

    const onRoundStart = (msg: Extract<ServerMsg, { type: 'ROUND_START' }>) => {
      console.log('Round Start received:', msg.round);
      setRound(msg.round + 1);
      resetRoundStates();
      // Ensure UI reflects the fresh state
      setBattlePhase('SELECT');
    };

    const onOpponentLeft = () => {
      if (gameState === 'RESULT') return;
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
  }, [gameMode, battlePhase, opponentIsSecret, isSecret, handleBattleAction, playerName, account, gameState, resetRoundStates]);

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
          
          setPlayer(prev => ({ 
            ...prev, 
            name: playerName, 
            address: account?.address || 'me', 
            vp: 0, 
            hand: pMoves,
            balance: prev.balance || 25
          }));

          setOpponent({ 
            name: 'ENFORCER_v4', 
            address: 'mn_addr_test_opp_99x', 
            vp: 0, 
            hand: oMoves,
            balance: 0 
          });
        }, 800);
      }, 800);
    } else {
      // Multiplayer logic
      try {
        await multiplayerWS.connect(WS_URL);
        const rId = existingRoomId || generateRoomId();
        setRoomId(rId);
        multiplayerWS.send({
          type: 'JOIN_ROOM',
          roomId: rId,
          name: playerName,
          address: account?.address || 'me'
        });
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
    
    if (gameMode === 'SINGLE') {
      const opSecret = Math.random() > 0.4;
      setOpponentIsSecret(opSecret);
      if (opSecret) setBattlePhase('DECIDE');
      else handleBattleAction('BATTLE');
    } else {
      // Connection check
      multiplayerWS.send({ type: 'PING' }); 
      
      setBattlePhase('WAITING_OPPONENT');
      multiplayerWS.send({
        type: 'COMMIT_MOVE',
        commitment: '0xmockedhash',
        mode: isSecret ? 'hidden' : 'public'
      });
    }
  };

  const handleClaimReward = () => {
    setIsClaiming(true);
    setTimeout(() => {
      setIsClaiming(false);
      setClaimSuccess(true);
      setPlayer(prev => ({ ...prev, balance: prev.balance + YTTM_REWARD }));
      if (gameMode === 'MULTI') {
        multiplayerWS.send({ type: 'ONCHAIN_TX', action: 'claimReward', txHash: generateDummyTxHash() });
      }
    }, 2000);
  };

  return (
    <main className="min-h-screen bg-[#020617] text-white font-sans overflow-x-hidden selection:bg-purple-500/30">
      {/* Background FX */}
      <div className="fixed top-0 left-0 w-full h-full -z-10 opacity-40">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-purple-600/20 rounded-full blur-[160px]"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-cyan-600/20 rounded-full blur-[160px]"></div>
        <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-10"></div>
      </div>
      
      {/* 1. Onboarding */}
      {gameState === 'ONBOARDING' && (
        <div className="flex flex-col items-center justify-center min-h-screen p-4 animate-in fade-in duration-1000">
          <div className="bg-slate-900/40 backdrop-blur-3xl p-12 rounded-[3rem] w-full max-w-md text-center border border-white/10 shadow-2xl relative overflow-hidden">
            <div className="absolute -top-24 -right-24 w-48 h-48 bg-purple-500/20 blur-[60px] rounded-full"></div>
            <div className="bg-gradient-to-br from-purple-500 to-indigo-600 p-6 rounded-[2rem] inline-block mb-10 shadow-2xl relative z-10"><Shield size={64} /></div>
            <h1 className="text-5xl font-black mb-4 italic tracking-tighter text-white relative z-10">LOSER&apos;S GAMBIT</h1>
            <p className="text-cyan-400 mb-12 text-[10px] tracking-[0.5em] font-black uppercase relative z-10">Midnight ZKP Strategy</p>
            
            <div className="space-y-4 relative z-10">
              <button 
                onClick={() => handleConnectWallet()} 
                disabled={!isLaceDetected}
                className="w-full py-5 bg-white text-slate-900 rounded-2xl font-black text-lg flex items-center justify-center gap-3 active:scale-[0.98] transition-all disabled:opacity-30 disabled:grayscale"
              >
                <span className="w-6 h-6 rounded-full bg-purple-600 flex items-center justify-center text-[8px] text-white font-bold">L</span>
                CONNECT LACE WALLET
              </button>
              <button 
                onClick={() => handleConnectWallet()} 
                className="w-full py-5 bg-slate-800 border border-white/10 hover:bg-slate-700 rounded-2xl font-black text-lg active:scale-[0.98] transition-all"
              >
                CONNECT WALLET (DEMO)
              </button>
            </div>
            
            <div className="mt-12 flex items-center justify-center gap-2 text-slate-500 font-bold text-[9px] uppercase tracking-widest">
              <Lock size={12} /> ZKP-Shielded · Midnight Preprod · YTTM Token
            </div>
          </div>
        </div>
      )}

      {/* 2. Mode Selection */}
      {gameState === 'MODE_SELECTION' && (
        <div className="flex flex-col items-center justify-center min-h-screen p-4 animate-in zoom-in duration-500">
          {account && <WalletBar address={account.address} balance={player.balance} />}
          
          <div className="w-full max-w-2xl bg-slate-900/40 backdrop-blur-xl p-10 rounded-[3rem] border border-white/10 shadow-2xl">
            <div className="flex items-center gap-6 mb-10">
              <div className="p-4 bg-cyan-500/20 border border-cyan-500/30 rounded-2xl text-cyan-400"><User size={24} /></div>
              <div className="flex-1">
                <span className="text-[9px] text-slate-500 font-black uppercase tracking-[0.2em] block mb-1">OPERATIVE NAME</span>
                <input 
                  type="text" 
                  placeholder="CODENAME..." 
                  value={playerName}
                  onChange={(e) => setPlayerName(e.target.value)}
                  className="bg-transparent text-2xl font-black italic text-white outline-none w-full border-b border-white/10 focus:border-cyan-400 transition-all placeholder:text-slate-800"
                />
              </div>
            </div>

            <div className="flex items-center justify-between p-4 bg-black/30 rounded-2xl border border-white/5 mb-8">
              <div className="flex items-center gap-3">
                <Zap size={18} className={isOnChainMode ? "text-yellow-400" : "text-slate-600"} />
                <div>
                  <p className="text-[10px] font-black uppercase tracking-tighter">ON-CHAIN MODE</p>
                  <p className="text-[8px] text-slate-500 font-bold uppercase tracking-wider">{isOnChainMode ? "SIMULATED TRANSACTION FLOW" : "OFF-CHAIN FAST PLAY"}</p>
                </div>
              </div>
              <button 
                onClick={() => setIsOnChainMode(!isOnChainMode)}
                className={`w-12 h-7 rounded-full p-1 transition-colors ${isOnChainMode ? "bg-yellow-500" : "bg-slate-700"}`}
              >
                <div className={`w-5 h-5 bg-white rounded-full transition-transform ${isOnChainMode ? "translate-x-5" : "translate-x-0"}`}></div>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <button 
                disabled={!playerName}
                onClick={() => handleModeSelect('SINGLE')} 
                className="group relative bg-slate-800/40 p-8 rounded-3xl border border-white/10 hover:border-cyan-500/50 hover:bg-cyan-500/5 transition-all flex flex-col items-center disabled:opacity-20"
              >
                <div className="p-4 bg-cyan-500/20 rounded-xl mb-4 group-hover:scale-110 transition-transform"><User size={28} className="text-cyan-400" /></div>
                <h3 className="text-xl font-black italic uppercase tracking-tighter">SOLO OPERATIVE</h3>
                <p className="text-[9px] text-slate-500 font-bold uppercase tracking-[0.2em] mt-2">VS ENFORCER AI</p>
                {isOnChainMode && <span className="absolute top-4 right-4 bg-yellow-500/20 text-yellow-500 text-[7px] font-black px-1.5 py-0.5 rounded border border-yellow-500/30">⛓ ON-CHAIN</span>}
              </button>
              
              <button 
                disabled={!playerName}
                onClick={() => handleModeSelect('MULTI')} 
                className="group relative bg-slate-800/40 p-8 rounded-3xl border border-white/10 hover:border-purple-500/50 hover:bg-purple-500/5 transition-all flex flex-col items-center disabled:opacity-20"
              >
                <div className="p-4 bg-purple-500/20 rounded-xl mb-4 group-hover:scale-110 transition-transform"><Users size={28} className="text-purple-400" /></div>
                <h3 className="text-xl font-black italic uppercase tracking-tighter">MULTI-SYNC</h3>
                <p className="text-[9px] text-slate-500 font-bold uppercase tracking-[0.2em] mt-2">P2P REAL-TIME</p>
                <span className="mt-2 bg-slate-900 text-slate-500 text-[7px] font-black px-1.5 py-0.5 rounded">ONLINE</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2.5 Lobby */}
      {gameState === 'LOBBY' && (
        <div className="flex flex-col items-center justify-center min-h-screen p-4">
          <div className="w-full max-w-md animate-in slide-in-from-bottom-10 duration-500 text-white">
            <div className="bg-slate-900/80 backdrop-blur-xl p-12 rounded-[3rem] text-center border border-cyan-500/30 shadow-2xl">
              <h2 className="text-3xl font-black mb-10 italic uppercase tracking-tighter">ESTABLISH CHANNEL</h2>
              
              <div className="mb-8">
                <p className="text-[10px] text-slate-500 font-black uppercase tracking-[0.3em] mb-4">ENTER TARGET ROOM ID</p>
                <div className="relative">
                  <input 
                    type="text" 
                    placeholder="BATTLE-ID" 
                    value={roomId} 
                    onChange={(e) => setRoomId(e.target.value.toUpperCase())} 
                    className="w-full bg-black/50 border-2 border-slate-700 p-6 rounded-2xl text-center tracking-[0.4em] font-mono font-black text-2xl text-cyan-400 outline-none focus:border-cyan-400 transition-all" 
                  />
                  <button 
                    onClick={() => setRoomId(generateRoomId())}
                    className="absolute right-4 top-1/2 -translate-y-1/2 p-2 text-slate-500 hover:text-cyan-400 transition-colors"
                  >
                    <RefreshCw size={20} />
                  </button>
                </div>
              </div>

              <button 
                disabled={!roomId} 
                onClick={() => handleStartGame('MULTI', roomId)} 
                className="w-full py-6 bg-cyan-600 hover:bg-cyan-500 rounded-2xl font-black text-xl shadow-2xl active:scale-95 transition-all text-white uppercase tracking-widest disabled:opacity-30"
              >
                INITIALIZE SYNC
              </button>
              
              <button 
                onClick={() => setGameState('MODE_SELECTION')} 
                className="mt-8 text-slate-500 hover:text-white text-[10px] font-black uppercase tracking-[0.4em] transition-all"
              >
                ABORT MISSION
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. Matching */}
      {gameState === 'MATCHING' && (
        <div className="flex flex-col items-center justify-center min-h-screen">
          <div className="relative mb-12">
            <div className="w-40 h-40 rounded-full border-4 border-cyan-500/20 border-t-cyan-500 animate-spin"></div>
            <div className="absolute inset-0 flex items-center justify-center">
              <Wifi size={40} className={opponentFound ? "text-green-400" : "text-cyan-400 animate-pulse"} />
            </div>
          </div>
          
          <div className="text-center">
            <p className="text-4xl font-black italic tracking-tighter uppercase mb-4">{opponentFound ? 'READY TO BREACH' : 'LOCATING PEER'}</p>
            {gameMode === 'MULTI' && !opponentFound && (
              <div className="bg-slate-900/60 backdrop-blur-xl p-5 rounded-3xl border border-white/10 mb-6 max-w-sm mx-auto">
                <p className="text-[10px] text-slate-500 font-black uppercase tracking-[0.3em] mb-2">SHARE ROOM ID</p>
                <div className="flex items-center justify-center gap-4 bg-black/40 p-4 rounded-xl border border-white/5">
                  <span className="text-2xl font-mono font-black tracking-[0.4em] text-cyan-400">{roomId}</span>
                  <button 
                    onClick={() => {
                      navigator.clipboard.writeText(roomId);
                      alert('Room ID copied to clipboard!');
                    }}
                    className="p-2 bg-white/5 rounded-lg hover:bg-white/10 transition-colors"
                  >
                    <Copy size={16} />
                  </button>
                </div>
              </div>
            )}
            <p className="text-slate-500 font-bold tracking-[0.3em] uppercase text-[9px]">ESTABLISHING SECURE CHANNEL...</p>
          </div>
          
          {gameMode === 'MULTI' && (
            <button 
              onClick={() => {
                multiplayerWS.disconnect();
                setGameState('LOBBY');
              }}
              className="mt-8 text-rose-500 hover:text-rose-400 text-[10px] font-black uppercase tracking-[0.4em] transition-all"
            >
              CANCEL SYNC
            </button>
          )}
        </div>
      )}

      {/* 4. Battle Board */}
      {gameState === 'BATTLE' && (
        <div className="flex flex-col h-screen p-4 max-w-3xl mx-auto overflow-hidden">
          {/* Round Splash */}
          {roundResult && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#020617]/90 backdrop-blur-3xl animate-in fade-in duration-300">
              <div className="text-center">
                <h2 className={`text-[10rem] font-black italic tracking-tighter animate-in zoom-in duration-300 leading-none ${
                  roundResult === 'WIN' ? 'text-cyan-400' : 
                  roundResult === 'LOSS' ? 'text-rose-500' : 
                  roundResult === 'FOLDED' ? 'text-purple-500' : 'text-slate-300'
                }`}>
                  {roundResult}
                </h2>
                <p className="text-xl font-black tracking-[0.5em] text-white opacity-50 mt-4 uppercase">RESOLUTION COMPLETE</p>
              </div>
            </div>
          )}

          {/* Header - More compact */}
          <div className="grid grid-cols-2 gap-3 mb-2">
            <div className="bg-slate-900/80 backdrop-blur-xl p-3 rounded-2xl border border-rose-500/20 relative overflow-hidden">
              <div className="absolute top-0 right-0 p-2 opacity-5"><Skull size={24} /></div>
              <p className="text-[8px] font-black text-rose-500 tracking-[0.2em] uppercase mb-0.5 flex items-center gap-1.5">
                <span className={`w-1 h-1 rounded-full bg-rose-500 ${opponentCommitted ? '' : 'animate-pulse'}`}></span> 
                OPPONENT {opponentCommitted && <span className="text-[6px] bg-rose-500/20 px-1 py-0.5 rounded ml-1">COMMITTED</span>}
              </p>
              <div className="flex justify-between items-end">
                <span className="text-xl font-black italic truncate text-rose-500 uppercase tracking-tighter">{opponent.name}</span>
                <span className="text-2xl font-black text-rose-500">{opponent.vp} <span className="text-[10px] uppercase opacity-50">VP</span></span>
              </div>
            </div>
            <div className="bg-slate-900/80 backdrop-blur-xl p-3 rounded-2xl border border-cyan-500/20 relative overflow-hidden">
              <div className="absolute top-0 right-0 p-2 opacity-5"><User size={24} /></div>
              <p className="text-[8px] font-black text-cyan-500 tracking-[0.2em] uppercase mb-0.5 flex items-center gap-1.5">
                <span className="w-1 h-1 rounded-full bg-cyan-500 animate-pulse"></span> YOU
              </p>
              <div className="flex justify-between items-end">
                <span className="text-xl font-black italic truncate text-cyan-400 uppercase tracking-tighter">{player.name}</span>
                <span className="text-2xl font-black text-cyan-400">{player.vp} <span className="text-[10px] uppercase opacity-50">VP</span></span>
              </div>
            </div>
          </div>

          {/* Main Battle Area - More compact cards */}
          <div className="flex-1 flex flex-col items-center justify-center relative min-h-0">
            <div className="absolute top-1 flex gap-3">
              <div className="bg-white/5 px-4 py-1 rounded-full border border-white/10 font-black text-[9px] tracking-[0.4em] uppercase text-white/60">
                ROUND {round} / 3 {isOnChainMode && <span className="text-yellow-500 ml-1">⛓ ON-CHAIN</span>}
              </div>
              {gameMode === 'MULTI' && (
                <div className="bg-cyan-500/10 px-4 py-1 rounded-full border border-cyan-500/20 font-black text-[9px] tracking-[0.4em] uppercase text-cyan-400">
                  ID: {roomId}
                </div>
              )}
            </div>

            <div className="flex gap-8 items-center justify-center w-full transform scale-90">
              {/* Opponent Card Slot */}
              <div className={`w-36 h-56 rounded-[2rem] border-2 flex flex-col items-center justify-center transition-all duration-700 ${
                battlePhase === 'SELECT' ? 'bg-black/20 border-white/5 opacity-20 scale-90' : 
                opponentIsSecret ? 'bg-gradient-to-br from-[#1e1b4b] to-[#312e81] border-purple-500 shadow-[0_0_30px_rgba(124,58,237,0.3)] scale-110' : 
                'bg-slate-800 border-white/30 scale-110 shadow-2xl'
              }`}>
                {battlePhase !== 'SELECT' && (
                  <>
                    <div className={`p-5 rounded-[1.5rem] mb-3 ${opponentIsSecret ? 'bg-purple-500 text-white' : 'bg-slate-700 text-white'}`}>
                      {opponentIsSecret ? <Lock size={40} /> : <Unlock size={40} />}
                    </div>
                    <span className="text-[10px] font-black tracking-[0.3em] uppercase">{opponentIsSecret ? 'HIDDEN' : 'PUBLIC'}</span>
                  </>
                )}
              </div>

              <div className="text-4xl font-black italic text-white/10 tracking-tighter select-none">VS</div>

              {/* Player Card Slot */}
              <div className={`w-36 h-56 rounded-[2rem] border-2 flex flex-col items-center justify-center transition-all duration-700 ${
                !selectedMove ? 'bg-black/20 border-white/5 border-dashed opacity-30' : 
                isSecret ? 'bg-gradient-to-br from-purple-600 to-indigo-800 border-purple-300 shadow-[0_0_30px_rgba(168,85,247,0.3)] scale-110' : 
                'bg-gradient-to-br from-cyan-500 to-blue-700 border-white shadow-[0_0_30px_rgba(6,182,212,0.3)] scale-110'
              }`}>
                {selectedMove ? (
                  <>
                    <div className="p-5 bg-white/20 rounded-[1.5rem] mb-3 backdrop-blur-md text-white">
                      <MoveIcon move={selectedMove} size={48} />
                    </div>
                    <span className="text-base font-black tracking-widest uppercase mb-1">{selectedMove}</span>
                    <div className={`flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[9px] font-black ${isSecret ? 'bg-purple-950/50 text-purple-200' : 'bg-cyan-950/50 text-cyan-200'}`}>
                      {isSecret ? <Lock size={10} /> : <Unlock size={10} />} {isSecret ? 'HIDDEN' : 'PUBLIC'}
                    </div>
                  </>
                ) : (
                  <span className="text-[10px] font-black text-white/20 tracking-[0.3em] uppercase">DEPLOY CARD</span>
                )}
              </div>
            </div>

            {/* ZKP / Wait Overlay */}
            {(isZkpGenerating || (battlePhase === 'WAITING_OPPONENT') || (battlePhase === 'WAITING_NEXT_ROUND')) && (
              <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#020617]/80 rounded-[3rem] overflow-hidden backdrop-blur-xl border-2 border-white/10">
                <div className="zkp-scan-line"></div>
                <RefreshCw className="w-12 h-12 text-cyan-400 animate-spin mb-4" />
                <p className="font-black tracking-[0.4em] text-cyan-400 text-base italic uppercase">
                  {isZkpGenerating ? 'GENERATING ZKP' : battlePhase === 'WAITING_OPPONENT' ? 
                    (opponentCommitted ? 'AWAITING DECISION' : 'AWAITING PEER') : 
                    'SYNCING NEXT ROUND'}
                </p>
                {isZkpGenerating && <p className="text-[8px] text-slate-500 mt-2 tracking-widest uppercase font-bold">Constructing Shielded Proof...</p>}
              </div>
            )}
          </div>

          {/* Action Context Menu - More compact */}
          <div className="h-32 mb-4 flex items-end justify-center">
            {battlePhase === 'DECIDE' && (
              <div className="w-full bg-gradient-to-r from-purple-900/80 to-indigo-900/80 border border-purple-400 rounded-[2rem] p-5 animate-in slide-in-from-bottom-8 shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-24 h-24 bg-purple-500/10 blur-2xl rounded-full"></div>
                <div className="flex items-center gap-4 mb-4">
                  <div className="p-3 bg-purple-500 rounded-xl shadow-lg"><AlertTriangle size={24} /></div>
                  <div>
                    <h3 className="font-black italic text-lg uppercase tracking-tighter leading-none mb-1">OPPONENT CHOSE HIDDEN</h3>
                    <p className="text-[10px] text-purple-200 font-bold uppercase tracking-wider opacity-70">BATTLE FOR +3 VP OR FOLD TO EVADE PENALTY?</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <button onClick={() => handleBattleAction('FOLD')} className="flex-1 py-3.5 bg-slate-900 border border-slate-700 hover:bg-slate-800 rounded-xl font-black text-xs uppercase tracking-[0.2em] transition-all">FOLD</button>
                  <button onClick={() => handleBattleAction('BATTLE')} className="flex-1 py-3.5 bg-gradient-to-r from-purple-500 to-indigo-600 rounded-xl font-black text-xs uppercase tracking-[0.2em] shadow-xl shadow-purple-500/20 active:scale-[0.98] transition-all">BATTLE</button>
                </div>
              </div>
            )}
          </div>

          {/* Player Controls - More compact */}
          <div className={`p-5 bg-slate-900/60 backdrop-blur-3xl rounded-[2.5rem] border border-white/10 shadow-2xl transition-all duration-500 ${battlePhase === 'SELECT' ? 'translate-y-0 opacity-100' : 'translate-y-20 opacity-0 pointer-events-none'}`}>
            <div className="flex justify-between items-center mb-5 px-2">
              <div className="flex p-0.5 bg-black/40 rounded-xl border border-white/5">
                <button onClick={() => setIsSecret(false)} className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-[10px] font-black transition-all ${!isSecret ? 'bg-cyan-500 shadow-lg text-white' : 'text-slate-500'}`}>
                  <Unlock size={12}/> PUBLIC
                </button>
                <button onClick={() => setIsSecret(true)} className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-[10px] font-black transition-all ${isSecret ? 'bg-purple-600 shadow-lg text-white' : 'text-slate-500'}`}>
                  <Lock size={12}/> HIDDEN
                </button>
              </div>
              <div className="flex items-center gap-1.5 text-[9px] font-black tracking-widest text-slate-500 uppercase">
                <Shield size={12} className="text-cyan-400" /> ZKP-READY
              </div>
            </div>
            
            <div className="flex gap-3 justify-center mb-6">
              {player.hand.map((move, i) => (
                <button 
                  key={i} 
                  onClick={() => setSelectedMove(move)} 
                  className={`w-24 h-32 rounded-[1.5rem] flex flex-col items-center justify-center transition-all relative overflow-hidden group ${
                    selectedMove === move ? 
                    'border-2 border-cyan-400 bg-cyan-900/40 scale-105 shadow-[0_0_20px_rgba(6,182,212,0.2)]' : 
                    'bg-slate-800/50 border border-white/5 hover:border-white/20 active:scale-95'
                  }`}
                >
                  <div className={`mb-3 transition-transform group-hover:scale-110 ${move === 'Loser' ? 'text-rose-500' : 'text-cyan-400'}`}>
                    <MoveIcon move={move} size={36} />
                  </div>
                  <span className="text-[9px] font-black uppercase tracking-widest">{move}</span>
                  {selectedMove === move && <div className="absolute inset-0 bg-cyan-400/5 animate-pulse"></div>}
                </button>
              ))}
            </div>
            
            <button 
              disabled={!selectedMove} 
              onClick={handleCommitMove} 
              className="w-full py-4.5 bg-gradient-to-r from-purple-600 to-indigo-600 rounded-[1.2rem] font-black text-lg tracking-[0.3em] shadow-2xl active:scale-[0.98] transition-all italic text-white uppercase disabled:opacity-30 disabled:grayscale"
            >
              COMMIT MOVE
            </button>
          </div>
        </div>
      )}

      {/* 5. Result & Claim */}
      {gameState === 'RESULT' && (
        <div className="flex flex-col items-center justify-start min-h-screen p-8 overflow-y-auto animate-in zoom-in duration-700">
          <div className="w-full max-w-4xl">
            {/* Header Result */}
            <div className="text-center mb-12">
              <div className={`inline-block p-10 rounded-[3.5rem] mb-8 bg-slate-900/40 backdrop-blur-3xl border-2 ${
                player.vp > opponent.vp ? 'border-yellow-500 shadow-[0_0_80px_rgba(234,179,8,0.2)]' : 
                player.vp < opponent.vp ? 'border-rose-500 shadow-[0_0_80px_rgba(244,63,94,0.1)]' : 'border-slate-500'
              }`}>
                <Trophy className={`w-32 h-32 ${player.vp > opponent.vp ? 'text-yellow-400' : player.vp < opponent.vp ? 'text-rose-500' : 'text-slate-500'}`} />
              </div>
              <h1 className="text-[9rem] font-black italic tracking-tighter leading-none mb-4">
                {player.vp > opponent.vp ? 'VICTORY' : player.vp < opponent.vp ? 'DEFEAT' : 'DRAW'}
              </h1>
              {isOnChainMode && <div className="inline-block bg-yellow-500/20 text-yellow-500 text-xs font-black px-4 py-1 rounded-full border border-yellow-500/30 uppercase tracking-[0.3em]">⛓ ON-CHAIN RESOLVED</div>}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12">
              {/* Score Summary */}
              <div className="bg-slate-900/60 backdrop-blur-2xl p-10 rounded-[3rem] border border-white/10 flex justify-between items-center px-16">
                <div className="text-center">
                  <p className="text-[10px] text-cyan-400 font-black mb-2 tracking-[0.4em] uppercase">{player.name}</p>
                  <p className="text-7xl font-black italic">{player.vp}</p>
                </div>
                <div className="text-4xl font-black text-white/10">VS</div>
                <div className="text-center">
                  <p className="text-[10px] text-rose-500 font-black mb-2 tracking-[0.4em] uppercase">{opponent.name}</p>
                  <p className="text-7xl font-black italic">{opponent.vp}</p>
                </div>
              </div>

              {/* Reward Section */}
              <div className="bg-slate-900/60 backdrop-blur-2xl p-10 rounded-[3rem] border border-white/10 flex flex-col items-center justify-center">
                {player.vp > opponent.vp ? (
                  !claimSuccess ? (
                    <>
                      <button 
                        disabled={isClaiming} 
                        onClick={handleClaimReward} 
                        className="w-full py-6 bg-gradient-to-r from-yellow-500 to-amber-600 rounded-[1.5rem] font-black text-xl flex items-center justify-center gap-4 shadow-2xl active:scale-[0.98] transition-all uppercase tracking-widest"
                      >
                        {isClaiming ? <RefreshCw className="animate-spin" size={24} /> : <Coins size={24} />} 
                        {isClaiming ? 'PROCESSING...' : `CLAIM ${YTTM_REWARD} YTTM`}
                      </button>
                      <p className="mt-4 text-[10px] text-slate-500 font-bold uppercase tracking-widest flex items-center gap-2">
                        <Lock size={12} /> SHIELDED REWARD (ZKP)
                      </p>
                    </>
                  ) : (
                    <div className="text-center animate-in fade-in zoom-in">
                      <div className="inline-flex p-4 bg-green-500/20 rounded-full text-green-400 mb-4 border border-green-500/30"><CheckCircle size={40} /></div>
                      <h3 className="text-2xl font-black italic uppercase tracking-tighter">REWARD CLAIMED</h3>
                      <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-2">NEW BALANCE: {player.balance} YTTM 🔐</p>
                    </div>
                  )
                ) : (
                  <div className="text-center opacity-40">
                    <div className="p-4 bg-slate-800 rounded-full text-slate-500 inline-block mb-4"><Zap size={40} /></div>
                    <p className="text-xs font-bold uppercase tracking-[0.2em]">NO REWARDS EARNED</p>
                  </div>
                )}
              </div>
            </div>

            {/* Scoreboard Table */}
            <div className="bg-slate-900/60 backdrop-blur-2xl rounded-[3rem] border border-white/10 overflow-hidden mb-8">
              <div className="p-8 border-b border-white/5 flex justify-between items-center">
                <h3 className="text-xl font-black italic uppercase tracking-tighter">BATTLE LOG SUMMARY</h3>
                <div className="flex gap-2">
                  <span className="text-[10px] font-black px-3 py-1 bg-white/5 rounded-full text-slate-400 uppercase tracking-widest">3 ROUNDS</span>
                </div>
              </div>
              <div className="p-8 overflow-x-auto">
                <table className="w-full text-left min-w-[600px]">
                  <thead>
                    <tr className="text-[10px] text-slate-500 font-black uppercase tracking-[0.2em] border-b border-white/5">
                      <th className="pb-4">RD</th>
                      <th className="pb-4">YOU</th>
                      <th className="pb-4">OPPONENT</th>
                      <th className="pb-4">ACTION</th>
                      <th className="pb-4">RESULT</th>
                      <th className="pb-4 text-right">VP Gained</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {history.map((h, i) => (
                      <tr key={i} className="group">
                        <td className="py-6 font-mono text-slate-500">{h.round}</td>
                        <td className="py-6">
                          <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-lg ${h.playerIsSecret ? 'bg-purple-500/20 text-purple-400' : 'bg-cyan-500/20 text-cyan-400'}`}>
                              {h.playerIsSecret ? <Lock size={16} /> : <MoveIcon move={h.playerMove} size={16} />}
                            </div>
                            <span className="text-xs font-black uppercase tracking-wider">{h.playerIsSecret ? '🔐 HIDDEN' : h.playerMove}</span>
                          </div>
                        </td>
                        <td className="py-6">
                          <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-lg ${h.opponentIsSecret ? 'bg-purple-500/20 text-purple-400' : 'bg-rose-500/20 text-rose-400'}`}>
                              {h.opponentIsSecret ? <Lock size={16} /> : <MoveIcon move={h.opponentMove} size={16} />}
                            </div>
                            <span className="text-xs font-black uppercase tracking-wider">{h.opponentIsSecret ? '🔐 HIDDEN' : h.opponentMove}</span>
                          </div>
                        </td>
                        <td className="py-6">
                          <span className={`text-[10px] font-black px-2 py-0.5 rounded border ${h.playerAction === 'FOLD' ? 'bg-purple-500/10 border-purple-500/30 text-purple-400' : 'bg-slate-500/10 border-slate-500/30 text-slate-400'}`}>
                            {h.playerAction}
                          </span>
                        </td>
                        <td className="py-6">
                          <span className={`text-xs font-black italic ${
                            h.result === 'WIN' ? 'text-cyan-400' : 
                            h.result === 'LOSS' ? 'text-rose-500' : 
                            h.result === 'FOLDED' ? 'text-purple-400' : 'text-slate-400'
                          }`}>
                            {h.result}
                          </span>
                        </td>
                        <td className="py-6 text-right font-black italic text-xl">
                          {h.playerVPGain > 0 ? `+${h.playerVPGain}` : h.playerVPGain}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* On-Chain Result Panel */}
            {isOnChainMode && (
              <div className="bg-slate-900/60 backdrop-blur-2xl rounded-[3rem] border border-yellow-500/20 overflow-hidden mb-12">
                <button 
                  onClick={() => setShowOnChainPanel(!showOnChainPanel)}
                  className="w-full p-8 flex justify-between items-center hover:bg-white/5 transition-colors"
                >
                  <div className="flex items-center gap-4 text-yellow-500">
                    <Zap size={24} />
                    <h3 className="text-xl font-black italic uppercase tracking-tighter">ON-CHAIN DATA LOG</h3>
                  </div>
                  {showOnChainPanel ? <ChevronUp /> : <ChevronDown />}
                </button>
                {showOnChainPanel && (
                  <div className="p-8 pt-0 animate-in slide-in-from-top-4">
                    <div className="space-y-4 font-mono text-[10px] bg-black/40 p-6 rounded-2xl border border-white/5">
                      <div className="flex justify-between border-b border-white/5 pb-2">
                        <span className="text-slate-500 uppercase">Contract Address</span>
                        <span className="text-yellow-400 underline italic">midnight_contract_92x7...a290</span>
                      </div>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div className="space-y-3">
                          <p className="text-cyan-500 font-black border-b border-cyan-500/20 pb-1">YOUR STREAM</p>
                          {history.map((h, i) => (
                            <div key={i} className="flex flex-col gap-1">
                              <span className="text-slate-500 text-[8px] uppercase tracking-tighter">Round {h.round} Deployment</span>
                              <span className="text-slate-300 truncate block bg-white/5 p-1.5 rounded">{h.txHash}</span>
                            </div>
                          ))}
                          {claimSuccess && (
                            <div className="flex flex-col gap-1 border-t border-yellow-500/20 pt-2">
                              <span className="text-yellow-500 text-[8px] uppercase tracking-tighter italic">Shielded Reward TX (Mint)</span>
                              <span className="text-yellow-400 truncate block bg-yellow-500/5 p-1.5 rounded">0x{Math.random().toString(16).substring(2, 34)}</span>
                            </div>
                          )}
                        </div>
                        
                        {gameMode === 'MULTI' && (
                          <div className="space-y-3">
                            <p className="text-rose-500 font-black border-b border-rose-500/20 pb-1">OPPONENT STREAM</p>
                            {opponentTxHashes.map((hash, i) => (
                              <div key={i} className="flex flex-col gap-1">
                                <span className="text-slate-500 text-[8px] uppercase tracking-tighter">Peer Verification TX</span>
                                <span className="text-slate-300 truncate block bg-white/5 p-1.5 rounded">{hash}</span>
                              </div>
                            ))}
                            {opponentTxHashes.length === 0 && (
                              <p className="text-slate-700 italic py-4 text-center tracking-widest">AWAITING PEER DATA...</p>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="mt-6 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-xl text-yellow-500/70 italic text-center font-sans text-[9px] tracking-wide">
                        DEMO: Midnight Preprod Simulated Environment. Real ZKP proofs generated locally.
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            <button 
              onClick={() => {
                setGameState('MODE_SELECTION');
                setHistory([]);
                setOpponentTxHashes([]);
                setRound(1);
                setClaimSuccess(false);
                if (gameMode === 'MULTI') multiplayerWS.disconnect();
              }} 
              className="w-full py-6 text-slate-500 hover:text-white transition-all underline underline-offset-8 text-[10px] font-black tracking-[0.4em] uppercase mb-20"
            >
              RETURN TO COMMAND CENTER
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
