import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import {
  ConnectionProvider,
  WalletProvider as SolanaWalletProvider,
  useConnection,
  useWallet as useAdapterWallet,
} from '@solana/wallet-adapter-react';
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
  CoinbaseWalletAdapter,
  LedgerWalletAdapter,
  CloverWalletAdapter,
  GlowWalletAdapter,
  NightlyWalletAdapter,
  TrustWalletAdapter,
} from '@solana/wallet-adapter-wallets';
import { WalletContext } from './WalletContext.jsx';

const RPC_URL = import.meta.env.VITE_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

// Explicit adapters for wallets without full Wallet Standard auto-discovery
// in every browser. Wallets that already implement the Wallet Standard
// (Backpack, and increasingly Phantom/Solflare/Glow/Nightly themselves) are
// picked up automatically by the adapter registry on top of this list —
// listing them here too is harmless, the registry de-dupes by name.
function buildAdapters() {
  return [
    new PhantomWalletAdapter(),
    new SolflareWalletAdapter(),
    new CoinbaseWalletAdapter(),
    new NightlyWalletAdapter(),
    new CloverWalletAdapter(),
    new GlowWalletAdapter(),
    new TrustWalletAdapter(),
    new LedgerWalletAdapter(),
  ];
}

const BALANCE_POLL_MS = 30_000;
const NETWORK_POLL_MS = 20_000;

/**
 * Bridges @solana/wallet-adapter-react's internal state into our own
 * WalletContext, adding: balance tracking, a friendlier `status` enum,
 * best-effort network-change detection, and a modal open/close flag.
 *
 * This is the ONLY component that calls the adapter's useWallet/useConnection
 * hooks — everything else in the app goes through wallet/useWallet.js.
 */
