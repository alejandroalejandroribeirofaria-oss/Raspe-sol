import test from 'node:test';
import assert from 'node:assert/strict';
import { env } from '../src/config/env.js';
import { calculatePurchasePlan } from '../src/services/purchase-plan.service.js';

test('rejects insufficient payment', () => {
  assert.throws(
    () => calculatePurchasePlan({ amountLamports: 10_000_000n, requestedQuantity: 1 }),
    /Insufficient payment/
  );
});

test('calculates multiple tickets from exact payment', () => {
  const plan = calculatePurchasePlan({ amountLamports: 200_000_000n, requestedQuantity: 10 });
  assert.equal(plan.ticketCount, 10);
  assert.equal(plan.expectedLamports, 200_000_000n);
  assert.equal(plan.remainderLamports, 0n);
});

test('overpayment generates maximum whole tickets and ignores fractional remainder', () => {
  const plan = calculatePurchasePlan({ amountLamports: 50_000_000n, requestedQuantity: 1 });
  assert.equal(plan.ticketCount, 2);
  assert.equal(plan.expectedLamports, 40_000_000n);
  assert.equal(plan.remainderLamports, 10_000_000n);
});

test('enforces maximum tickets per purchase', () => {
  assert.throws(
    () => calculatePurchasePlan({ amountLamports: 20_020_000_000n, requestedQuantity: 1001 }),
    /Maximum tickets per purchase exceeded/
  );
});

test('rejects overpayment when configured to require exact payment', () => {
  const previous = env.ALLOW_OVERPAYMENT;
  env.ALLOW_OVERPAYMENT = false;
  try {
    assert.throws(
      () => calculatePurchasePlan({ amountLamports: 50_000_000n, requestedQuantity: 1 }),
      /Payment amount mismatch/
    );
  } finally {
    env.ALLOW_OVERPAYMENT = previous;
  }
});

test('rejects fractional remainder when configured not to ignore it', () => {
  const previousOverpayment = env.ALLOW_OVERPAYMENT;
  const previousRemainder = env.IGNORE_REMAINDER;
  env.ALLOW_OVERPAYMENT = true;
  env.IGNORE_REMAINDER = false;
  try {
    assert.throws(
      () => calculatePurchasePlan({ amountLamports: 50_000_000n, requestedQuantity: 1 }),
      /Payment contains unusable remainder/
    );
  } finally {
    env.ALLOW_OVERPAYMENT = previousOverpayment;
    env.IGNORE_REMAINDER = previousRemainder;
  }
});

