import { generateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';

/**
 * Midnight Account Utility
 */
export interface MidnightAccount {
  mnemonic: string;
  address: string; // Placeholder for formatted address
}

/**
 * Generates a new Midnight-compatible mnemonic and account placeholder.
 * In a real Midnight app, you would use @midnight-ntwrk/ledger to derive keys.
 */
export const createAccount = (): MidnightAccount => {
  // 1. Generate a 24-word mnemonic (256 bits of entropy)
  const mnemonic = generateMnemonic(wordlist, 256);

  // 2. Placeholder for address generation
  const placeholderAddress = `mn_addr_test${Math.random().toString(36).substring(2, 10)}`;

  return {
    mnemonic,
    address: placeholderAddress,
  };
};

/**
 * Saves account to local storage (Simple implementation)
 */
export const saveAccountLocally = (account: MidnightAccount) => {
  if (typeof window !== 'undefined') {
    localStorage.setItem('midnight_janken_account', JSON.stringify(account));
  }
};

/**
 * Loads account from local storage
 */
export const loadAccountLocally = (): MidnightAccount | null => {
  if (typeof window !== 'undefined') {
    const data = localStorage.getItem('midnight_janken_account');
    return data ? JSON.parse(data) : null;
  }
  return null;
};
