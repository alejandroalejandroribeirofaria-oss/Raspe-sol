import { db, logAudit } from '../db.js';
import { TICKET_PRICE_LAMPORTS } from '../config.js';

export class ClaimError extends Error {
  constructor(code, message, httpStatus = 400) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

const SELECT_TICKET_WITH_ORDER = `
  SELECT
    t.uuid, t.owner_wallet, t.status, t.prize_label, t.prize_lamports,
    t.claim_status, t.claimed_at, t.claim_paid_at, t.claim_paid_by,
    o.tx_signature, o.paid_at AS purchased_at
  FROM tickets t
  LEFT JOIN orders o ON o.order_id = t.order_id
`;

function mapTicketRow(row) {
  const revealed = row.status === 'REVEALED';
  return {
    ticketId: row.uuid,
    wallet: row.owner_wallet,
    purchasedAt: row.purchased_at,
    amountPaidSol: TICKET_PRICE_LAMPORTS / 1e9,
    txSignature: row.tx_signature,
    revealed,
    prizeLabel: revealed ? row.prize_label : null,
    prizeLamports: revealed ? row.prize_lamports : null,
    prizeSol: revealed ? row.prize_lamports / 1e9 : null,
    claimStatus: row.claim_status, // NONE | PENDING | PAID
    claimedAt: row.claimed_at,
    claimPaidAt: row.claim_paid_at,
    claimPaidBy: row.claim_paid_by,
  };
}

/**
 * This is the ONLY place a ticket's claim_status ever transitions away from
 * NONE. Called from orderService.revealTicket right after the existing
 * reveal logic — it doesn't touch how the prize was determined or how the
 * scratch mechanic works, it just starts the manual-payout paper trail the
 * moment a winning ticket is actually revealed.
 */
export function markClaimPendingIfWinner(ticketUuid) {
  const ticket = db.prepare(`SELECT prize_lamports, claim_status FROM tickets WHERE uuid = ?`).get(ticketUuid);
  if (!ticket || ticket.prize_lamports <= 0 || ticket.claim_status !== 'NONE') return;
  db.prepare(`UPDATE tickets SET claim_status = 'PENDING', claimed_at = datetime('now') WHERE uuid = ?`).run(ticketUuid);
}

/** Used only to enrich the existing reveal response — doesn't change reveal logic itself. */
export function getClaimStatus(ticketUuid) {
  const row = db.prepare(`SELECT claim_status FROM tickets WHERE uuid = ?`).get(ticketUuid);
  return row?.claim_status ?? 'NONE';
}

/** "Meus Bilhetes" — every ticket ever owned by a wallet, newest first. */
export function getTicketsForWallet(wallet) {
  const rows = db
    .prepare(`${SELECT_TICKET_WITH_ORDER} WHERE t.owner_wallet = ? ORDER BY t.claimed_at DESC, t.created_at DESC`)
    .all(wallet);
  return rows.map(mapTicketRow);
}

/** Admin > Claims queue — every ticket that has ever needed a manual payout. */
export function listClaims({ status } = {}) {
  const query = status
    ? `${SELECT_TICKET_WITH_ORDER} WHERE t.claim_status = ? ORDER BY t.claimed_at DESC`
    : `${SELECT_TICKET_WITH_ORDER} WHERE t.claim_status != 'NONE' ORDER BY t.claimed_at DESC`;
  const rows = status ? db.prepare(query).all(status) : db.prepare(query).all();
  return rows.map(mapTicketRow);
}

/**
 * Marks a pending claim as paid. This NEVER moves any SOL — the admin pays
 * the winner manually from their own wallet, outside this system; this just
 * records that it happened, who did it, and when, for audit purposes.
 *
 * Only reachable through the admin-token-gated routes — the frontend has no
 * path that can set claim_status directly.
 */
export function markClaimPaid({ ticketUuid, admin, ip }) {
  const ticket = db.prepare(`SELECT * FROM tickets WHERE uuid = ?`).get(ticketUuid);
  if (!ticket) throw new ClaimError('TICKET_NOT_FOUND', 'Ticket not found.', 404);
  if (ticket.claim_status !== 'PENDING') {
    throw new ClaimError('CLAIM_NOT_PENDING', `Claim is ${ticket.claim_status}, not PENDING.`, 409);
  }

  const adminLabel = admin && String(admin).trim() ? String(admin).trim() : 'admin';

  const applyPayment = db.transaction(() => {
    db.prepare(
      `UPDATE tickets SET claim_status = 'PAID', claim_paid_at = datetime('now'), claim_paid_by = ? WHERE uuid = ?`
    ).run(adminLabel, ticketUuid);

    logAudit('CLAIM_MARKED_PAID', {
      wallet: ticket.owner_wallet,
      ip,
      detail: {
        admin: adminLabel,
        ticketUuid,
        prizeLabel: ticket.prize_label,
        prizeLamports: ticket.prize_lamports,
      },
    });
  });
  applyPayment();

  return mapTicketRow({
    ...ticket,
    claim_status: 'PAID',
    claim_paid_by: adminLabel,
  });
}
