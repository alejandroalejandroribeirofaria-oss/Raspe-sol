import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import {
  ConnectionProvider,
  WalletProvider as SolanaWalletProvider,
  useWallet as useSolanaWallet,
  useConnection,
} from '@solana/wallet-adapter-react';
import { WalletModalProvider, useWalletModal } from '@solana/wallet-adapter-react-ui';
import { SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';
import { 
  clusterApiUrl, 
  Transaction, 
  SystemProgram, 
  PublicKey, // <- ADICIONADO
  LAMPORTS_PER_SOL 
} from '@solana/web3.js';
import '@solana/wallet-adapter-react-ui/styles.css';

export const WalletContext = createContext(null);

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) {
    throw new Error('useWallet must be used within <WalletProvider>. Did you forget to wrap the app?');
  }
  return ctx;
}

const endpoint = clusterApiUrl('mainnet-beta');

function WalletBridge({ children }) {
  const solanaWallet = useSolanaWallet();
  const { connection } = useConnection();
  const { setVisible } = useWalletModal();
  const [address, setAddress] = useState(null);

  useEffect(() => {
    setAddress(solanaWallet.publicKey? solanaWallet.publicKey.toBase58() : null);
  }, [solanaWallet.publicKey]);

  // CORRIGIDO: PublicKey + signAndSendTransaction
  const sendPayment = useCallback(async (toWallet, lamports) => {
    if (!solanaWallet.publicKey) throw new Error('Wallet not connected');
    if (!solanaWallet.sendTransaction) throw new Error('Wallet does not support sending transactions');
    
    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: solanaWallet.publicKey,
        toPubkey: new PublicKey(toWallet), // <- CORRIGIDO: converte string pra PublicKey
        lamports: Number(lamports), // <- garante que é number
      })
    );
    
    transaction.feePayer = solanaWallet.publicKey;
    transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

    // CORRIGIDO: usa sendTransaction que funciona em TODAS as wallets
    const signature = await solanaWallet.sendTransaction(transaction, connection);
    await connection.confirmTransaction(signature, 'confirmed');
    return signature;
  }, [solanaWallet, connection]);

  const refreshBalance = useCallback(async () => {
    if(solanaWallet.publicKey) {
      return await connection.getBalance(solanaWallet.publicKey)
    }
  }, [connection, solanaWallet.publicKey])

  const value = useMemo(() => ({
    ...solanaWallet,
    address,
    connection,
    sendPayment,
    refreshBalance,
    openModal: () => setVisible(true),
    closeModal: () => setVisible(false),
  }), [solanaWallet, address, connection, sendPayment, refreshBalance, setVisible]);

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function WalletProvider({ children }) {
  const wallets = useMemo(() => [new SolflareWalletAdapter()], []);
  return (
    <ConnectionProvider endpoint={endpoint}>
      <SolanaWalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <WalletBridge>{children}</WalletBridge>
        </WalletModalProvider>
      </SolanaWalletProvider>
    </ConnectionProvider>
  );
}
