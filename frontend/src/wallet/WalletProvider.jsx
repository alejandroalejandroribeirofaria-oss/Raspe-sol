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

// ==================== ALTERAÇÃO 1 ====================
const endpoint =
  import.meta.env.VITE_SOLANA_RPC_URL || clusterApiUrl('mainnet-beta');

console.log('RPC Endpoint:', endpoint);
// =====================================================

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

    // ==================== ALTERAÇÃO 2 ====================
    console.log('Wallet:', wallet.publicKey?.toBase58());

    try {
      const balance = await connection.getBalance(wallet.publicKey);

      console.log('Lamports:', balance);
      console.log('SOL:', balance / 1e9);
      // ====================================================

      setBalanceLamports(balance);

      console.log(
        '[WALLET] Balance:',
        balance / 1_000_000_000,
        'SOL'
      );

      return balance;
    } catch (err) {
      console.error('[WALLET] Balance error', err);
      return 0;
    }
  }, [wallet.publicKey, connection]);

  useEffect(() => {
    let subscription;

    async function start() {
      if (!wallet.publicKey) {
        setBalanceLamports(0);
        return;
      }

      await refreshBalance();

      subscription = connection.onAccountChange(
        wallet.publicKey,
        () => {
          refreshBalance();
        },
        'confirmed'
      );
    }

    start();

    return () => {
      if (subscription != null) {
        connection.removeAccountChangeListener(subscription);
      }
    };
  }, [wallet.publicKey, connection, refreshBalance]);

  const connect = useCallback(
    async (walletName) => {
      try {
        if (
          walletName &&
          wallet.wallet?.adapter?.name !== walletName
        ) {
          wallet.select(walletName);

          await new Promise((r) => setTimeout(r, 300));
        }

        await wallet.connect();

        await refreshBalance();

        console.log(
          '[WALLET] Connected:',
          wallet.publicKey?.toBase58()
        );
      } catch (err) {
        console.error('[WALLET] Connect error', err);
        throw err;
      }
    },
    [wallet, refreshBalance]
  );

  const disconnect = useCallback(async () => {
    try {
      await wallet.disconnect();
    } finally {
      setBalanceLamports(0);
    }
  }, [wallet]);

  const sendPayment = useCallback(
    async (toWallet, lamports) => {
      if (!wallet.publicKey) {
        throw new Error('Wallet not connected');
      }

      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: wallet.publicKey,
          toPubkey: new PublicKey(toWallet),
          lamports: Number(lamports),
        })
      );

      tx.feePayer = wallet.publicKey;

      tx.recentBlockhash = (
        await connection.getLatestBlockhash('confirmed')
      ).blockhash;

      const signature = await wallet.sendTransaction(
        tx,
        connection
      );

      await connection.confirmTransaction(
        signature,
        'confirmed'
      );

      await refreshBalance();

      return signature;
    },
    [wallet, connection, refreshBalance]
  );

  const value = useMemo(
    () => ({
      ...wallet,

      address,

      connected: wallet.connected,

      status: wallet.connected
        ? 'connected'
        : 'disconnected',

      balanceLamports,

      balance:
        balanceLamports / 1_000_000_000,

      walletName:
        wallet.wallet?.adapter?.name ?? null,

      walletIcon:
        wallet.wallet?.adapter?.icon ?? null,

      wallets: wallet.wallets,

      connection,

      connect,

      disconnect,

      select: wallet.select,

      sendPayment,

      refreshBalance,

      openModal: () => setVisible(true),

      closeModal: () => setVisible(false),
    }),
    [
      wallet,
      address,
      balanceLamports,
      connection,
      connect,
      disconnect,
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
    ],
    []
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      <SolanaWalletProvider
        wallets={wallets}
        autoConnect
      >
        <WalletModalProvider>
          <WalletBridge>
            {children}
          </WalletBridge>
        </WalletModalProvider>
      </SolanaWalletProvider>
    </ConnectionProvider>
  );
}

export default WalletProvider;
