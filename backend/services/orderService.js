import { v4 as uuidv4 } from 'uuid';
import { db, logAudit } from '../db.js';
import { config, TICKET_PRICE_LAMPORTS } from '../config.js';
import { verifyPayment, VerificationError } from './solanaVerify.js';
import { totalAvailableTickets, claimTicketsAcrossLots } from './lotService.js';
import { markClaimPendingIfWinner } from './claimService.js';

export class OrderError extends Error {
  constructor(code, message, httpStatus = 400) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export function createOrder({ wallet, quantity = 1 }) {
  if (!wallet || typeof wallet !== 'string') {
    throw new OrderError('INVALID_WALLET', 'A valid buyer wallet is required.');
  }
  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty < 1) {
    throw new OrderError('INVALID_QUANTITY', 'Quantity must be a positive integer.');
  }
  if (qty > config.maxTicketsPerPurchase) {
    throw new OrderError(
      'MAX_TICKETS_EXCEEDED',
      `Cannot request more than ${config.maxTicketsPerPurchase} tickets per purchase.`
    );
  }

  if (totalAvailableTickets() === 0) {
    throw new OrderError('SOLD_OUT', 'No tickets available right now.', 409);
  }

  const orderId = uuidv4();
  const expectedLamports = qty * TICKET_PRICE_LAMPORTS;
  const expiresAt = new Date(Date.now() + config.orderExpiryMinutes * 60_000).toISOString();

  db.prepare(
    `INSERT INTO orders (order_id, wallet, requested_qty, expected_lamports, status, expires_at)
     VALUES (?, ?, ?, ?, 'PENDING', ?)`
  ).run(orderId, wallet, qty, expectedLamports, expiresAt);

  logAudit('ORDER_CREATED', { orderId, wallet, detail: { quantity: qty, expectedLamports } });

  return {
    orderId,
    requestedQty: qty,
    expectedLamports,
    expectedSol: expectedLamports / 1e9,
    ticketPriceSol: config.ticketPriceSol,
    treasuryWallet: config.treasuryWallet,
    expiresAt,
    status: 'PENDING',
  };
}

export function getOrder(orderId) {
  return db.prepare(`SELECT * FROM orders WHERE order_id = ?`).get(orderId);
}

export function getOrderTickets(orderId) {
  return db.prepare(`SELECT * FROM tickets WHERE order_id = ?`).all(orderId);
}

function rejectOrder(orderId, reason) {
  db.prepare(`UPDATE orders SET status = 'REJECTED', reject_reason = ? WHERE order_id = ?`).run(reason, orderId);
}

function isUniqueConstraintError(err) {
  // better-sqlite3's equivalent of Prisma's P2002.
  return err?.code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || err?.code === 'SQLITE_CONSTRAINT_UNIQUE';
}

/**
 * Confirms payment for an order and grants tickets. This is the single
 * choke point that decides how many tickets (if any) a payment earns — the
 * quantity is always computed from lamports actually received on-chain,
 * never from what the client requested or claims to have sent.
 *
 * The whole grant — signature bookkeeping, ticket claiming, order update,
 * audit log — happens inside one SQLite transaction. If any step throws,
 * everything rolls back: there is no path that leaves a paid order with no
 * tickets, or tickets marked SOLD with no matching payment record.
 */
