'use client';

import React, { useState, useEffect } from 'react';
import { 
  Shield, Sword, Lock, Unlock, Zap, Trophy, User, RefreshCw, 
  AlertTriangle, Eye, EyeOff, Hand, Scissors, Grab, Skull, Coins, CheckCircle
} from 'lucide-react';
import { createAccount, saveAccountLocally, loadAccountLocally, MidnightAccount } from '@/utils/midnightAccount';

type Move = 'Rock' | 'Scissors' | 'Paper' | 'Loser';
type GameState = 'ONBOARDING' | 'LOBBY' | 'MATCHING' | 'BATTLE' | 'RESULT';
type BattlePhase = 'SELECT' | 'DECIDE' | 'RESOLUTION';
type RoundResult = 'WIN' | 'LOSS' | 'DRAW' | 'FOLDED' | null;

interface Player {
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

export default function Home() {
  const [gameState, setGameState] = useState<GameState>('ONBOARDING');
  const [battlePhase, setBattlePhase] = useState<BattlePhase>('SELECT');
  const [account, setAccount] = useState<MidnightAccount | null>(null);
  const [roomId, setRoomId] = useState('');
  const [round, setRound] = useState(1);
  const [player, setPlayer] = useState<Player>({ address: '', vp: 0, hand: [], balance: 0 });
  const [opponent, setOpponent] = useState<Player>({ address: 'mn_addr_opp...882', vp: 0, hand: [], balance: 0 });
  const [selectedMove, setSelectedMove] = useState<Move | null>(null);
  const [isSecret, setIsSecret] = useState(false);
  const [opponentIsSecret, setOpponentIsSecret] = useState(false);
  const [isZkpGenerating, setIsZkpGenerating] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const [claimSuccess, setClaimClaimSuccess] = useState(false);
  const [battleLog, setBattleLog] = useState<string[]>([]);
  const [roundResult, setRoundResult] = useState<RoundResult>(null);

  useEffect(() => {
    const saved = loadAccountLocally();
    if (saved) {
      setAccount(saved);
      setGameState('LOBBY');
    }
  }, []);

  const handleCreateAccount = () => {
    const newAcc = createAccount();
    setAccount(newAcc);
    saveAccountLocally(newAcc);
    setGameState('LOBBY');
  };

  const handleStartGame = () => {
    if (!roomId) return;
    setGameState('MATCHING');
    setTimeout(() => {
      setGameState('BATTLE');
      setBattlePhase('SELECT');
      const moves: Move[] = ['Rock', 'Paper', 'Scissors'];
      const playerMoves = ['Loser', ...[...moves].sort(() => Math.random() - 0.5).slice(0, 2)] as Move[];
      const opponentMoves = ['Loser', ...[...moves].sort(() => Math.random() - 0.5).slice(0, 2)] as Move[];
      setPlayer(prev => ({ ...prev, address: account?.address || 'me', vp: 0, hand: playerMoves }));
      setOpponent(prev => ({ ...prev, address: 'mn_addr_opp...882', vp: 0, hand: opponentMoves }));
    }, 1500);
  };

  const handleCommitMove = () => {
    if (!selectedMove) return;
    const opSecret = Math.random() > 0.5;
    setOpponentIsSecret(opSecret);
    if (opSecret) setBattlePhase('DECIDE');
    else handleBattle();
  };

  const handleBattle = () => {
    if (isSecret) {
      setIsZkpGenerating(true);
      setTimeout(() => {
        setIsZkpGenerating(false);
        processRound('BATTLE');
      }, 2000);
    } else {
      processRound('BATTLE');
    }
  };

  const handleFold = () => processRound('FOLD');

  const processRound = (action: 'BATTLE' | 'FOLD') => {
    setBattlePhase('RESOLUTION');
    const opponentMove: Move = opponent.hand[0];
    let result: RoundResult = null;
    let pGain = 0; let pPenalty = 0; let oGain = 0; let oPenalty = 0;

    if (action === 'FOLD') {
      result = 'FOLDED';
    } else {
      const win = (selectedMove === 'Rock' && opponentMove === 'Scissors') || 
                  (selectedMove === 'Paper' && opponentMove === 'Rock') ||
                  (selectedMove === 'Scissors' && opponentMove === 'Paper') ||
                  (opponentMove === 'Loser' && selectedMove !== 'Loser');
      const draw = selectedMove === opponentMove;
      
      if (draw) {
        result = 'DRAW'; pGain = 1; oGain = 1;
      } else if (win) {
        result = 'WIN';
        if (isSecret && opponentIsSecret) { pGain = 3; oPenalty = -1; }
        else if (isSecret) { pGain = 1; }
        else if (opponentIsSecret) { pGain = 1; oPenalty = -1; }
        else { pGain = 1; }
      } else {
        result = 'LOSS';
        if (opponentIsSecret && isSecret) { oGain = 3; pPenalty = -1; }
        else if (opponentIsSecret) { oGain = 1; }
        else if (isSecret) { oGain = 1; pPenalty = -1; }
        else { oGain = 1; }
      }
    }

    setRoundResult(result);
    setPlayer(prev => {
      const newHand = [...prev.hand];
      const idx = newHand.findIndex(m => m === selectedMove);
      if (idx !== -1) newHand.splice(idx, 1);
      return { ...prev, vp: prev.vp + pGain + pPenalty, hand: newHand };
    });
    setOpponent(prev => ({ ...prev, vp: prev.vp + oGain + oPenalty, hand: prev.hand.slice(1) }));
    
    setTimeout(() => {
      setRoundResult(null);
      if (round < 3) {
        setRound(round + 1); setSelectedMove(null); setIsSecret(false); setBattlePhase('SELECT');
      } else {
        setGameState('RESULT');
      }
    }, 2500);
  };

  const handleClaimReward = () => {
    setIsClaiming(true);
    setTimeout(() => {
      setIsClaiming(false);
      setClaimClaimSuccess(true);
      setPlayer(prev => ({ ...prev, balance: prev.balance + 10 }));
      setTimeout(() => {
        setClaimClaimSuccess(false);
        setGameState('LOBBY');
        setRound(1);
        setSelectedMove(null);
      }, 2000);
    }, 3000);
  };

  return (
    <main className="min-h-screen bg-[#0f172a] text-white font-sans overflow-hidden">
      <div className="fixed top-0 left-0 w-full h-full -z-10 opacity-30">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-purple-600 rounded-full blur-[150px]"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-cyan-600 rounded-full blur-[150px]"></div>
      </div>
      
      {/* ONBOARDING */}
      {gameState === 'ONBOARDING' && (
        <div className="flex flex-col items-center justify-center min-h-screen p-4 animate-in fade-in duration-700">
          <div className="bg-slate-900/80 backdrop-blur-xl p-12 rounded-[2.5rem] w-full max-w-md text-center border-2 border-purple-500/30 shadow-[0_0_50px_rgba(168,85,247,0.2)]">
            <div className="bg-purple-500 p-6 rounded-3xl inline-block mb-8">
              <Shield className="w-16 h-16 text-white" />
            </div>
            <h1 className="text-5xl font-black mb-3 italic tracking-tighter">LOSER'S GAMBIT</h1>
            <p className="text-cyan-400 mb-10 text-sm tracking-[0.3em] font-black uppercase">ZK Janken Frontier</p>
            <button onClick={handleCreateAccount} className="w-full py-5 bg-gradient-to-r from-purple-600 to-purple-400 rounded-2xl font-black text-xl shadow-xl active:scale-95">CREATE IDENTITY</button>
          </div>
        </div>
      )}

      {/* LOBBY */}
      {gameState === 'LOBBY' && (
        <div className="flex flex-col items-center justify-center min-h-screen p-4 animate-in slide-in-from-bottom-8 duration-500">
          <div className="w-full max-w-md">
            <div className="flex justify-between items-center mb-10 bg-slate-900/60 p-4 rounded-2xl border border-white/10 backdrop-blur-md">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-cyan-500 rounded-xl"><User size={20} /></div>
                <span className="text-sm font-mono font-black">{account?.address.slice(0, 16)}...</span>
              </div>
              <div className="bg-yellow-500/20 text-yellow-400 px-4 py-2 rounded-xl text-xs font-black border border-yellow-500/50 flex items-center gap-2">
                <Coins size={14} /> {player.balance} YTTM
              </div>
            </div>
            <div className="bg-slate-900/80 backdrop-blur-xl p-10 rounded-[2.5rem] text-center border-2 border-cyan-500/30">
              <h2 className="text-3xl font-black mb-8 italic">READY FOR BATTLE?</h2>
              <input type="text" placeholder="INPUT ROOM ID" value={roomId} onChange={(e) => setRoomId(e.target.value.toUpperCase())} className="w-full bg-black/50 border-2 border-slate-700 p-5 rounded-2xl mb-6 text-center tracking-[0.5em] font-mono font-black text-2xl text-cyan-400 outline-none" />
              <button disabled={!roomId} onClick={handleStartGame} className="w-full py-5 bg-gradient-to-r from-cyan-600 to-cyan-400 rounded-2xl font-black text-xl shadow-xl active:scale-95 flex items-center justify-center gap-4">
                <Sword size={28} /> INITIALIZE MATCH
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MATCHING */}
      {gameState === 'MATCHING' && (
        <div className="flex flex-col items-center justify-center min-h-screen">
          <RefreshCw className="w-32 h-32 text-cyan-400 animate-spin opacity-40" />
          <p className="mt-10 text-3xl font-black tracking-[0.4em] italic text-white drop-shadow-lg">MATCHING...</p>
        </div>
      )}

      {/* BATTLE */}
      {gameState === 'BATTLE' && (
        <div className="flex flex-col h-screen p-4 max-w-2xl mx-auto overflow-hidden">
          {roundResult && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-2xl animate-in fade-in duration-300">
              <h2 className={`text-[12rem] font-black italic tracking-tighter animate-in zoom-in duration-300 ${
                roundResult === 'WIN' ? 'text-cyan-400' : roundResult === 'LOSS' ? 'text-rose-500' : 'text-slate-300'
              }`}>{roundResult}</h2>
            </div>
          )}

          <div className="flex justify-between items-center p-5 bg-slate-900/80 backdrop-blur-xl rounded-[1.5rem] border-2 border-white/5 shadow-2xl mb-4">
            <div className="flex flex-col">
              <div className="flex items-center gap-2 mb-1">
                <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse"></span>
                <span className="text-[10px] text-slate-400 font-black tracking-[0.2em] uppercase">ENEMY UNIT</span>
              </div>
              <span className="font-mono text-[10px] text-white/40">{opponent.address}</span>
            </div>
            <div className="flex gap-8 text-right">
              <div><div className="text-[10px] text-slate-400 font-black uppercase">ENEMY VP</div><div className="text-3xl font-black text-rose-500 italic leading-none">{opponent.vp}</div></div>
              <div><div className="text-[10px] text-cyan-400 font-black uppercase">YOUR VP</div><div className="text-3xl font-black text-cyan-400 italic leading-none">{player.vp}</div></div>
            </div>
          </div>

          <div className="flex-1 flex flex-col items-center justify-center relative my-8">
            <div className="bg-white/5 px-4 py-1 rounded-full border border-white/10 mb-8 font-black text-[10px] tracking-[0.4em] uppercase text-white/60">ROUND {round} / 3</div>
            <div className="flex gap-8 items-center justify-center w-full">
              <div className={`w-36 h-52 rounded-[2rem] border-4 flex flex-col items-center justify-center transition-all duration-500 ${battlePhase === 'SELECT' ? 'bg-black/20 border-white/5 opacity-10 scale-90' : opponentIsSecret ? 'bg-gradient-to-br from-purple-900 to-indigo-950 border-purple-500 shadow-2xl scale-110' : 'bg-slate-800 border-white/40 scale-110 shadow-xl'}`}>
                {battlePhase !== 'SELECT' && <><div className={`p-4 rounded-2xl mb-4 ${opponentIsSecret ? 'bg-purple-500' : 'bg-slate-700'}`}>{opponentIsSecret ? <Lock size={32} /> : <Unlock size={32} />}</div><span className="text-[10px] font-black tracking-[0.2em] uppercase">{opponentIsSecret ? 'HIDDEN' : 'PUBLIC'}</span></>}
              </div>
              <div className="text-4xl font-black italic text-white/10 tracking-tighter">VS</div>
              <div className={`w-36 h-52 rounded-[2rem] border-4 flex flex-col items-center justify-center transition-all duration-500 ${!selectedMove ? 'bg-black/20 border-white/5 border-dashed border-2 opacity-30' : isSecret ? 'bg-gradient-to-br from-purple-600 to-indigo-800 border-purple-300 shadow-2xl scale-110' : 'bg-gradient-to-br from-cyan-500 to-blue-700 border-white shadow-2xl scale-110'}`}>
                {selectedMove ? <><div className="p-4 bg-white/20 rounded-2xl mb-4 backdrop-blur-md"><MoveIcon move={selectedMove} size={40} /></div><span className="text-sm font-black tracking-widest uppercase mb-1">{selectedMove}</span><div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[8px] font-black ${isSecret ? 'bg-purple-950/50' : 'bg-cyan-950/50'}`}>{isSecret ? <Lock size={8} /> : <Unlock size={8} />} {isSecret ? 'HIDDEN' : 'PUBLIC'}</div></> : <span className="text-[10px] font-black text-white/20 tracking-widest uppercase">DEPLOY</span>}
              </div>
            </div>
            {isZkpGenerating && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-purple-950/90 rounded-[2.5rem] overflow-hidden backdrop-blur-xl border-4 border-purple-500">
                <div className="zkp-scan-line"></div><RefreshCw className="w-12 h-12 text-white animate-spin mb-4" /><p className="font-black tracking-[0.4em] text-white text-sm italic uppercase">GENERATING ZKP</p>
              </div>
            )}
          </div>

          <div className="mb-6 h-40">
            {battlePhase === 'DECIDE' && (
              <div className="p-6 bg-gradient-to-r from-purple-900/80 to-indigo-900/80 border-2 border-purple-400 rounded-[2rem] animate-in slide-in-from-bottom-4 shadow-2xl">
                <div className="flex items-center gap-4 mb-4"><div className="p-3 bg-purple-500 rounded-xl shadow-lg"><AlertTriangle size={24} /></div><div><h3 className="font-black italic text-lg text-white uppercase">OPPONENT HIDDEN</h3><p className="text-[10px] text-purple-200 font-bold uppercase tracking-widest opacity-80">BATTLE (+3 VP) OR ESCAPE (0 VP)?</p></div></div>
                <div className="flex gap-4">
                  <button onClick={handleFold} className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 rounded-xl font-black text-xs uppercase tracking-widest border border-slate-600">FOLD</button>
                  <button onClick={handleBattle} className="flex-1 py-3 bg-gradient-to-r from-purple-500 to-purple-400 rounded-xl font-black text-xs uppercase tracking-widest text-white shadow-xl shadow-purple-900/50">BATTLE</button>
                </div>
              </div>
            )}
          </div>

          <div className={`p-6 bg-slate-900/90 backdrop-blur-2xl rounded-[2rem] border-2 border-white/10 shadow-3xl transition-all duration-500 ${battlePhase === 'SELECT' ? 'translate-y-0 opacity-100' : 'translate-y-20 opacity-0 pointer-events-none'}`}>
            <div className="flex justify-between items-center mb-6 px-1">
              <div className="flex p-0.5 bg-black/40 rounded-xl border border-white/5">
                <button onClick={() => setIsSecret(false)} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[10px] font-black transition-all ${!isSecret ? 'bg-cyan-500 shadow-lg' : 'text-slate-500'}`}><Unlock size={12}/> PUBLIC</button>
                <button onClick={() => setIsSecret(true)} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[10px] font-black transition-all ${isSecret ? 'bg-purple-600 shadow-lg' : 'text-slate-500'}`}><Lock size={12}/> HIDDEN</button>
              </div>
              <div className="bg-black/30 px-4 py-2 rounded-xl border border-white/5"><span className="text-[8px] text-slate-500 font-black uppercase block mb-0.5 tracking-widest">NET VP</span><span className="text-2xl font-black text-cyan-400 italic leading-none">{player.vp}</span></div>
            </div>
            <div className="flex gap-3 justify-center mb-6">
              {player.hand.map((move, i) => (
                <button key={i} onClick={() => setSelectedMove(move)} className={`w-24 h-32 rounded-[1.5rem] flex flex-col items-center justify-center transition-all relative overflow-hidden group ${selectedMove === move ? 'border-[3px] border-cyan-400 bg-cyan-900/40 scale-105 shadow-xl shadow-cyan-900/20' : 'bg-slate-800/50 border-2 border-white/5 hover:border-white/20 active:scale-95'}`}>
                  <div className={`mb-3 transition-transform group-hover:scale-110 ${move === 'Loser' ? 'text-rose-500' : 'text-cyan-400'}`}><MoveIcon move={move} size={32} /></div>
                  <span className="text-[9px] font-black uppercase tracking-widest">{move}</span>{selectedMove === move && <div className="absolute inset-0 bg-cyan-400/5 animate-pulse"></div>}
                </button>
              ))}
            </div>
            <button disabled={!selectedMove} onClick={handleCommitMove} className="w-full py-4 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:opacity-5 rounded-2xl font-black text-lg tracking-[0.2em] shadow-xl active:scale-95 italic">COMMIT ATTACK</button>
          </div>
        </div>
      )}

      {/* RESULT & CLAIM REWARD */}
      {gameState === 'RESULT' && (
        <div className="flex flex-col items-center justify-center min-h-screen p-4 text-center animate-in zoom-in duration-500">
          <div className={`p-10 rounded-[3rem] mb-6 bg-slate-900/60 backdrop-blur-2xl border-2 ${player.vp > opponent.vp ? 'border-yellow-500 shadow-3xl shadow-yellow-900/20' : 'border-slate-800 opacity-50'}`}>
            <Trophy className={`w-32 h-32 ${player.vp > opponent.vp ? 'text-yellow-400' : 'text-slate-700'}`} />
          </div>
          <h1 className="text-[8rem] font-black mb-4 italic tracking-tighter leading-none">{player.vp > opponent.vp ? 'VICTORY' : player.vp < opponent.vp ? 'DEFEAT' : 'DRAW'}</h1>
          <div className="flex gap-16 my-8 bg-white/5 backdrop-blur-md px-12 py-8 rounded-[2.5rem] border border-white/10">
            <div><p className="text-[10px] text-cyan-400 font-black mb-2 tracking-[0.4em] uppercase">YOUR VP</p><p className="text-6xl font-black text-white italic">{player.vp}</p></div>
            <div className="w-0.5 bg-white/10 self-stretch"></div>
            <div><p className="text-[10px] text-rose-500 font-black mb-2 tracking-[0.4em] uppercase">ENEMY VP</p><p className="text-6xl font-black text-white italic">{opponent.vp}</p></div>
          </div>
          
          {player.vp > opponent.vp && !claimSuccess && (
            <button 
              disabled={isClaiming}
              onClick={handleClaimReward}
              className="py-5 px-16 bg-gradient-to-r from-yellow-500 to-amber-600 hover:from-yellow-400 hover:to-amber-500 rounded-2xl font-black text-xl mb-10 flex items-center gap-4 mx-auto shadow-2xl active:scale-95 disabled:opacity-50"
            >
              {isClaiming ? <RefreshCw className="animate-spin" size={24} /> : <Coins size={24} />}
              {isClaiming ? 'TRANSACTING...' : 'CLAIM 10 YTTM REWARD'}
            </button>
          )}

          {claimSuccess && (
            <div className="mb-10 text-cyan-400 font-black flex items-center gap-3 justify-center animate-bounce text-xl">
              <CheckCircle size={28} /> REWARD CREDITED TO IDENTITY
            </div>
          )}

          <button onClick={() => { setGameState('LOBBY'); setRound(1); }} className="text-slate-400 hover:text-white transition-all underline underline-offset-8 text-xs font-black tracking-[0.4em] uppercase">RETURN TO COMMAND</button>
        </div>
      )}
    </main>
  );
}