function WalletBridge({ children }) {
  const { connection } = useConnection();
  const adapterWallet = useAdapterWallet();
  const { wallet, wallets, publicKey, connected, connecting, disconnecting, select, connect, disconnect, sendTransaction } = adapterWallet;

  const [balanceLamports, setBalanceLamports] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | connecting | connected | locked | not_installed | error
  const [errorMessage, setErrorMessage] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [networkMismatch, setNetworkMismatch] = useState(false);
  const initialGenesisHash = useRef(null);
  const pendingConnectRef = useRef(null); // { name, resolve, reject }

  const address = publicKey ? publicKey.toBase58() : null;

  const refreshBalance = useCallback(async () => {
    if (!publicKey) {
      setBalanceLamports(null);
      return;
    }
    try {
      const lamports = await connection.getBalance(publicKey, 'confirmed');
      setBalanceLamports(lamports);
    } catch {
      // Transient RPC hiccup — keep the last known balance rather than
      // flashing an error over a stale-but-still-useful number.
    }
  }, [connection, publicKey]);

  // Balance: fetch on connect, then keep fresh via account-change
  // subscription (instant) plus a slow poll as a fallback.
  useEffect(() => {
    if (!publicKey) return;
    refreshBalance();
    const subId = connection.onAccountChange(publicKey, (info) => setBalanceLamports(info.lamports), 'confirmed');
    const interval = setInterval(refreshBalance, BALANCE_POLL_MS);
    return () => {
      connection.removeAccountChangeListener(subId);
      clearInterval(interval);
    };
  }, [connection, publicKey, refreshBalance]);

  // Best-effort network-change detection. Solana wallets don't expose a
  // standardized "network changed" event the way EIP-1193 does for EVM
  // chains, so this compares the RPC's genesis hash over time — it catches
  // the dApp's own endpoint changing, which is the one signal available
  // consistently across wallets.
  useEffect(() => {
    let cancelled = false;
    connection.getGenesisHash().then((hash) => {
      if (!cancelled) initialGenesisHash.current = hash;
    }).catch(() => {});

    const interval = setInterval(async () => {
      try {
        const hash = await connection.getGenesisHash();
        if (initialGenesisHash.current && hash !== initialGenesisHash.current) {
          setNetworkMismatch(true);
        }
      } catch {
        // RPC unreachable — don't flag a false mismatch.
      }
    }, NETWORK_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [connection]);

  // Derive a friendlier status than the adapter's raw booleans, and surface
  // "locked" / "not installed" as distinct, actionable states.
  useEffect(() => {
    if (connecting) return setStatus('connecting');
    if (connected && publicKey) return setStatus('connected');
    if (wallet?.readyState === 'NotDetected') return setStatus('not_installed');
    setStatus('idle');
  }, [connecting, connected, publicKey, wallet]);

  // `select()` only requests a wallet switch — the adapter instance in
  // `wallet` doesn't update until the next render. Connecting from an effect
  // that watches for that switch (instead of connecting right after
  // `select()`) avoids calling connect() on the previous adapter.
  useEffect(() => {
    const pending = pendingConnectRef.current;
    if (!pending) return;
    if (wallet?.adapter?.name !== pending.name) return;

    pendingConnectRef.current = null;
    connect()
      .then(() => {
        setModalOpen(false);
        pending.resolve();
      })
      .catch((err) => {
        const name = err?.name || '';
        if (name === 'WalletNotReadyError') {
          setStatus('not_installed');
        } else if (name === 'WalletConnectionError' || /locked/i.test(err?.message || '')) {
          setStatus('locked');
          setErrorMessage('walletLocked');
        } else {
          setStatus('error');
          setErrorMessage(err?.message || 'CONNECT_FAILED');
        }
        pending.reject(err);
      });
  }, [wallet, connect]);

  const connectWallet = useCallback(
    (walletName) => {
      setErrorMessage(null);
      if (wallet?.adapter?.name === walletName) {
        // Already the active adapter — no `select` state change will fire,
        // so connect immediately instead of waiting on the effect below.
        return connect()
          .then(() => setModalOpen(false))
          .catch((err) => {
            const name = err?.name || '';
            if (name === 'WalletNotReadyError') setStatus('not_installed');
            else if (name === 'WalletConnectionError' || /locked/i.test(err?.message || '')) {
              setStatus('locked');
              setErrorMessage('walletLocked');
            } else {
              setStatus('error');
              setErrorMessage(err?.message || 'CONNECT_FAILED');
            }
            throw err;
          });
      }
      return new Promise((resolve, reject) => {
        pendingConnectRef.current = { name: walletName, resolve, reject };
        select(walletName);
      });
    },
    [select, connect, wallet]
  );

  const disconnectWallet = useCallback(async () => {
    try {
      await disconnect();
    } finally {
      setBalanceLamports(null);
      setStatus('idle');
      setNetworkMismatch(false);
    }
  }, [disconnect]);

  const sendPayment = useCallback(
    async ({ toWallet, lamports }) => {
      if (!publicKey) throw new Error('WALLET_NOT_CONNECTED');
      const toPubkey = new PublicKey(toWallet);
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
      const tx = new Transaction({ feePayer: publicKey, blockhash, lastValidBlockHeight }).add(
        SystemProgram.transfer({ fromPubkey: publicKey, toPubkey, lamports })
      );
      const signature = await sendTransaction(tx, connection);
      return signature;
    },
    [publicKey, connection, sendTransaction]
  );

  const value = useMemo(
    () => ({
      address,
      publicKey,
      balanceLamports,
      status,
      errorMessage,
      connecting,
      disconnecting,
      networkMismatch,
      walletName: wallet?.adapter?.name ?? null,
      walletIcon: wallet?.adapter?.icon ?? null,
      wallets,
      modalOpen,
      openModal: () => setModalOpen(true),
      closeModal: () => setModalOpen(false),
      connect: connectWallet,
      disconnect: disconnectWallet,
      refreshBalance,
      sendPayment,
      connection,
    }),
    [
      address,
      publicKey,
      balanceLamports,
      status,
      errorMessage,
      connecting,
      disconnecting,
      networkMismatch,
      wallet,
      wallets,
      modalOpen,
      connectWallet,
      disconnectWallet,
      refreshBalance,
      sendPayment,
      connection,
    ]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

/**
 * Top-level provider — mount this once near the root (see main.jsx). Every
 * component in the tree shares this single wallet instance; there is no
 * other place in the codebase that instantiates wallet-adapter state.
 */
export function WalletProvider({ children }) {
  const adapters = useMemo(buildAdapters, []);

  return (
    <ConnectionProvider endpoint={RPC_URL}>
      <SolanaWalletProvider wallets={adapters} autoConnect onError={() => {}}>
        <WalletBridge>{children}</WalletBridge>
      </SolanaWalletProvider>
    </ConnectionProvider>
  );
}
