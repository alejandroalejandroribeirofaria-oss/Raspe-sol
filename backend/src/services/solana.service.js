import { clusterApiUrl, Connection, PublicKey } from '@solana/web3.js';
import { env } from '../config/env.js';
import { TICKET_PRICE_LAMPORTS } from '../constants.js';
import { HttpError } from '../utils/httpError.js';

const connectionCache = new Map();

export function assertPublicKey(value, label = 'public key') {
  try {
    return new PublicKey(value).toBase58();
  } catch {
    throw new HttpError(400, `Invalid ${label}`);
  }
}

export function getConnection(cluster = env.SOLANA_CLUSTER) {
  const activeCluster = cluster === 'mainnet-beta' ? 'mainnet-beta' : 'devnet';
  if (connectionCache.has(activeCluster)) return connectionCache.get(activeCluster);

  const connection = new Connection(clusterApiUrl(activeCluster), env.SOLANA_COMMITMENT);
  connectionCache.set(activeCluster, connection);
  return connection;
}

function accountKeyToString(accountKey) {
  const value = accountKey?.pubkey ?? accountKey;
  return typeof value?.toBase58 === 'function' ? value.toBase58() : String(value);
}

function accountSigners(message) {
  return (message?.accountKeys ?? [])
    .filter((accountKey) => Boolean(accountKey?.signer))
    .map(accountKeyToString);
}

function payer(message) {
  return message?.accountKeys?.[0] ? accountKeyToString(message.accountKeys[0]) : null;
}

function findTreasuryTransfer(parsedTransaction, wallet) {
  const instructions = parsedTransaction?.transaction?.message?.instructions ?? [];
  return instructions.find((instruction) => {
    const info = instruction?.parsed?.info;
    return (
      instruction.program === 'system' &&
      instruction.parsed?.type === 'transfer' &&
      info?.source === wallet &&
      info?.destination === env.TREASURY_WALLET
    );
  });
}

export function validateParsedPaymentTransaction({ parsedTransaction, wallet, cluster, nowSeconds }) {
  const message = parsedTransaction?.transaction?.message;
  const signers = accountSigners(message);
  const feePayer = payer(message);

  if (signers.length !== 1 || signers[0] !== wallet || feePayer !== wallet) {
    throw new HttpError(400, 'Wallet does not match transaction signer.');
  }

  if (parsedTransaction.meta?.err) {
    throw new HttpError(400, 'Transaction failed on-chain');
  }

  const blockTime = parsedTransaction.blockTime;
  if (!blockTime) {
    throw new HttpError(400, 'Transaction blockTime unavailable.');
  }

  const age = Math.floor((nowSeconds ?? Date.now() / 1000) - blockTime);
  if (age > env.MAX_TRANSACTION_AGE_SECONDS) {
    throw new HttpError(400, 'Transaction expired.');
  }

  const transfer = findTreasuryTransfer(parsedTransaction, wallet);
  if (!transfer) {
    throw new HttpError(400, 'Wallet does not match transaction signer.');
  }

  const amountLamports = BigInt(transfer.parsed.info.lamports ?? 0);
  if (amountLamports < TICKET_PRICE_LAMPORTS) {
    throw new HttpError(400, 'Insufficient payment.');
  }

  return {
    slot: BigInt(parsedTransaction.slot),
    blockTime: new Date(blockTime * 1000),
    cluster,
    amountLamports
  };
}

export async function verifyPurchaseTransaction({ wallet, signature, cluster }) {
  const normalizedWallet = assertPublicKey(wallet, 'wallet');
  assertPublicKey(env.TREASURY_WALLET, 'treasury wallet');

  if (!signature || signature.length < 64) {
    throw new HttpError(400, 'Invalid transaction signature');
  }

  const activeCluster = cluster || env.SOLANA_CLUSTER;

  if (!env.REQUIRE_CHAIN_CONFIRMATION) {
    return {
      wallet: normalizedWallet,
      signature,
      slot: null,
      blockTime: new Date(),
      cluster: activeCluster,
      amountLamports: TICKET_PRICE_LAMPORTS,
      verifiedOnChain: false
    };
  }

  const tx = await getConnection(activeCluster).getParsedTransaction(signature, {
    commitment: env.SOLANA_COMMITMENT,
    maxSupportedTransactionVersion: 0
  });

  if (!tx) {
    throw new HttpError(404, 'Transaction not found or not finalized');
  }

  const validated = validateParsedPaymentTransaction({
    parsedTransaction: tx,
    wallet: normalizedWallet,
    cluster: activeCluster
  });

  return {
    wallet: normalizedWallet,
    signature,
    ...validated,
    verifiedOnChain: true
  };
}

