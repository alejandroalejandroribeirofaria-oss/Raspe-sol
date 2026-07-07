import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateParsedPaymentTransaction,
  verifyPurchaseTransaction
} from '../src/services/solana.service.js';
import { createTransactionReplayHash } from '../src/services/integrity.service.js';

const WALLET = '11111111111111111111111111111111';
const TREASURY = process.env.TREASURY_WALLET;

function tx(overrides = {}) {
  const wallet = overrides.wallet ?? WALLET;
  return {
    slot: 123n,
    blockTime: Math.floor(Date.now() / 1000),
    meta: { err: null },
    transaction: {
      message: {
        accountKeys: [
          { pubkey: wallet, signer: true },
          { pubkey: TREASURY, signer: false }
        ],
        instructions: [
          {
            program: 'system',
            parsed: {
              type: 'transfer',
              info: {
                source: overrides.source ?? wallet,
                destination: overrides.destination ?? TREASURY,
                lamports: overrides.lamports ?? 20_000_000
              }
            }
          }
        ]
      }
    },
    ...overrides.root
  };
}

test('accepts valid signer, payer and source', () => {
  const result = validateParsedPaymentTransaction({
    parsedTransaction: tx(),
    wallet: WALLET,
    cluster: 'devnet'
  });
  assert.equal(result.amountLamports, 20_000_000n);
});

test('rejects different signer', () => {
  assert.throws(
    () => validateParsedPaymentTransaction({
      parsedTransaction: tx({ wallet: 'So11111111111111111111111111111111111111112' }),
      wallet: WALLET,
      cluster: 'devnet'
    }),
    /Wallet does not match transaction signer/
  );
});

test('rejects payer different from buyer wallet', () => {
  const parsed = tx();
  parsed.transaction.message.accountKeys.unshift({
    pubkey: 'So11111111111111111111111111111111111111112',
    signer: false
  });

  assert.throws(
    () => validateParsedPaymentTransaction({
      parsedTransaction: parsed,
      wallet: WALLET,
      cluster: 'devnet'
    }),
    /Wallet does not match transaction signer/
  );
});

test('rejects source different from buyer wallet', () => {
  assert.throws(
    () => validateParsedPaymentTransaction({
      parsedTransaction: tx({ source: 'So11111111111111111111111111111111111111112' }),
      wallet: WALLET,
      cluster: 'devnet'
    }),
    /Wallet does not match transaction signer/
  );
});

test('rejects expired transaction', () => {
  assert.throws(
    () => validateParsedPaymentTransaction({
      parsedTransaction: tx({
        root: { blockTime: Math.floor(Date.now() / 1000) - 901 }
      }),
      wallet: WALLET,
      cluster: 'devnet'
    }),
    /Transaction expired/
  );
});

test('rejects failed on-chain transaction', () => {
  assert.throws(
    () => validateParsedPaymentTransaction({
      parsedTransaction: tx({ root: { meta: { err: { InstructionError: [0, 'Custom'] } } } }),
      wallet: WALLET,
      cluster: 'devnet'
    }),
    /Transaction failed on-chain/
  );
});

test('rejects invalid signature format before issuing tickets', async () => {
  await assert.rejects(
    () => verifyPurchaseTransaction({ wallet: WALLET, signature: 'bad', cluster: 'devnet' }),
    /Invalid transaction signature/
  );
});

test('anti-replay hash changes when payment metadata diverges', () => {
  const base = {
    signature: 'x'.repeat(88),
    wallet: WALLET,
    slot: 1n,
    blockTime: new Date('2026-01-01T00:00:00.000Z'),
    cluster: 'devnet',
    amountLamports: 20_000_000n
  };

  assert.notEqual(
    createTransactionReplayHash(base),
    createTransactionReplayHash({ ...base, amountLamports: 40_000_000n })
  );
});

