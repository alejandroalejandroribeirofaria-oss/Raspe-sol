import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  ConnectionProvider,
  WalletProvider as SolanaWalletProvider,
  useConnection,
  useWallet as useSolanaWallet,
} from '@solana/wallet-adapter-react';
import {
  WalletModalProvider,
  useWalletModal,
} from '@solana/wallet-adapter-react-ui';
import {
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

export function useWallet() {
  const ctx = useContext(WalletContext);

  if (!ctx) {
    throw new Error('useWallet must be used within <WalletProvider>.');
  }

  return ctx;
}

const endpoint = clusterApiUrl('mainnet-beta');

function WalletBridge({ children }) {
  const wallet = useSolanaWallet();
  const { connection } = useConnection();
  const { setVisible } = useWalletModal();

  const [balanceLamports, setBalanceLamports] = useState(0);

  const address = useMemo(
    () => wallet.publicKey?.toBase58() ?? null,
    [wallet.publicKey]
  );

  const refreshBalance = useCallback(async () => {
    if (!wallet.publicKey) {
      setBalanceLamports(0);
      return 0;
    }

    const balance = await connection.getBalance(wallet.publicKey);
    setBalanceLamports(balance);

    return balance;
  }, [wallet.publicKey, connection]);

  useEffect(() => {
    refreshBalance();
  }, [refreshBalance]);

  const connect = useCallback(
    async (walletName) => {
      if (walletName && wallet.wallet?.adapter?.name !== walletName) {
        wallet.select(walletName);

        // espera o adapter trocar
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      return wallet.connect();
    },
    [wallet]
  );

  const sendPayment = useCallback(
    async (toWallet, lamports) => {
      if (!wallet.publicKey) {
        throw new Error('Wallet not connected');
      }

      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: wallet.publicKey,
          toPubkey: new PublicKey(toWallet),
          lamports: Number(lamports),
        })
      );

      transaction.feePayer = wallet.publicKey;
      transaction.recentBlockhash =
        (await connection.getLatestBlockhash()).blockhash;

      const signature = await wallet.sendTransaction(
        transaction,
        connection
      );

      await connection.confirmTransaction(signature, 'confirmed');

      await refreshBalance();

      return signature;
    },
    [wallet, connection, refreshBalance]
  );

  const value = useMemo(
    () => ({
      ...wallet,

      address,
      balanceLamports,

      status: wallet.connected ? 'connected' : 'disconnected',

      walletName: wallet.wallet?.adapter?.name ?? null,
      walletIcon: wallet.wallet?.adapter?.icon ?? null,

      wallets: wallet.wallets,

      connect,
      disconnect: wallet.disconnect,
      select: wallet.select,

      connection,

      sendPayment,
      refreshBalance,

      openModal: () => setVisible(true),
      closeModal: () => setVisible(false),
    }),
    [
      wallet,
      address,
      balanceLamports,
      connect,
      connection,
      refreshBalance,
      sendPayment,
      setVisible,
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
      new SolflareWalletAdapter(),
      // Phantom é detectado automaticamente pelo Wallet Standard
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
