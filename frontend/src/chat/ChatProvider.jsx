
import { createContext, useCallback, useEffect, useMemo, useState, useContext } from 'react';
import {
  ConnectionProvider,
  WalletProvider as SolanaWalletProvider,
  useWallet as useSolanaWallet,
  useConnection,
} from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
} from '@solana/wallet-adapter-wallets';
import {
  clusterApiUrl,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';

import '@solana/wallet-adapter-react-ui/styles.css';

export const WalletContext = createContext(null);

// ESSE AQUI QUE O RENDER NÃO TÁ ACHANDO
export const useWallet = () => {
  const ctx = useContext(WalletContext)
  if (!ctx) throw new Error('useWallet must be used within <WalletProvider>')
  return ctx
}

const endpoint = clusterApiUrl('mainnet-beta');

function WalletBridge({ children }) {
  const { wallet, connected, publicKey, signTransaction, sendTransaction } = useSolanaWallet();
  const { connection } = useConnection();

  const [address, setAddress] = useState(null);

  useEffect(() => {
    setAddress(publicKey? publicKey.toBase58() : null);
  }, [publicKey]);

  const signAndSend = useCallback(async (instructions, signers = []) => {
    if (!publicKey) throw new Error('Wallet not connected');

    const transaction = new Transaction().add(...instructions);
    transaction.feePayer = publicKey;
    transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

    const signed = await signTransaction(transaction);
    const signature = await connection.sendRawTransaction(signed.serialize());
    await connection.confirmTransaction(signature, 'confirmed');

    return signature;
  }, [publicKey, connection, signTransaction]);

  const value = useMemo(() => ({
    connected,
    address,
    wallet,
    publicKey,
    connection,
    signTransaction,
    sendTransaction,
    signAndSend,
  }), [connected, address, wallet, publicKey, connection, signTransaction, sendTransaction, signAndSend]);

  return (
    <WalletContext.Provider value={value}>
      {children}
    </WalletContext.Provider>
  );
}

export function WalletProvider({ children }) {
  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
    ],
    []
  );

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
