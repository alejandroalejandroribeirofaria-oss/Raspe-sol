import { createContext, useContext, useMemo, useState } from 'react';
import {
  clusterApiUrl,
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction
} from '@solana/web3.js';

const WalletContext = createContext(null);

function getProvider() {
  if ('solana' in window && window.solana?.isPhantom) return window.solana;
  return null;
}

export function WalletProvider({ children }) {
  const [publicKey, setPublicKey] = useState(null);
  const [balance, setBalance] = useState(null);
  const [error, setError] = useState('');

  const connect = async (cluster = import.meta.env.VITE_DEFAULT_CLUSTER || 'devnet') => {
    const provider = getProvider();
    if (!provider) {
      window.open('https://phantom.app/', '_blank', 'noopener,noreferrer');
      throw new Error('Phantom Wallet not found');
    }

    const response = await provider.connect();
    const wallet = response.publicKey.toBase58();
    setPublicKey(wallet);
    await refreshBalance(wallet, cluster);
    return wallet;
  };

  const disconnect = async () => {
    await getProvider()?.disconnect?.();
    setPublicKey(null);
    setBalance(null);
  };

  const refreshBalance = async (wallet = publicKey, cluster = 'devnet') => {
    if (!wallet) return null;
    const connection = new Connection(clusterApiUrl(cluster), 'confirmed');
    const lamports = await connection.getBalance(new PublicKey(wallet));
    const sol = lamports / LAMPORTS_PER_SOL;
    setBalance(sol);
    return sol;
  };

  const payForTicket = async ({ treasuryWallet, ticketPriceLamports, cluster }) => {
    const provider = getProvider();
    if (!provider || !publicKey) throw new Error('Wallet not connected');

    const connection = new Connection(clusterApiUrl(cluster), 'confirmed');
    const fromPubkey = new PublicKey(publicKey);
    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey,
        toPubkey: new PublicKey(treasuryWallet),
        lamports: Number(ticketPriceLamports)
      })
    );

    transaction.feePayer = fromPubkey;
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;

    const signed = await provider.signTransaction(transaction);
    const signature = await connection.sendRawTransaction(signed.serialize());
    await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
    await refreshBalance(publicKey, cluster);
    return signature;
  };

  const value = useMemo(() => ({
    publicKey,
    balance,
    error,
    setError,
    connect,
    disconnect,
    refreshBalance,
    payForTicket,
    hasPhantom: Boolean(getProvider())
  }), [publicKey, balance, error]);

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  return useContext(WalletContext);
}

