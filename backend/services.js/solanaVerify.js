import { Connection, PublicKey } from '@solana/web3.js';
import { config } from '../config.js';

// Singleton — a Connection holds pooled HTTP/WS state; never recreate one
// per request.
export const connection = new Connection(config.rpcUrl, config.commitment);
export const treasuryPubkey = new PublicKey(config.treasuryWallet);

export class VerificationError extends Error {
  constructor(code, message, httpStatus = 400) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

// How long to keep retrying "not found yet" before actually giving up.
// 'finalized' commitment typically takes ~13-20s after submission; this
// budget is generous because a false rejection here means a real,
// already-paid customer sees an error. The 5-minute order expiry gives
// plenty of room for this to run its course.
const VERIFY_RETRY_SCHEDULE_MS = [1000, 2000, 3000, 5000, 5000, 8000, 8000, 10000]; // ~42s total

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchTransactionWithRetry(signature) {
  let lastErr = null;
  for (let attempt = 0; attempt <= VERIFY_RETRY_SCHEDULE_MS.length; attempt++) {
    try {
      const tx = await connection.getTransaction(signature, {
        commitment: config.commitment,
        maxSupportedTransactionVersion: 0,
      });
      if (tx) return tx;
    } catch (err) {
      lastErr = err;
    }
    if (attempt < VERIFY_RETRY_SCHEDULE_MS.length) await sleep(VERIFY_RETRY_SCHEDULE_MS[attempt]);
  }
  if (lastErr) throw new VerificationError('RPC_ERROR', `Could not reach Solana RPC: ${lastErr.message}`, 502);
  return null;
}

/**
 * Fetches a transaction by signature and verifies, purely from on-chain
 * data, that:
 *  - it exists, succeeded, and isn't stale
 *  - the wallet claiming to have paid actually signed it (not just present
 *    as some unrelated account in the transaction)
 *  - that same wallet is the fee payer and the debited "source" account
 *  - the treasury received exactly what the balance deltas say it did
 *
 * Nothing here is ever taken from request bodies except the signature and
 * the wallet to check against — the amount is always re-derived from the
 * transaction itself.
 */
export async function verifyPayment({ signature, expectedWallet }) {
  if (!signature || typeof signature !== 'string') {
    throw new VerificationError('MISSING_SIGNATURE', 'Transaction signature is required.');
  }

  const tx = await fetchTransactionWithRetry(signature);

  if (!tx) throw new VerificationError('TRANSACTION_NOT_FOUND', 'Transaction not found.');
  if (!tx.meta) throw new VerificationError('TRANSACTION_META_MISSING', 'Transaction metadata unavailable.');
  if (tx.meta.err) throw new VerificationError('TRANSACTION_FAILED_ONCHAIN', 'Transaction failed on-chain.');

  if (tx.blockTime) {
    const ageSeconds = Date.now() / 1000 - tx.blockTime;
    if (ageSeconds > config.maxTransactionAgeSeconds) {
      throw new VerificationError('TRANSACTION_EXPIRED', 'Transaction expired.');
    }
  }

  const message = tx.transaction.message;
  const accountKeys = message.staticAccountKeys ?? message.accountKeys;
  const keys = accountKeys.map((k) => k.toBase58());
  const numRequiredSignatures =
    message.header?.numRequiredSignatures ?? message.compiledMessage?.header?.numRequiredSignatures ?? 1;

  const payer = keys[0];
  const signers = keys.slice(0, numRequiredSignatures);

  const treasuryIndex = keys.indexOf(treasuryPubkey.toBase58());
  const senderIndex = keys.indexOf(expectedWallet);

  if (treasuryIndex === -1) {
    throw new VerificationError('TREASURY_NOT_IN_TRANSACTION', 'Treasury wallet is not part of this transaction.');
  }
  if (senderIndex === -1) {
    throw new VerificationError('WALLET_MISMATCH', 'Wallet does not match transaction signer.');
  }
  if (payer !== expectedWallet) {
    throw new VerificationError('WALLET_MISMATCH', 'Wallet does not match transaction signer.');
  }
  if (!signers.includes(expectedWallet)) {
    throw new VerificationError('WALLET_MISMATCH', 'Wallet does not match transaction signer.');
  }

  const preTreasury = tx.meta.preBalances[treasuryIndex];
  const postTreasury = tx.meta.postBalances[treasuryIndex];
  const receivedLamports = postTreasury - preTreasury;

  const preSender = tx.meta.preBalances[senderIndex];
  const postSender = tx.meta.postBalances[senderIndex];
  const sentLamports = preSender - postSender; // includes network fee if sender paid it

  if (receivedLamports <= 0) {
    throw new VerificationError('NO_FUNDS_RECEIVED', 'No funds were received by the treasury wallet.');
  }
  if (sentLamports < receivedLamports) {
    throw new VerificationError('SENDER_BALANCE_MISMATCH', 'Sender balance change does not match amount received.');
  }

  return {
    receivedLamports,
    slot: tx.slot,
    blockTime: tx.blockTime ?? null,
    cluster: config.cluster,
  };
}

/**
 * Subscribes to signature confirmation over the RPC websocket so we can push
 * a "Payment Confirmed" event the moment the cluster confirms it, instead of
 * polling. Resolves once, then unsubscribes.
 */
export function watchSignature(signature, { onConfirmed, onTimeout, timeoutMs = 90_000 }) {
  let settled = false;
  const subId = connection.onSignature(
    signature,
    (result) => {
      if (settled) return;
      settled = true;
      connection.removeSignatureListener(subId);
      if (result.err) onTimeout?.(new Error('Transaction failed on-chain'));
      else onConfirmed?.();
    },
    config.commitment
  );

  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    connection.removeSignatureListener(subId);
    onTimeout?.(new Error('Confirmation timed out'));
  }, timeoutMs);

  return () => {
    clearTimeout(timer);
    if (!settled) connection.removeSignatureListener(subId);
  };
}

