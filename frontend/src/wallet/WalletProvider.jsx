import { createContext, useCallback, useEffect, useMemo, useState } from 'react';
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

const endpoint = clusterApiUrl('mainnet-beta');

function WalletBridge({ children }) {
  const { connection } = useConnection();

  const {
    publicKey,
    connected,
    connecting,
    disconnect,
    connect,
    wallets,
    select,
    sendTransaction,
  } = useSolanaWallet();

  const [balanceLamports, setBalanceLamports] = useState(0);
  const [status, setStatus] = useState('idle');

  useEffect(() => {
    if (!connected || !publicKey) {
      setBalanceLamports(0);
      setStatus('idle');
      return;
    }

    setStatus('connected');

    connection
      .getBalance(publicKey)
      .then(setBalanceLamports)
      .catch(console.error);
  }, [connected, publicKey, connection]);

  const sendPayment = useCallback(
    async (toAddress, lamports) => {
      if (!publicKey) {
        throw new Error('WALLET_NOT_CONNECTED');
      }

      setStatus('sending');

      try {
        const { blockhash } = await connection.getLatestBlockhash();

        const tx = new Transaction({
          feePayer: publicKey,
          recentBlockhash: blockhash,
        }).add(
          SystemProgram.transfer({
            fromPubkey: publicKey,
            toPubkey: new PublicKey(toAddress),
            lamports,
          })
        );

        const signature = await sendTransaction(tx, connection);

        await connection.confirmTransaction(signature, 'confirmed');

        setStatus('success');

        return signature;
      } catch (err) {
        setStatus('error');
        throw err;
      }
    },
    [publicKey, connection, sendTransaction]
  );

  const value = useMemo(
    () => ({
      address: publicKey?.toBase58() ?? null,
      publicKey,
      connected,
      connecting,
      wallets,
      balanceLamports,
      status,
      connection,
      connect,
      disconnect,
      select,
      sendPayment,
    }),
    [
      publicKey,
      connected,
      connecting,
      wallets,
      balanceLamports,
      status,
      connection,
      connect,
      disconnect,
      select,
      sendPayment,
    ]
  );

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
      <SolanaWalletProvider wallets={wallets} autoConnect={false}>
        <WalletModalProvider>
          <WalletBridge>{children}</WalletBridge>
        </WalletModalProvider>
      </SolanaWalletProvider>
    </ConnectionProvider>
  );
}
