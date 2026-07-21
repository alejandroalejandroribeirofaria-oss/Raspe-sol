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

console.log('🔗 RPC Endpoint:', endpoint);
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

    console.log('Wallet:', wallet.publicKey?.toBase58());

    try {
      // Usar 'finalized' para saldo mais confiável
      const balance = await connection.getBalance(
        wallet.publicKey,
        'finalized'
      );

      console.log('✅ Lamports:', balance);
      console.log('✅ SOL:', (balance / 1e9).toFixed(4));

      setBalanceLamports(balance);

      console.log(
        '[WALLET] Balance:',
        balance / 1_000_000_000,
        'SOL'
      );

      return balance;
    } catch (err) {
      console.error('[WALLET] Balance error', err);

      // Fallback para 'confirmed'
      try {
        const balance2 = await connection.getBalance(wallet.publicKey, 'confirmed');
        console.log('⚠️ Fallback confirmed Lamports:', balance2);
        console.log('⚠️ SOL:', (balance2 / 1e9).toFixed(4));
        setBalanceLamports(balance2);
        return balance2;
      } catch (e2) {
        console.error('Fallback também falhou', e2);
      }
      return 0;
    }
  }, [wallet.publicKey, connection]);

  useEffect(() => {
    if (!wallet.publicKey) {
      setBalanceLamports(0);
      return;
    }

    // Atualiza imediatamente
    refreshBalance();

    // Atualiza novamente após pequeno delay (ajuda com RPC lento)
    const timeout = setTimeout(refreshBalance, 1500);

    const subscription = connection.onAccountChange(
      wallet.publicKey,
      () => {
        refreshBalance();
      },
      'finalized'
    );

    return () => {
      clearTimeout(timeout);
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

      const latestBlockhash = await connection.getLatestBlockhash('confirmed');

      tx.recentBlockhash = latestBlockhash.blockhash;

      const signature = await wallet.sendTransaction(
        tx,
        connection
      );

      console.log("Signature:", signature);

      await connection.confirmTransaction(
        {
          signature,
          blockhash: latestBlockhash.blockhash,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        },
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