export async function confirmPayment({ orderId, signature, wallet, ip, userAgent }) {
  const order = getOrder(orderId);
  if (!order) throw new OrderError('ORDER_NOT_FOUND', 'Order does not exist.', 404);

  if (order.status === 'PAID') {
    return { order, tickets: getOrderTickets(orderId), alreadyPaid: true };
  }
  if (order.status !== 'PENDING') {
    throw new OrderError('ORDER_NOT_PENDING', `Order is ${order.status}, cannot be paid.`);
  }
  if (new Date(order.expires_at).getTime() < Date.now()) {
    rejectOrder(orderId, 'ORDER_EXPIRED');
    throw new OrderError('ORDER_EXPIRED', 'Order expired before payment was confirmed.');
  }
  if (wallet !== order.wallet) {
    rejectOrder(orderId, 'WALLET_MISMATCH');
    throw new OrderError('WALLET_MISMATCH', 'Wallet does not match transaction signer.');
  }

  // Fast-path duplicate check before touching the RPC. The UNIQUE
  // constraint inside the transaction below is what actually closes the
  // race — this is just an early, cheap rejection for the common case.
  const reused = db.prepare(`SELECT 1 FROM processed_transactions WHERE tx_signature = ?`).get(signature);
  if (reused) {
    rejectOrder(orderId, 'SIGNATURE_ALREADY_USED');
    throw new OrderError('SIGNATURE_ALREADY_USED', 'Transaction already used.', 409);
  }

  let verdict;
  try {
    verdict = await verifyPayment({ signature, expectedWallet: wallet });
  } catch (err) {
    const reason = err instanceof VerificationError ? err.code : 'VERIFICATION_FAILED';
    rejectOrder(orderId, reason);
    logAudit('ORDER_REJECTED', { orderId, wallet, ip, userAgent, detail: { reason, message: err.message } });
    if (err instanceof VerificationError) throw new OrderError(err.code, err.message, err.httpStatus);
    throw new OrderError('VERIFICATION_FAILED', 'Could not verify payment.');
  }

  const grant = computeGrantedQuantity({
    receivedLamports: verdict.receivedLamports,
    requestedQty: order.requested_qty,
    expectedLamports: order.expected_lamports,
  });

  if (grant.error) {
    rejectOrder(orderId, grant.error);
    logAudit('ORDER_REJECTED', {
      orderId,
      wallet,
      ip,
      userAgent,
      detail: { reason: grant.error, receivedLamports: verdict.receivedLamports },
    });
    throw new OrderError(grant.error, grant.message);
  }

  if (grant.qty > config.maxTicketsPerPurchase) {
    rejectOrder(orderId, 'MAX_TICKETS_EXCEEDED');
    throw new OrderError('MAX_TICKETS_EXCEEDED', `Payment covers more than the ${config.maxTicketsPerPurchase} ticket limit.`);
  }

  let claimedUuids = [];
  const runAtomicPurchase = db.transaction(() => {
    // 1. Record the signature — UNIQUE constraint is the actual race guard.
    db.prepare(
      `INSERT INTO processed_transactions
         (tx_signature, wallet, amount_lamports, slot, block_time, cluster, order_id, ticket_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(signature, wallet, verdict.receivedLamports, verdict.slot, verdict.blockTime, verdict.cluster, orderId, grant.qty);

    // 2. Claim tickets atomically across whichever lots are currently
    //    sellable (same transaction, so nothing else can take these ticket
    //    rows or race the lot counters between the check and the update).
    const rows = claimTicketsAcrossLots({ count: grant.qty, wallet, orderId });
    claimedUuids = rows;

    // 3. Update the order.
    db.prepare(
      `UPDATE orders SET status = 'PAID', tx_signature = ?, granted_qty = ?, paid_at = datetime('now') WHERE order_id = ?`
    ).run(signature, claimedUuids.length, orderId);

    // 4. Full audit trail.
    logAudit('ORDER_PAID', {
      orderId,
      wallet,
      ip,
      userAgent,
      detail: {
        signature,
        slot: verdict.slot,
        blockTime: verdict.blockTime,
        cluster: verdict.cluster,
        receivedLamports: verdict.receivedLamports,
        expectedLamports: order.expected_lamports,
        grantedQty: claimedUuids.length,
      },
    });
  });

  try {
    runAtomicPurchase();
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      rejectOrder(orderId, 'SIGNATURE_ALREADY_USED');
      throw new OrderError('SIGNATURE_ALREADY_USED', 'Transaction already used.', 409);
    }
    rejectOrder(orderId, 'INTERNAL_ERROR');
    throw err;
  }

  if (claimedUuids.length < grant.qty) {
    logAudit('PARTIAL_FILL', { orderId, wallet, detail: { requested: grant.qty, granted: claimedUuids.length } });
  }

  return { order: getOrder(orderId), tickets: getOrderTickets(orderId), alreadyPaid: false };
}

/**
 * Decides how many tickets a payment earns, based purely on lamports
 * actually received — never on what the client claims it sent.
 */
function computeGrantedQuantity({ receivedLamports, requestedQty, expectedLamports }) {
  if (receivedLamports < expectedLamports) {
    return { error: 'INSUFFICIENT_PAYMENT', message: 'Amount received is less than the ticket price.' };
  }
  if (receivedLamports === expectedLamports) {
    return { qty: requestedQty };
  }
  // Overpayment.
  if (!config.allowOverpayment) {
    return { error: 'AMOUNT_MISMATCH', message: "Amount received doesn't match the expected ticket price." };
  }
  // floor() is what actually implements "ignore remainder" — there is no
  // such thing as a partial ticket, so this is the only sane behavior
  // regardless of the IGNORE_REMAINDER flag's value.
  const affordableQty = Math.floor(receivedLamports / TICKET_PRICE_LAMPORTS);
  return { qty: Math.max(affordableQty, requestedQty) };
}

export function sweepExpiredOrders() {
  const expired = db
    .prepare(`SELECT order_id FROM orders WHERE status = 'PENDING' AND expires_at < datetime('now')`)
    .all();
  for (const { order_id } of expired) rejectOrder(order_id, 'ORDER_EXPIRED');
  return expired.length;
}

export function revealTicket({ ticketUuid, wallet }) {
  const ticket = db.prepare(`SELECT * FROM tickets WHERE uuid = ?`).get(ticketUuid);
  if (!ticket) throw new OrderError('TICKET_NOT_FOUND', 'Ticket does not exist.', 404);
  if (ticket.owner_wallet !== wallet) throw new OrderError('WALLET_MISMATCH', 'Wallet does not own this ticket.');
  if (ticket.status !== 'SOLD' && ticket.status !== 'REVEALED') {
    throw new OrderError('NOT_PAID', 'Ticket is not paid for yet.');
  }

  if (ticket.status !== 'REVEALED') {
    db.prepare(`UPDATE tickets SET status = 'REVEALED', revealed_at = datetime('now') WHERE uuid = ?`).run(ticketUuid);
    logAudit('TICKET_REVEALED', { wallet, detail: { ticketUuid, prize: ticket.prize_label } });
    // Manual-claim bookkeeping only — never moves any SOL, see claimService.js.
    markClaimPendingIfWinner(ticketUuid);
  }

  return { ...ticket, status: 'REVEALED' };
}

export { computeGrantedQuantity };

